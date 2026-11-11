import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const inject = ['commands', 'compaction']

export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    const whenIdle = agent.whenIdle
    agent.whenIdle = async function () {
      await whenIdle.call(this)
      agent.whenIdle = whenIdle
      const { session } = agent
      const provider = ctx.compaction.constructor.name
      if (provider !== 'CharterCompaction') {
        console.error(JSON.stringify({ provider, session: session.id }))
        return
      }
      if (session.surface.nodes.length !== 0) {
        throw new Error('The Charter fixture driver requires a new session')
      }
      for (const text of [
        'CHARTER_SYNTHETIC_FIXTURE: ' + 'first sample '.repeat(100),
        'CHARTER_SYNTHETIC_FIXTURE: ' + 'second sample '.repeat(100),
        'Keep this test fixture message.',
      ]) {
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
      }
      const before = session.surface.nodes.length
      const execution = await ctx.commands.execute(agent, '/compact', [], AbortSignal.timeout(30_000))
      console.error(JSON.stringify({ provider, session: session.id, before, after: session.surface.nodes.length, result: execution?.result }))
      if (!execution?.result.sourceEventSeq) throw new Error('The Charter fixture did not commit')
    }
  })
}
