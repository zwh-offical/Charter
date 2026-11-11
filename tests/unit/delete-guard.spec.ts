import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { deleteFile, matchDeleteRules } from '../../packages/charter-compaction/src/delete-guard.js'
import type { Constraint } from '../../packages/charter-compaction/src/policy.js'

it('fails closed for missing policy and refuses traversal even in the unguarded control', () => {
  const root = mkdtempSync(join(tmpdir(), 'charter-delete-'))
  try {
    const workspace = join(root, 'fixture')
    const policyDirectory = join(root, 'private')
    mkdirSync(workspace)
    mkdirSync(policyDirectory)
    writeFileSync(join(workspace, 'cache.txt'), 'synthetic cache')
    writeFileSync(join(root, 'outside.txt'), 'synthetic outside file')
    const id = SessionId('delete-fixture')
    const session = Session.create(id, [], { ...Session.create(id).header, cwd: workspace })
    const signal = new AbortController().signal
    const config = { workspace, policyDirectory, enforce: true }
    expect(deleteFile(config, session, 'cache.txt', 'missing-policy', signal).outcome).toBe('denied')
    expect(existsSync(join(workspace, 'cache.txt'))).toBe(true)
    expect(deleteFile({ ...config, enforce: false }, session, '../outside.txt', 'traversal', signal).outcome).toBe('denied')
    expect(existsSync(join(root, 'outside.txt'))).toBe(true)
    const cancelled = deleteFile(config, session, 'cache.txt', 'cancelled', AbortSignal.abort())
    expect(cancelled).toEqual({ outcome: 'cancelled', reason: 'ABORTED' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('applies legacy deletion rules with whitespace without changing the stored policy', () => {
  const item: Constraint = {
    constraint_id: 'legacy', source_seq: 1, quote: 'Keep raw files', quote_sha256: 'unused',
    action: [' Delete '], resource: 'data/raw/**', effect: 'deny', validity: 'session',
  }
  const policy = { run_id: 'fixture', baseline_version: 1, items: [item] }
  expect(matchDeleteRules(policy, 'data/raw/file.txt')).toEqual([item])
  expect(matchDeleteRules(policy, 'data/raw-backup/file.txt')).toEqual([])
  expect(item.action).toEqual([' Delete '])
})
