import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'

/** Keep the most recent turn and leading system prompt on the visible surface. */
export function selectHistory(session: Session): { start: SessionSeq; end: SessionSeq } | undefined {
  const events = session.snapshotEvents()
  const latestTurn = events.findLast((event) => event.type === 'turn/start')
  if (!latestTurn) return
  const nodes = session.surface.nodes
  const startIndex = session.deriveMessages()[0]?.role === 'system' ? 1 : 0
  const start = nodes[startIndex]
  if (start === undefined || !toolPairingBalancedBefore(session, start)) return
  // A newer sequence may occupy an old position after a replace. A current
  // append anchors the retained turn without treating old checkpoints as tail.
  const retainedBoundary = (turnStart: SessionSeq) => nodes.findIndex((seq) => {
    if (seq < turnStart) return false
    const event = session.eventAt(seq)
    return event !== undefined && 'surfaceOp' in event && event.surfaceOp === 'append'
  })
  let tail = retainedBoundary(latestTurn.seq)
  if (tail < 0) {
    const previous = events.findLast((event) => event.type === 'turn/start' && event.seq < latestTurn.seq)
    if (previous) tail = retainedBoundary(previous.seq)
  }
  for (let index = tail - 1; index > startIndex; index -= 1) {
    const end = nodes[index]
    if (end !== undefined && toolPairingBalancedAfter(session, end)) return { start, end }
  }
}
