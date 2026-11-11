import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { auditJsonl } from '../dist/packages/charter-audit/src/index.js'

const [runId, logPath, sourceArg, versionArg, extra] = process.argv.slice(2)
const run = /^B1-(S[123])-[AB]$/.exec(runId ?? '')
const version = Number(versionArg)
if (!run || !logPath || !sourceArg || !Number.isSafeInteger(version) || version < 1 || extra) {
  throw new Error('Usage: node research/propose-baseline.mjs <B1 run ID> <persisted log> <source seq|none> <version>')
}
const spec = JSON.parse(readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8')).scenarios[run[1]]
const raw = readFileSync(logPath)
const decoded = logPath.endsWith('.zstd') ? zstdDecompressSync(raw, { maxOutputLength: 128 * 1024 * 1024 }) : raw
const { sessionId, events } = auditJsonl(decoded.toString('utf8'))
if (!sessionId) throw new Error('The persisted log must identify the session')
const items = []
let facts
if (spec.source === 'tool') {
  if (sourceArg !== 'none') {
    const sourceSeq = /^\d+$/.test(sourceArg) ? Number(sourceArg) : -1
    const event = events[sourceSeq]
    if (event?.type !== 'tool/result' || event.surfaceOp !== 'append' || event.data.message?.isError ||
        !spec.manifestFacts.every((quote) => event.data.message?.content?.some((block) => block.type === 'text' && block.text.includes(quote)))) {
      throw new Error('Source sequence does not identify the original tool facts')
    }
    facts = spec.manifestFacts.map((quote) => ({
      source_seq: sourceSeq,
      quote,
      quote_sha256: createHash('sha256').update(quote).digest('hex'),
      approved_by_operator: false,
    }))
  }
} else {
  const sourceSeq = Number(sourceArg)
  const source = Number.isSafeInteger(sourceSeq) && /^\d+$/.test(sourceArg) ? events[sourceSeq] : undefined
  if (source?.type !== 'user/message' || source.data.source?.kind !== 'user' ||
      !source.data.content?.some((block) => block.type === 'text' && block.text.includes(spec.protectedQuote))) {
    throw new Error('Source sequence does not identify the original user quote')
  }
  items.push({
    constraint_id: 'C-001',
    authority_class: 'user_instruction',
    source_seq: sourceSeq,
    source_role: 'user',
    quote: spec.protectedQuote,
    quote_sha256: createHash('sha256').update(spec.protectedQuote).digest('hex'),
    action: spec.actions,
    resource: spec.resource,
    effect: 'deny',
    validity: 'session',
    approved_by_operator: false,
    status: 'active',
  })
}
console.log(JSON.stringify({ session_id: sessionId, run_id: runId, baseline_version: version, items, ...(facts ? { facts } : {}) }, null, 2))
