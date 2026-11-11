import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

type RecordObject = Record<string, unknown>
type Status = 'SUCCESS' | 'ERROR' | 'INCOMPLETE'

export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function object(value: unknown): RecordObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a log object')
  return value as RecordObject
}

function sequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid event sequence')
  return value
}

interface Event {
  seq: number
  type: string
  data: RecordObject
  surfaceOp?: unknown
}

export interface Transaction {
  id: string
  status: Status
  start?: number
  summary?: number
  checkpoint?: number
  end?: number
  shadowed: number[]
  shadowedTokens?: number
  summaryUsage?: Record<string, number>
  before?: number[]
  after?: number[]
  issues: string[]
}

function parse(text: string): { events: Event[]; sessionId?: string } {
  const events: Event[] = []
  let sessionId: string | undefined
  if (!text.trim()) return { events }
  for (const [index, line] of text.trimEnd().split('\n').entries()) {
    const row = object(JSON.parse(line))
    if (row.type === 'session') {
      if (index !== 0 || row.seq !== undefined) throw new Error('Invalid session header position or sequence')
      if (typeof row.id !== 'string' || !row.id) throw new Error('Missing persisted session identity')
      sessionId = row.id
      continue
    }
    const seq = sequence(row.seq)
    if (seq !== events.length || typeof row.type !== 'string') throw new Error(`Broken log sequence at line ${index + 1}`)
    events.push({ seq, type: row.type, data: object(row.data), surfaceOp: row.surfaceOp })
  }
  return { events, ...(sessionId === undefined ? {} : { sessionId }) }
}

/** Replay only the persisted surface operations. No runtime provider is loaded. */
export function auditJsonl(text: string) {
  const { events, sessionId } = parse(text)
  const surface: number[] = []
  const transactions = new Map<string, Transaction>()
  const lineage = new Map<number, number[]>()
  const summaryEvents = new Map<string, Event>()
  const openingEvents = new Map<string, Event>()
  const prunes: number[] = []
  let prior: Event | undefined

  for (const event of events) {
    const source = event.type === 'user/message' && event.data.source !== undefined ? object(event.data.source) : undefined
    const kind = event.type.startsWith('compaction/') ? event.type : source?.kind === 'compact-checkpoint' ? 'checkpoint' : undefined
    const id = kind === 'checkpoint' ? source?.compactionId : event.data.compactionId
    let tx: Transaction | undefined
    if (kind && kind !== 'compaction/prune') {
      if (typeof id !== 'string' || id === '') throw new Error(`Missing compaction identity at ${event.seq}`)
      tx = transactions.get(id)
      if (!tx) {
        tx = { id, status: 'INCOMPLETE', shadowed: [], issues: [] }
        transactions.set(id, tx)
      }
      switch (kind) {
        case 'compaction/start':
          if (tx.start !== undefined || tx.summary !== undefined || tx.end !== undefined) tx.issues.push('UNEXPECTED_START')
          tx.start = event.seq
          tx.before = [...surface]
          openingEvents.set(tx.id, event)
          break
        case 'compaction/summary':
          if (tx.start === undefined || tx.summary !== undefined || tx.end !== undefined) tx.issues.push('UNEXPECTED_SUMMARY')
          tx.summary = event.seq
          if (!Array.isArray(event.data.shadowedSeqs)) throw new Error('Missing shadowedSeqs')
          tx.shadowed = event.data.shadowedSeqs.map(sequence)
          tx.shadowedTokens = sequence(event.data.shadowedTokenCount)
          if (event.data.usage !== undefined) {
            const usage = object(event.data.usage)
            const known = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens']
            tx.summaryUsage = Object.fromEntries(known.filter((key) => usage[key] !== undefined).map((key) => [key, sequence(usage[key])]))
          }
          summaryEvents.set(tx.id, event)
          break
        case 'checkpoint':
          if (tx.checkpoint !== undefined || tx.summary !== event.seq - 1 || tx.end !== undefined) tx.issues.push('CHECKPOINT_NOT_ADJACENT')
          tx.checkpoint = event.seq
          break
        case 'compaction/end':
          if (tx.start === undefined || tx.end !== undefined) tx.issues.push('UNEXPECTED_END')
          tx.end = event.seq
          tx.after = [...surface]
          if (event.data.error !== undefined) tx.issues.push('BACKEND_ERROR')
          if (openingEvents.get(tx.id)?.data.turn !== event.data.turn ||
              openingEvents.get(tx.id)?.data.sourceCommandId !== event.data.sourceCommandId) tx.issues.push('LIFECYCLE_MISMATCH')
          break
      }
    }
    if (event.surfaceOp === 'append') {
      if (kind === 'checkpoint') tx?.issues.push('CHECKPOINT_NOT_REPLACEMENT')
      surface.push(event.seq)
    } else if (event.surfaceOp !== undefined) {
      const replacement = object(event.surfaceOp)
      if (replacement.op !== 'replace') throw new Error(`Unknown surface operation at ${event.seq}`)
      const start = surface.indexOf(sequence(replacement.startSeq))
      const end = surface.indexOf(sequence(replacement.endSeq))
      if (start < 0 || end < start) throw new Error(`Invalid positional replacement at ${event.seq}`)
      const removed = surface.splice(start, end - start + 1, event.seq)
      if (kind === 'checkpoint' && tx) {
        const metering = summaryEvents.get(tx.id)
        const range = metering?.data.shadowedRange
        if (!range || object(range).start !== replacement.startSeq || object(range).end !== replacement.endSeq ||
            source?.sourceCommandId !== metering?.data.sourceCommandId) tx.issues.push('CHECKPOINT_PROVENANCE_MISMATCH')
        if (removed.length !== tx.shadowed.length || removed.some((seq, i) => seq !== tx.shadowed[i])) {
          tx.issues.push('SHADOWED_SEQUENCE_MISMATCH')
        }
        lineage.set(event.seq, removed)
      } else if (prior?.type === 'compaction/prune') {
        prunes.push(event.seq)
      }
    } else if (kind === 'checkpoint') {
      tx?.issues.push('CHECKPOINT_NOT_REPLACEMENT')
    }
    prior = event
  }

  for (const tx of transactions.values()) {
    if (tx.issues.length) tx.status = 'ERROR'
    else if (tx.start !== undefined && tx.summary !== undefined && tx.checkpoint !== undefined && tx.end !== undefined) tx.status = 'SUCCESS'
    if (tx.status !== 'SUCCESS' && tx.checkpoint !== undefined) lineage.delete(tx.checkpoint)
  }
  return { events, sessionId, surface, transactions: [...transactions.values()], lineage, prunes }
}

export function reaches(lineage: ReadonlyMap<number, readonly number[]>, checkpoint: number, source: number): boolean {
  const pending = [...(lineage.get(checkpoint) ?? [])]
  const visited = new Set<number>()
  while (pending.length) {
    const seq = pending.pop()
    if (seq === undefined || visited.has(seq)) continue
    if (seq === source) return true
    visited.add(seq)
    for (const previous of lineage.get(seq) ?? []) pending.push(previous)
  }
  return false
}

function verifyNextRequests(replay: ReturnType<typeof auditJsonl>, trace: string) {
  const rows = trace.split('\n').filter((line) => line.trim()).map((line) => object(JSON.parse(line)))
  return replay.transactions.filter((tx) => tx.status === 'SUCCESS').map((tx) => {
    const runIndex = rows.findIndex((row) => row.session === replay.sessionId && row.type === 'compaction' && row.result !== undefined &&
      object(row.result).sourceEventSeq === tx.summary)
    const run = rows[runIndex]
    const request = run && rows.slice(runIndex + 1).find((row) =>
      row.session === replay.sessionId && row.stage === run.stage && row.type === 'request' && row.status === 200)
    const checkpoint = replay.events[tx.checkpoint!]
    const blocks = checkpoint?.data.content
    const content = Array.isArray(blocks) && blocks.length === 1 ? object(blocks[0]).text : undefined
    const marker = '\n\n[Charter / Active verified user constraints]\n'
    const split = typeof content === 'string' ? content.split(marker) : []
    const version = split.length === 2 ? /^Baseline: (\d+)\n/.exec(split[1] ?? '')?.[1] : undefined
    if (!version || !request || !Array.isArray(request.snapshots)) {
      return { checkpoint: tx.checkpoint, status: 'UNOBSERVABLE' }
    }
    const expected = hash(marker.slice(2) + split[1])
    const snapshots = request.snapshots.map(object)
    const latest = snapshots.at(-1)
    const matches = snapshots.filter((snapshot) => snapshot.version === Number(version) && snapshot.sha256 === expected).length
    const fact = typeof content === 'string'
      ? /^\[Charter \/ Verified tool facts, context only\]\n[^\n]+\n\[[^\n]*\]/m.exec(content)?.[0]
      : undefined
    const factMatches = fact && Array.isArray(request.factBlocks)
      ? request.factBlocks.filter((digest) => digest === hash(fact)).length
      : undefined
    return {
      checkpoint: tx.checkpoint,
      status: latest?.sha256 === expected && latest.version === Number(version) && matches === 1 ? 'VERIFIED_IN_REQUEST' : 'MISMATCH',
      expectedVersion: Number(version),
      snapshotCount: snapshots.length,
      matchingSnapshotCount: matches,
      ...(fact === undefined ? {} : { contextualFacts: factMatches === 1 ? 'VERIFIED_IN_REQUEST' : 'MISMATCH' }),
    }
  })
}

function verifyAlerts(replay: ReturnType<typeof auditJsonl>, input: string) {
  const rows = input.trimEnd().split('\n').filter(Boolean).map((line) => object(JSON.parse(line)))
  const transactions = replay.transactions.filter((tx) => tx.status === 'SUCCESS')
  const checks = transactions.map((tx) => {
    const checkpoint = replay.events[tx.checkpoint!]
    const blocks = checkpoint?.data.content
    const text = Array.isArray(blocks) && blocks.length === 1 ? object(blocks[0]).text : undefined
    const marker = '\n\n[Charter / Active verified user constraints]\n'
    const parts = typeof text === 'string' ? text.split(marker) : []
    const expectedVersion = parts.length === 2 ? Number(/^Baseline: (\d+)\n/.exec(parts[1] ?? '')?.[1]) : NaN
    const alerts = rows.filter((row) => row.compaction_id === tx.id && row.stage === 'post_commit')
    if (!alerts.length || typeof text !== 'string' || !Number.isSafeInteger(expectedVersion)) {
      return { compactionId: tx.id, status: 'UNOBSERVABLE' }
    }
    const entry = alerts[0]
    const exact = alerts.length === 1 && entry?.code === 'PRESERVED' &&
      entry.baseline_version === expectedVersion &&
      entry.candidate_checkpoint_sha256 === hash(text) &&
      entry.policy_snapshot_sha256 === hash(marker.slice(2) + parts[1])
    return { compactionId: tx.id, status: exact ? 'VERIFIED' : 'MISMATCH', observed: alerts.length }
  })
  return {
    checks,
    verified: checks.filter((check) => check.status === 'VERIFIED').length,
    missing: checks.filter((check) => check.status === 'UNOBSERVABLE').length,
    denominator: transactions.length,
    deliveryToHuman: 'UNOBSERVABLE',
  }
}

function verifyConstraints(result: ReturnType<typeof auditJsonl>, baselineValue: unknown) {
  const baseline = object(baselineValue)
  if (typeof baseline.session_id !== 'string' || baseline.session_id !== result.sessionId || !Array.isArray(baseline.items)) {
    throw new Error('Audit baseline is not for this session')
  }
  const entries = new Map<string, RecordObject>()
  for (const value of baseline.items) {
    const entry = object(value)
    if (entry.status !== 'active' || entry.authority_class !== 'user_instruction') continue
    if (typeof entry.constraint_id !== 'string') throw new Error('Invalid constraint identifier')
    const existing = entries.get(entry.constraint_id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) throw new Error('Conflicting constraint identifiers')
    entries.set(entry.constraint_id, entry)
  }
  return result.transactions.filter((tx) => tx.status === 'SUCCESS').map((tx) => {
    const checkpoint = result.events[tx.checkpoint!]
    const content = checkpoint?.data.content
    const blocks = Array.isArray(content) ? content.map(object) : []
    const marker = '\n\n[Charter / Active verified user constraints]\n'
    const protection = blocks.length === 1 && typeof blocks[0]?.text === 'string' ? blocks[0].text.split(marker) : []
    const lines = protection.length === 2 ? protection[1]?.split('\n') : undefined
    const exactVersion = lines?.[0] === `Baseline: ${baseline.baseline_version}`
    let declared: RecordObject[] = []
    let readable = false
    if (exactVersion && lines?.length === 3) {
      try {
        const parsed: unknown = JSON.parse(lines[2]!)
        if (Array.isArray(parsed)) {
          declared = parsed.map(object)
          readable = true
        }
      } catch {
        // Malformed protection remains unobservable.
      }
    }
    const checks = [...entries.values()].map((entry) => {
      const sourceSeq = sequence(entry.source_seq)
      const source = result.events[sourceSeq]
      const original = source?.data.content
      const quote = entry.quote
      const raw = source?.type === 'user/message' && source.data.source !== undefined &&
        object(source.data.source).kind === 'user' && entry.source_role === 'user' && entry.approved_by_operator === true &&
        typeof quote === 'string' && quote.length > 0 && hash(quote) === entry.quote_sha256 &&
        Array.isArray(original) && original.some((item) => {
          const block = object(item)
          return block.type === 'text' && typeof block.text === 'string' && block.text.includes(quote)
        })
      const records = declared.filter((item) => item.constraint_id === entry.constraint_id)
      const keys = ['source_seq', 'quote', 'quote_sha256', 'action', 'resource', 'effect', 'validity']
      const exact = raw && records.length === 1 && keys.every((key) => JSON.stringify(records[0]?.[key]) === JSON.stringify(entry[key]))
      return {
        constraintId: entry.constraint_id,
        sourceSeq,
        source: raw ? 'RAW_LOG_FOUND' : 'SOURCE_MISMATCH',
        lineage: tx.after?.includes(sourceSeq) ? 'DIRECT_SURFACE_SOURCE' :
          reaches(result.lineage, tx.checkpoint!, sourceSeq) ? 'LINEAGE_LINKED' : 'TRACE_GAP',
        protected: !readable ? 'UNOBSERVABLE' : exact && declared.length === entries.size
          ? 'TEXT_REF_VERIFIED' : records.length ? 'INVALID_TEXT_REF' : 'NO_TEXT_REF',
      }
    })
    return {
      checkpoint: tx.checkpoint,
      declaredCount: declared.length,
      baselineVersion: exactVersion ? baseline.baseline_version : null,
      verified: checks.filter((item) => item.protected === 'TEXT_REF_VERIFIED').length,
      unobservable: checks.filter((item) => item.protected === 'UNOBSERVABLE').length,
      denominator: checks.length,
      checks,
    }
  })
}

function verifyFacts(replay: ReturnType<typeof auditJsonl>, baselineValue: unknown) {
  const baseline = object(baselineValue)
  if (baseline.facts !== undefined && !Array.isArray(baseline.facts)) throw new Error('Invalid audit baseline facts')
  const facts = new Map<string, RecordObject>()
  for (const value of baseline.facts ?? []) {
    const fact = object(value)
    const key = JSON.stringify([sequence(fact.source_seq), fact.quote_sha256])
    const prior = facts.get(key)
    if (prior && (prior.quote !== fact.quote || prior.approved_by_operator !== fact.approved_by_operator)) {
      throw new Error('Conflicting audit baseline facts')
    }
    facts.set(key, fact)
  }
  const marker = '\n\n[Charter / Verified tool facts, context only]\n'
  return replay.transactions.filter((tx) => tx.status === 'SUCCESS').flatMap((tx) => {
    const content = replay.events[tx.checkpoint!]?.data.content
    const text = Array.isArray(content) && content.length === 1 ? object(content[0]).text : undefined
    const parts = typeof text === 'string' ? text.split(marker) : []
    if (!facts.size && parts.length <= 1) return []
    let rows: RecordObject[] | undefined
    if (parts.length === 2) {
      try {
        const data: unknown = JSON.parse(parts[1]?.split('\n')[1] ?? '')
        if (Array.isArray(data)) rows = data.map(object)
      } catch {
        // A malformed fact block cannot verify.
      }
    }
    const checks = [...facts.values()].map((fact) => {
      const seq = sequence(fact.source_seq)
      const source = replay.events[seq]
      const quote = fact.quote
      const message = source?.type === 'tool/result' && source.surfaceOp === 'append' ? object(source.data.message) : undefined
      const validSource = typeof quote === 'string' && quote.trim().length > 0 && fact.approved_by_operator === true &&
        hash(quote) === fact.quote_sha256 && message?.isError !== true && Array.isArray(message?.content) &&
        message.content.some((block) => {
          const data = object(block)
          return data.type === 'text' && typeof data.text === 'string' && data.text.includes(quote)
        })
      const matches = rows?.filter((row) => Object.keys(row).length === 3 &&
        row.source_seq === seq && row.quote === quote && row.quote_sha256 === fact.quote_sha256) ?? []
      return { sourceSeq: seq, quoteSha256: fact.quote_sha256, verified: validSource && matches.length === 1 }
    })
    const exact = facts.size > 0 && rows?.length === facts.size && checks.every((check) => check.verified)
    return [{ checkpoint: tx.checkpoint, exact, declaredCount: rows?.length ?? null,
      verified: exact ? checks.length : 0, denominator: checks.length, checks }]
  })
}

export function auditFile(path: string, baseline?: unknown, requestTrace?: string, alertTrace?: string) {
  const raw = readFileSync(path)
  const decoded = path.endsWith('.zstd') ? zstdDecompressSync(raw, { maxOutputLength: 128 * 1024 * 1024 }) : raw
  const replay = auditJsonl(decoded.toString('utf8'))
  const { events, surface, transactions, lineage, prunes } = replay
  const counts = { SUCCESS: 0, ERROR: 0, INCOMPLETE: 0 }
  for (const tx of transactions) counts[tx.status] += 1
  return {
    sha256: hash(raw),
    eventCount: events.length,
    surface,
    status: transactions.length ? 'TRIGGERED' : 'NOT_TRIGGERED',
    transactions,
    counts,
    denominator: transactions.length,
    chainExercised: transactions.some((tx) => tx.status === 'SUCCESS' && tx.shadowed.some((seq) => lineage.has(seq))),
    prunes,
    nextRequest: requestTrace === undefined ? 'UNOBSERVABLE' : verifyNextRequests(replay, requestTrace),
    ...(alertTrace === undefined ? {} : { alerts: verifyAlerts(replay, alertTrace) }),
    ...(baseline === undefined ? {} : { constraints: verifyConstraints(replay, baseline), contextualFacts: verifyFacts(replay, baseline) }),
  }
}
