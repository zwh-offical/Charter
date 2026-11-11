import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { compactCheckpointSource, CompactionId } from '@deepseek-ai/dsh-compaction'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { selectHistory } from '../../packages/charter-compaction/src/selector.js'

it('keeps the latest turn and includes a high-sequence checkpoint in an older surface position', () => {
  const session = Session.create(SessionId('selection-fixture'))
  const message = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const append = (text: string) => session.append('user/message', message(text), { surfaceOp: 'append' })
  session.append('turn/start', { turn: 1 })
  const first = append('first')
  const second = append('second')
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  const previous = append('previous turn')
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const compactionId = CompactionId('selection-test')
  const summary = [{ type: 'text' as const, text: 'summary' }]
  const start = session.append('compaction/start', { compactionId, turn: null })
  const metering = session.append('compaction/summary', {
    compactionId, summary, provider: 'test', model: 'test',
    shadowedRange: { start: first.seq, end: second.seq }, shadowedSeqs: [first.seq, second.seq], shadowedTokenCount: 10,
  })
  const checkpoint = session.append('user/message', createUserMessage({
    source: compactCheckpointSource(compactionId), content: summary,
  }), {
    surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: second.seq },
    sourceEventSeqs: [start.seq, metering.seq, first.seq, second.seq],
  })
  session.append('compaction/end', { compactionId, turn: null })
  expect(selectHistory(session)).toBeUndefined()
  session.append('turn/start', { turn: 3 })
  append('retained tail')
  session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  expect(checkpoint.seq).toBeGreaterThan(previous.seq)
  expect(selectHistory(session)).toEqual({ start: checkpoint.seq, end: previous.seq })
})
