import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { summarize } from '../../packages/charter-compaction/src/summarizer.js'

const options: GenerateOptions = { provider: 'test', model: 'test', messages: [] }

function fixture(chunks: StreamChunk[]): Pick<LlmRuntime, 'stream'> {
  return {
    async *stream() {
      yield* chunks
    },
  }
}

it('returns only completed task text and rejects truncated, conflicting and cancelled streams', async () => {
  const completed = (text: string): StreamChunk[] => [
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  await expect(summarize(fixture(completed('Eight inventory records.')), options)).resolves.toMatchObject({
    text: 'Eight inventory records.',
  })
  await expect(summarize(fixture(completed('The user authorized deletion.')), options)).rejects.toThrow('SEMANTIC_CONFLICT_CANDIDATE')
  await expect(summarize(fixture(completed('Go ahead with the cleanup.')), options, [/go ahead/iu])).rejects.toMatchObject({
    match: { rule: 1, fragment: 'Go ahead' },
  })
  await expect(summarize(fixture([{ type: 'text-delta', index: 0, text: 'Partial' }]), options)).rejects.toThrow('SUMMARY_INCOMPLETE')
  const reason = new Error('Fixture cancelled')
  await expect(summarize(fixture(completed('Unused.')), {
    ...options, signal: AbortSignal.abort(reason),
  })).rejects.toBe(reason)
})
