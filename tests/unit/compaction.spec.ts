import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId, SessionSeq, SessionStore } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { expect, it, vi } from 'vitest'
import CharterCompaction from '../../packages/charter-compaction/src/index.js'
import * as summarizer from '../../packages/charter-compaction/src/summarizer.js'

it('commits and flushes an official transaction and preserves the newest surface node', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(CharterCompaction)
    const flush = vi.fn(async () => {})
    ctx.on('session/flush', flush)
    const session = ctx.sessions.create(SessionId('fixture'))
    const seed = (text: string) => session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    }), { surfaceOp: 'append' })
    const first = seed('CHARTER_SYNTHETIC_FIXTURE: ' + 'first sample '.repeat(100))
    const second = seed('CHARTER_SYNTHETIC_FIXTURE: ' + 'second sample '.repeat(100))
    const tail = seed('Keep this message visible.')
    const signal = new AbortController().signal
    const agent = { session, options: {}, runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => task(signal) }

    await expect(ctx.compaction.compactIfNeeded(agent, 'pressure', signal)).resolves.toBeNull()
    session.append('turn/start', { turn: 1 })
    await expect(ctx.compaction.compactRegion(SessionSeq(100), first.seq, agent, signal)).rejects.toThrow('Invalid compaction range')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(session.surface.nodes).toEqual([first.seq, second.seq, tail.seq])
    expect(flush).not.toHaveBeenCalled()

    const flushEntered = Promise.withResolvers<void>()
    const releaseFlush = Promise.withResolvers<void>()
    flush.mockImplementationOnce(async () => {
      flushEntered.resolve()
      await releaseFlush.promise
    })
    const pending = ctx.compaction.compactNow(agent, signal)
    await flushEntered.promise
    const events = session.snapshotEvents().slice(-4)
    try {
      session.append('turn/start', { turn: 2 })
      await expect(ctx.compaction.compactRegion(events[2]!.seq, tail.seq, agent, signal)).rejects.toThrow('still active')
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      expect(session.snapshotEvents().filter((event) => event.type === 'compaction/start')).toHaveLength(1)
    } finally {
      releaseFlush.resolve()
    }
    const result = await pending
    expect(result?.shadowedSeqs).toEqual([first.seq, second.seq])
    expect(events.map((event) => event.type)).toEqual(['compaction/start', 'compaction/summary', 'user/message', 'compaction/end'])
    expect(events[2]?.data).toMatchObject({ source: { kind: 'compact-checkpoint', compactionId: result?.compactionId } })
    expect(session.surface.nodes).toEqual([events[2]?.seq, tail.seq])
    expect(flush).toHaveBeenCalledTimes(1)
    const beforeNoop = session.snapshotEvents()
    await expect(ctx.compaction.compactNow(agent, signal)).resolves.toBeNull()
    expect(session.snapshotEvents()).toEqual(beforeNoop)
  } finally {
    await ctx.fiber.dispose()
  }
})

it.each(['selected node', 'token count', 'tool boundary'] as const)(
  'closes the transaction without committing when the %s changes during summarization',
  async (change) => {
    const ctx = new Context()
    const root = mkdtempSync(join(tmpdir(), 'charter-race-'))
    const workspace = join(root, 'workspace')
    const policyDirectory = join(root, 'policy')
    mkdirSync(workspace)
    mkdirSync(policyDirectory)
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const summary = vi.spyOn(summarizer, 'summarize').mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return { text: 'Inventory complete.', rawOutput: [{ type: 'text', text: 'Inventory complete.' }] }
    })
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(TokenMeter)
      ctx.provide('llm', { imageRequestPricing: () => undefined })
      ctx.provide('systemPrompt', {})
      ctx.provide('sessionPersistence', {})
      await ctx.plugin(CharterCompaction, { policyDirectory, alertsFile: join(root, 'alerts.jsonl') })
      const flush = vi.fn(async () => {})
      ctx.on('session/flush', flush)
      const session = ctx.sessions.create(SessionId('fixture'), { meta: { cwd: workspace } })
      const route = { provider: 'fixture', model: 'fixture' }
      session.append('request/header', { header: { config: route }, reason: 'initial' })
      writeFileSync(join(policyDirectory, 'fixture.json'), JSON.stringify({
        session_id: 'fixture', run_id: 'fixture', baseline_version: 1, items: [],
      }))
      const message = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      const callId = ToolCallId('fixture-call')
      const assistant = createAssistantMessage({ source: route, content: [
        { type: 'tool-call', id: callId, name: 'fixture_tool', arguments: '{}' },
      ] })
      session.append('assistant/message', { message: assistant, turn: 1, step: 1, stream: [] }, { surfaceOp: 'append' })
      const toolResult = session.append('tool/result', {
        turn: 1, step: 1,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'Done' }], isError: false }),
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step: 1 })
      const start = session.append('user/message', message('First sample. '.repeat(350)), { surfaceOp: 'append' })
      const end = session.append('user/message', message('Second sample. '.repeat(350)), { surfaceOp: 'append' })
      const pending = ctx.compaction.compactRegion(start.seq, end.seq, { session, options: {} })
      const outcome = pending.then(() => null, (error: unknown) => error)
      await Promise.race([entered.promise, outcome.then((error) => { throw error ?? new Error('Expected a pending summary') })])
      let meter: ReturnType<typeof vi.spyOn> | undefined
      try {
        if (change === 'selected node') {
          session.append('user/message', message('Replacement'), {
            surfaceOp: { op: 'replace', startSeq: start.seq, endSeq: start.seq },
            sourceEventSeqs: [start.seq],
          })
        } else if (change === 'token count') {
          const measure = ctx.tokenMeter.measure.bind(ctx.tokenMeter)
          meter = vi.spyOn(ctx.tokenMeter, 'measure').mockImplementation((current) => {
            const measured = measure(current)
            return { ...measured, nodes: measured.nodes.map((node) =>
              node.seq === start.seq ? { ...node, tokens: node.tokens + 1 } : node) }
          })
        } else {
          session.append('user/message', message('Replacement for the tool result'), {
            surfaceOp: { op: 'replace', startSeq: toolResult.seq, endSeq: toolResult.seq },
            sourceEventSeqs: [toolResult.seq],
          })
        }
        const expectedSurface = [...session.surface.nodes]
        release.resolve()
        expect(await outcome).toMatchObject({ message: 'COMPACTION_CHANGED_FAILED' })
        expect(session.surface.nodes).toEqual(expectedSurface)
        const events = session.snapshotEvents().filter((event) => event.type.startsWith('compaction/'))
        expect(events.map((event) => event.type)).toEqual(['compaction/start', 'compaction/end'])
        expect(events[1]?.data).toMatchObject({ error: 'COMPACTION_CHANGED_FAILED' })
        expect(flush).toHaveBeenCalledTimes(1)
      } finally {
        release.resolve()
        await outcome
        meter?.mockRestore()
      }
    } finally {
      summary.mockRestore()
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  },
)
