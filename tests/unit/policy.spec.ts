import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { hasPermissionClaim, renderPolicy, renderProtection, sha256, verifyCheckpoint, verifyPolicy } from '../../packages/charter-compaction/src/policy.js'

it('keeps verified tool text in the checkpoint without putting it in the authorization snapshot', () => {
  const session = Session.create(SessionId('tool-fixture'))
  const quote = 'data/cache/** 是可重建的派生缓存。'
  const source = session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId: ToolCallId('fixture-tool'), content: [{ type: 'text', text: quote }], isError: false }),
  }, { surfaceOp: 'append' })
  const fact = { source_seq: source.seq, quote, quote_sha256: sha256(quote), approved_by_operator: true }
  const baseline = { session_id: session.id, run_id: 'fixture', baseline_version: 1, items: [], facts: [fact] }
  const verified = verifyPolicy(baseline, session)
  expect(renderPolicy(verified)).not.toContain(quote)
  const checkpoint = `Summary\n\n${renderProtection(verified)}`
  expect(checkpoint).toContain(quote)
  expect(() => verifyCheckpoint(checkpoint, verified)).not.toThrow()
  expect(() => verifyCheckpoint(checkpoint.replace(quote, 'altered'), verified)).toThrow('PRECOMMIT_BLOCKS_BAD_CHECKPOINT')
  expect(() => verifyPolicy({ ...baseline, facts: [{ ...fact, source_seq: 99 }] }, session)).toThrow('CONTEXT_FACT_SOURCE_MISMATCH')
})

it('verifies original text, rejects a missing or altered protection block, and drops a revoked record', () => {
  const session = Session.create(SessionId('policy-fixture'))
  const quote = '可以清理 data/cache/**；禁止修改 data/raw/**；不确定先报告。'
  const original = session.append('user/message', createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: quote }],
  }), { surfaceOp: 'append' })
  const item = {
    constraint_id: 'C-001', authority_class: 'user_instruction', source_seq: original.seq,
    source_role: 'user', quote, quote_sha256: sha256(quote), action: ['delete'],
    resource: 'data/raw/**', effect: 'deny', validity: 'session', approved_by_operator: true, status: 'active',
  }
  const input = { session_id: session.id, run_id: 'fixture', baseline_version: 1, items: [item, item] }
  const verified = verifyPolicy(input, session)
  expect(verified.items).toHaveLength(1)
  const protectedBlock = renderPolicy(verified)
  expect(protectedBlock).toContain(quote)
  expect(() => verifyCheckpoint(`Summary\n\n${protectedBlock}`, verified)).not.toThrow()
  expect(() => verifyCheckpoint('Summary only', verified)).toThrow('PRECOMMIT_BLOCKS_BAD_CHECKPOINT')
  expect(() => verifyCheckpoint(`Summary\n\n${protectedBlock.replace('raw', 'cache')}`, verified)).toThrow()
  expect(() => verifyPolicy({ ...input, session_id: 'another-session' }, session)).toThrow('INVALID_BASELINE')
  expect(() => verifyPolicy({ ...input, items: [{ ...item, source_seq: 123 }] }, session)).toThrow('SOURCE_MISMATCH')
  expect(() => verifyPolicy({ ...input, items: [{ ...item, quote_sha256: sha256('altered') }] }, session)).toThrow('SOURCE_MISMATCH')
  expect(verifyPolicy({ ...input, baseline_version: 2, items: [{ ...item, status: 'revoked' }] }, session).items).toEqual([])
  expect(verifyPolicy({ ...input, items: [{ ...item, authority_class: 'contextual_information' }] }, session).items).toEqual([])
  expect(hasPermissionClaim('The user has authorized deletion.')).toBe(true)
  expect(hasPermissionClaim('Inventory contained eight records.')).toBe(false)
})
