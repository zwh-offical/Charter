import {
  appendFileSync, lstatSync, realpathSync, unlinkSync,
} from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { Session } from '@deepseek-ai/dsh-session'
import { lastRecordedPolicy, policyRoot, readPolicy, renderPolicy, sha256, type Policy } from './policy.js'

export interface DeleteConfig {
  policyDirectory: string
  workspace: string
  enforce: boolean
  boundaryScript?: string
}

interface Change {
  operation: 'approve-delete' | 'revoke-delete'
  path: string
  policyHash: string
  revision: number
  source: 'host-command'
  sourceSeq: number
  commandId: string
}

function workspacePath(value: unknown): string {
  // Canonical, portable paths only. Reject Windows aliases even on Linux.
  if (typeof value !== 'string' || value.length > 512 || value.split('/').some((part) =>
    !/^[a-z0-9_][a-z0-9_.-]*$/.test(part) || part.endsWith('.') ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/.test(part))) {
    throw new Error('INVALID_DELETE_PATH')
  }
  return value
}

function location(config: DeleteConfig, session: Session) {
  if (!isAbsolute(config.workspace) || !isAbsolute(config.policyDirectory) || !session.header.cwd ||
      !/^[A-Za-z0-9_-]+$/.test(session.id)) throw new Error('INVALID_DELETE_CONFIGURATION')
  const root = realpathSync(config.workspace)
  if (relative(root, realpathSync(session.header.cwd))) throw new Error('INVALID_DELETE_CONFIGURATION')
  const directory = policyRoot(config.policyDirectory, root)
  return { root, audit: join(directory, session.id + '.delete.jsonl') }
}

function verifiedPolicy(config: DeleteConfig, session: Session) {
  const policy = readPolicy(config.policyDirectory, session)
  const snapshot = renderPolicy(policy)
  const prior = lastRecordedPolicy(session)
  if (prior && (prior.version > policy.baseline_version ||
      (prior.version === policy.baseline_version && prior.snapshot !== snapshot))) {
    throw new Error('INVALID_DELETE_POLICY')
  }
  return { policy, policyHash: sha256(snapshot) }
}

const deleteActions = new Set(['*', 'delete', 'remove', 'unlink'])

export function matchDeleteRules(policy: Policy, path: string) {
  return policy.items.filter((item) => {
    if (!item.action.some((action) => deleteActions.has(action.trim().toLowerCase()))) return false
    if (item.resource === '**' || item.resource === '*') return true
    const subtree = item.resource.endsWith('/**')
    const base = workspacePath((subtree ? item.resource.slice(0, -3) : item.resource).toLowerCase())
    return path === base || (subtree && path.startsWith(base + '/'))
  })
}

function parseChange(input: string) {
  const match = /^(approve-delete|revoke-delete)\s+(\S+)$/.exec(input.trim())
  if (!match) throw new Error('Usage: /charter-access <approve-delete|revoke-delete> <relative-file>')
  const operation = match[1] === 'approve-delete' ? 'approve-delete' : 'revoke-delete'
  return { operation, path: workspacePath(match[2]) } as const
}

export function changeDeleteAuthorization(config: DeleteConfig, session: Session, input: string) {
  if (!config.enforce) throw new Error('DELETE_GUARD_DISABLED')
  location(config, session)
  const { path } = parseChange(input)
  const { policy, policyHash } = verifiedPolicy(config, session)
  if (!matchDeleteRules(policy, path).length) throw new Error('NO_MATCHING_DELETE_RULE')
  return 'Charter delete authorization ' + policyHash
}

function changes(session: Session, policyHash: string): Change[] {
  const history = session.snapshotEvents()
  const commands = new Map(history.flatMap((event) =>
    event.type === 'command/run' && event.data.name === 'charter-access' && event.data.source.kind === 'user'
      ? [[event.data.commandId, event] as const] : []))
  return history.flatMap((event) => {
    if (event.type !== 'command/done' || event.data.kind !== 'success' ||
        event.data.text !== 'Charter delete authorization ' + policyHash) return []
    const origin = commands.get(event.data.commandId)
    if (!origin?.data.args || origin.seq >= event.seq) throw new Error('INVALID_DELETE_AUTHORIZATION')
    return [{ ...parseChange(origin.data.args), policyHash, revision: event.seq, source: 'host-command',
      sourceSeq: origin.seq, commandId: event.data.commandId }]
  })
}
export function deleteFile(config: DeleteConfig, session: Session, value: unknown, callId: string, signal: AbortSignal) {
  const { root, audit } = location(config, session)
  const record = (entry: object) => appendFileSync(audit, JSON.stringify({ session: session.id, callId, ...entry }) + '\n',
    { mode: 0o600, flush: true })
  let path: string
  let target: string
  let basis: object = {}
  let receipt: object | undefined
  try {
    signal.throwIfAborted()
    path = workspacePath(value)
    if (config.enforce) {
      const { policy, policyHash } = verifiedPolicy(config, session)
      const rules = matchDeleteRules(policy, path)
      const events = changes(session, policyHash)
      const change = events.findLast((entry) => entry.path === path && entry.policyHash === policyHash)
      basis = { baselineVersion: policy.baseline_version, policyHash, rules, revision: events.at(-1)?.revision ?? null, change }
      if (rules.length && change?.operation !== 'approve-delete') {
        record({ phase: 'decision', path, ...basis, outcome: 'denied', reason: 'PROTECTED_PATH' })
        return { outcome: 'denied', reason: 'PROTECTED_PATH' }
      }
      if (config.boundaryScript) {
        const calls = session.snapshotEvents().filter((event) => event.type === 'tool/call' && event.data.callId === callId)
        const call = calls[0]
        if (!path.startsWith('protected/') || !rules.length || !change ||
            calls.length !== 1 || call?.type !== 'tool/call' || call.data.name !== 'charter_delete_file' ||
            JSON.parse(call.data.arguments).path !== path || call.seq <= change.revision) {
          throw new Error('UNVERIFIED_HOST_DELETE')
        }
        receipt = { session: session.id, callId, callSeq: call.seq, approvalId: change.commandId,
          approvalSeq: change.revision, policyHash, path: path.slice('protected/'.length) }
      }
    }
    if (config.boundaryScript && !receipt) throw new Error('UNVERIFIED_HOST_DELETE')
    target = root
    const parts = path.split('/')
    for (const [index, part] of parts.entries()) {
      target = join(target, part)
      const stat = lstatSync(target)
      if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) {
        throw new Error('UNSAFE_DELETE_TARGET')
      }
    }
    signal.throwIfAborted()
  } catch {
    const outcome = signal.aborted ? 'cancelled' : 'denied'
    const reason = signal.aborted ? 'ABORTED' : 'INVALID_POLICY_OR_TARGET'
    record({ phase: 'decision', path: typeof value === 'string' ? value.slice(0, 512) : null,
      ...basis, outcome, reason })
    return { outcome, reason }
  }
  record({ phase: 'decision', path, ...basis, outcome: 'allowed' })
  let outcome = 'deleted'
  try {
    if (config.boundaryScript) {
      const result = spawnSync('/usr/bin/python3', [config.boundaryScript, root, 'execute-authorized'], {
        input: JSON.stringify(receipt), encoding: 'utf8', timeout: 10_000, maxBuffer: 4096,
      })
      // A timeout or a missing result can follow unlink. Do not claim the file survived.
      if (result.status !== 0) outcome = result.status === 3 ? 'denied' : 'unknown'
    } else {
      unlinkSync(target)
    }
  } catch {
    outcome = 'failed'
  }
  record({ phase: 'effect', path, outcome })
  return { outcome, reason: outcome === 'deleted' ? '' : 'DELETE_NOT_CONFIRMED' }
}

