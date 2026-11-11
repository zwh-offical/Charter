import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { pinConstraint } from '../../packages/charter-compaction/src/pin.js'
import { summaryInput } from '../../packages/charter-compaction/src/summary-input.js'

it('pins an original message once, keeps its contents out of summary input and rejects unsafe writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'charter-pin-'))
  try {
    mkdirSync(join(root, 'workspace'))
    const directory = join(root, 'private')
    mkdirSync(directory)
    const id = SessionId('pin-fixture')
    const session = Session.create(id, [], { ...Session.create(id).header, cwd: join(root, 'workspace') })
    const append = (text: string) => session.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text }],
    }), { surfaceOp: 'append' })
    const original = append('Do not delete raw files. Leave the raw directory untouched.')
    const progress = append('Eight inventory records were checked.')
    const command = `pin ${original.seq} {"effect":"deny","action":["delete"],"resource":"data/raw/**","quote":"Do not delete raw files."}`
    expect(() => pinConstraint(join(root, 'workspace'), session, command, () => {})).toThrow('UNSAFE_POLICY_DIRECTORY')
    expect(() => pinConstraint(directory, session, command, () => { throw new Error('POLICY_BUDGET_EXCEEDED') })).toThrow('POLICY_BUDGET_EXCEEDED')
    const policy = pinConstraint(directory, session, command, () => {})
    expect(policy.baseline_version).toBe(1)
    expect(pinConstraint(directory, session, command, () => {}).baseline_version).toBe(1)
    expect(JSON.parse(readFileSync(join(directory, 'pin-fixture.json'), 'utf8')).items).toHaveLength(1)
    const input = JSON.stringify(summaryInput(session.deriveMessages(), [original.seq, progress.seq], policy))
    expect(input).not.toContain('Do not delete raw files.')
    expect(input).toContain('Leave the raw directory untouched')
    expect(input).toContain('Eight inventory records were checked')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

