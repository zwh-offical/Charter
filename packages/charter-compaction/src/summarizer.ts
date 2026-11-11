import { BlockAssembler, type ContentBlock, type GenerateOptions, type LlmRuntime, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { findPermissionClaim } from './policy.js'

export class SummaryConflict extends Error {
  constructor(readonly match: NonNullable<ReturnType<typeof findPermissionClaim>>) {
    super('SEMANTIC_CONFLICT_CANDIDATE')
  }
}

export interface Summary {
  text: string
  rawOutput: ContentBlock[]
  usage?: TokenUsage
}

export async function summarize(llm: Pick<LlmRuntime, 'stream'>, options: GenerateOptions, rules?: readonly RegExp[]): Promise<Summary> {
  options.signal?.throwIfAborted()
  const assembler = new BlockAssembler()
  let ended = false
  for await (const chunk of llm.stream(options)) {
    options.signal?.throwIfAborted()
    assembler.push(chunk)
    if (chunk.type === 'finish') ended = true
  }
  options.signal?.throwIfAborted()
  if (!ended || assembler.finish.kind !== 'stop') throw new Error('SUMMARY_INCOMPLETE')
  const rawOutput = assembler.blocks()
  if (rawOutput.some((block) => block.type !== 'text' && block.type !== 'reasoning')) throw new Error('UNSUPPORTED_SUMMARY_BLOCK')
  const text = rawOutput.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim()
  if (!text) throw new Error('EMPTY_SUMMARY')
  const conflict = findPermissionClaim(text, rules)
  if (conflict) throw new SummaryConflict(conflict)
  return { text, rawOutput, ...(assembler.usage === undefined ? {} : { usage: assembler.usage }) }
}
