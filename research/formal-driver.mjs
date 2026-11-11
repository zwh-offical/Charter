import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { observeDeepSeekRequests } from './request-observer.mjs'

export const inject = ['commands', 'compaction']

export function apply(ctx, config) {
  const { runId, stage, policyDirectory, journal } = config
  const run = /^(B0|B1|CONTROL)-S[123]-[AB]$/.exec(runId)
  if (!run || !['bootstrap', 'c1', 'c2'].includes(stage) || !journal) throw new Error('Invalid formal stage configuration')
  const backend = run[1]
  let sessionId
  const record = (event) => appendFileSync(journal, JSON.stringify({ runId, stage, session: sessionId, ...event }) + '\n', { mode: 0o600 })
  observeDeepSeekRequests(ctx, record)
  ctx.on('agent/created', ({ agent }) => {
    const { session } = agent
    sessionId = session.id
    const provider = ctx.compaction.constructor.name
    const expected = backend === 'B1' ? 'CharterResearchCompaction' : 'BasicCompactionEngine'
    if (provider !== expected) throw new Error(`BACKEND_NOT_ACTIVE: expected ${expected}, received ${provider}`)
    record({ type: 'provider', session: session.id, provider })
    if (stage === 'bootstrap') {
      if (session.surface.nodes.length !== 0) throw new Error('Formal bootstrap requires a fresh session')
      if (backend === 'B1') {
        if (!policyDirectory || !/^[A-Za-z0-9_-]+$/.test(session.id)) throw new Error('Invalid private policy path or session')
        writeFileSync(join(policyDirectory, `${session.id}.json`), JSON.stringify({
          session_id: session.id, run_id: runId, baseline_version: 1, items: [],
        }), { flag: 'wx', mode: 0o600 })
      }
      return
    }
    if (backend === 'CONTROL') throw new Error('Uncompressed controls do not run C1 or C2')
    const whenIdle = agent.whenIdle
    agent.whenIdle = async function () {
      await whenIdle.call(this)
      agent.whenIdle = whenIdle
      const previous = session.snapshotEvents().filter((event) =>
        event.type === 'compaction/start' && event.data.turn === null).length
      if (previous !== (stage === 'c1' ? 0 : 1)) throw new Error('Unexpected prior transactions; preserve the log and use a new run')
      const before = session.surface.nodes.length
      let outcome
      try {
        outcome = await ctx.commands.execute(agent, '/compact', [], AbortSignal.timeout(120_000))
      } catch (error) {
        record({ type: 'compaction', status: 'ERROR', session: session.id })
        throw error
      }
      record({ type: 'compaction', session: session.id, before, after: session.surface.nodes.length, result: outcome?.result })
      if (outcome?.result.kind !== 'success' || !outcome.result.sourceEventSeq) {
        throw new Error('Formal manual compaction did not commit')
      }
    }
  })
}
