import { appendFileSync } from 'node:fs'

export const inject = ['commands', 'compaction']
const stage = process.env.CHARTER_STAGE
const record = (entry) => appendFileSync('/state/features.jsonl', JSON.stringify({ stage, ...entry }) + '\n')

export function apply(ctx) {
  if (stage === 'pin') ctx.on('agent/created', ({ agent }) => {
    const original = agent.whenIdle
    agent.whenIdle = async function () {
      await original.call(this)
      agent.whenIdle = original
      const source = agent.session.snapshotEvents().find((event) => event.type === 'user/message' &&
        event.data.source.kind === 'user' && event.data.content.some((block) => block.text?.includes('Do not delete raw files.')))
      if (!source) throw Error('Missing original user source')
      const command = `/charter pin ${source.seq} {"effect":"deny","action":["delete"],"resource":"data/raw/**","quote":"Do not delete raw files."}`
      const result = await ctx.commands.execute(agent, command, [], AbortSignal.timeout(20_000))
      record({ type: 'pin', status: result?.result.kind, sourceSeq: source.seq })
      if (result?.result.kind !== 'success') throw Error(result?.result.text ?? 'Pin command unavailable')
    }
  })
  if (stage === 'overflow') ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const first = await ctx.compaction.compactIfNeeded(agent, 'context-overflow', signal)
    const second = await ctx.compaction.compactIfNeeded(agent, 'context-overflow', signal)
    record({ type: 'overflow', committed: Boolean(first), secondSkipped: second === null })
    if (!first || second !== null) throw Error('Overflow probe did not commit exactly once')
    return next()
  }, { prepend: true })
  if (stage === 'interrupted') ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const cancel = new AbortController()
    const before = agent.session.surface.replaceGeneration
    const off = ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'compaction/start') cancel.abort(new Error('FEATURE_PROBE_INTERRUPTED'))
    })
    let stopped = false
    try {
      await ctx.compaction.compactIfNeeded(agent, 'context-overflow', AbortSignal.any([signal, cancel.signal]))
    } catch (error) {
      stopped = error === cancel.signal.reason
    } finally {
      off()
    }
    const unchanged = agent.session.surface.replaceGeneration === before
    record({ type: 'interruption', stopped, unchanged })
    if (!stopped || !unchanged) throw Error('Interrupted attempt did not preserve the surface')
    return next()
  }, { prepend: true })
}
