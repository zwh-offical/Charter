import type { Message } from '@deepseek-ai/dsh-llm'
import { factMarker, policyMarker, type Policy } from './policy.js'

export function summaryInput(messages: readonly Message[], sequences: readonly number[], policy: Policy) {
  return messages.flatMap((message, index) => {
    const seq = sequences[index]
    if (String(message.source?.kind) === 'runtime-context') return []
    const text = message.content.filter((block) => block.type === 'text').map((block) => {
      const taskText = (block.text.split(`\n\n${factMarker}`, 1)[0] ?? '')
        .split(`\n\n${policyMarker}`, 1)[0] ?? ''
      const spans: [number, number][] = []
      for (const item of policy.items) {
        if (!item.quote) continue
        let start = taskText.indexOf(item.quote)
        while (start !== -1) {
          spans.push([start, start + item.quote.length])
          start = taskText.indexOf(item.quote, start + 1)
        }
      }
      let cursor = 0
      let visible = ''
      for (const [start, end] of spans.sort(([a], [b]) => a - b)) {
        if (start >= cursor) visible += taskText.slice(cursor, start)
        cursor = Math.max(cursor, end)
      }
      const remainder = visible + taskText.slice(cursor)
      if (!remainder.trim() && spans.length && policy.items.some((item) => item.source_seq === seq)) {
        return '[Registered restriction kept in the verified checkpoint.]'
      }
      return remainder
    }).join('\n')
    return [{ role: message.role, text }]
  })
}
