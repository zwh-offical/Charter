import { appendFileSync } from 'node:fs'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { renderPolicy, sha256, verifyCheckpoint, type Policy } from './policy.js'

export function alert(file: string, policy: Policy, compactionId: string, stage: string, code: string, checkpoint?: string, summary?: { input: string; output: string }, conflict?: { rule: number; fragment: string }): void {
  const entry = {
    run_id: policy.run_id,
    compaction_id: compactionId,
    baseline_version: policy.baseline_version,
    stage,
    level: code === 'PRESERVED' ? 'INFO' : code === 'POST_COMMIT_VERIFY_FAILED' ? 'ERROR' : 'WARN',
    code,
    ...(conflict === undefined ? {} : { conflict_match: conflict }),
    constraint_ids: policy.items.map((item) => item.constraint_id),
    source_seqs: policy.items.map((item) => item.source_seq),
    ...(checkpoint === undefined ? {} : { candidate_checkpoint_sha256: sha256(checkpoint) }),
    ...(summary === undefined ? {} : { summary_input_sha256: summary.input, summary_output_sha256: summary.output }),
    policy_snapshot_sha256: sha256(renderPolicy(policy)),
    prompt_delivery: 'PENDING_NEXT_MODEL_REQUEST',
    action: code === 'PRESERVED' ? 'none' : 'review_required',
  }
  appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 })
  process.stderr.write(`[Charter] ${code} | baseline ${policy.baseline_version} | constraints ${policy.items.length} | ${entry.action}\n`)
}

export async function verifyPersisted(storage: SessionPersistence, sessionId: SessionId, checkpointSeq: number, compactionId: string, policy: Policy, expectedText: string): Promise<void> {
  const handle = await storage.open(sessionId, 'read')
  try {
    const { events } = await handle.read(checkpointSeq - 1, 3)
    const [summary, checkpoint, end] = events
    if (summary?.type !== 'compaction/summary' || summary.data.compactionId !== compactionId ||
        checkpoint?.type !== 'user/message' || checkpoint.seq !== checkpointSeq ||
        typeof checkpoint.surfaceOp !== 'object' || checkpoint.surfaceOp.op !== 'replace' ||
        checkpoint.data.source?.kind !== 'compact-checkpoint' || checkpoint.data.source.compactionId !== compactionId ||
        end?.type !== 'compaction/end' || end.data.compactionId !== compactionId || end.data.error !== undefined) {
      throw new Error('POST_COMMIT_TRANSACTION_MISMATCH')
    }
    const block = checkpoint.data.content[0]
    if (checkpoint.data.content.length !== 1 || block?.type !== 'text' || block.text !== expectedText) {
      throw new Error('POST_COMMIT_INVALID_CHECKPOINT')
    }
    verifyCheckpoint(block.text, policy)
  } finally {
    await handle.close()
  }
}
