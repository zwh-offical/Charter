import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import { lastRecordedPolicy, policyRoot, renderPolicy, sha256, verifyPolicy, type Policy } from './policy.js'

export function pinConstraint(directory: string, session: Session, input: string, validate: (policy: Policy) => void): Policy {
  const match = /^\s*pin\s+(\d+)\s+(\{[\s\S]+\})\s*$/.exec(input)
  if (!match) throw new Error('Usage: /charter pin <seq> {"effect":"deny","action":["delete"],"resource":"data/raw/**"}')
  if (!/^[A-Za-z0-9_-]+$/.test(session.id)) throw new Error('INVALID_SESSION_ID')
  const root = policyRoot(directory, session.header.cwd)
  const sourceSeq = Number(match[1])
  if (!Number.isSafeInteger(sourceSeq)) throw new Error('SOURCE_MISMATCH')
  const source = session.eventAt(SessionSeq(sourceSeq))
  if (source?.type !== 'user/message' || source.data.source?.kind !== 'user' || source.surfaceOp !== 'append') throw new Error('SOURCE_MISMATCH')
  const { effect, action, resource, quote: selectedQuote } = JSON.parse(match[2]!)
  const blocks = source.data.content.filter((block) => block.type === 'text')
  const quote = selectedQuote ?? (blocks.length === 1 ? blocks[0]?.text : undefined)
  if (typeof quote !== 'string' || !quote.trim() || !blocks.some((block) => block.text.includes(quote))) throw new Error('SOURCE_MISMATCH')

  const file = join(root, session.id + '.json')
  const lock = file + '.pin.lock'
  const temp = file + '.' + randomUUID() + '.tmp'
  const lockFd = openSync(lock, 'wx', 0o600)
  try {
    const prior = lastRecordedPolicy(session)
    const exists = existsSync(file)
    if (exists && !lstatSync(file).isFile()) throw new Error('UNSAFE_POLICY_FILE')
    const baseline = exists ? JSON.parse(readFileSync(file, 'utf8')) : {
      session_id: session.id, run_id: session.id, baseline_version: 0, items: [],
    }
    if (exists) {
      const policy = verifyPolicy(baseline, session)
      if (prior && (policy.baseline_version < prior.version ||
          (policy.baseline_version === prior.version && renderPolicy(policy) !== prior.snapshot))) {
        throw new Error('BASELINE_UPDATE_PENDING')
      }
    } else if (prior) {
      throw new Error('BASELINE_UPDATE_PENDING')
    }
    const item = {
      constraint_id: 'pin-' + sha256(JSON.stringify([sourceSeq, quote, effect, action, resource])).slice(0, 24),
      authority_class: 'user_instruction', source_seq: sourceSeq, source_role: 'user',
      quote, quote_sha256: sha256(quote), action, resource, effect,
      validity: 'session', approved_by_operator: true, status: 'active',
    }
    if (baseline.items.some((entry: { constraint_id?: string; status?: string }) =>
      entry.constraint_id === item.constraint_id && entry.status === 'active')) {
      const policy = verifyPolicy(baseline, session)
      validate(policy)
      return policy
    }
    const next = {
      ...baseline, baseline_version: baseline.baseline_version + 1,
      items: [...baseline.items.filter((entry: { constraint_id?: string }) => entry.constraint_id !== item.constraint_id), item],
    }
    const policy = verifyPolicy(next, session)
    validate(policy)
    const serialized = JSON.stringify(next) + '\n'
    if (Buffer.byteLength(serialized) > 256 * 1024) throw new Error('POLICY_BUDGET_EXCEEDED')
    writeFileSync(temp, serialized, { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temp, file)
    return policy
  } finally {
    closeSync(lockFd)
    rmSync(temp, { force: true })
    rmSync(lock, { force: true })
  }
}
