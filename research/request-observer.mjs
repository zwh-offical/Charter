import { createHash } from 'node:crypto'

/** Observe structured markers at the real provider transport without retaining request bodies or headers. */
export function observeDeepSeekRequests(ctx, record, requireNoTools = false) {
  const upstream = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.href)
    if (url.origin !== 'https://api.deepseek.com' || !url.pathname.endsWith('/messages')) return upstream(input, init)
    const body = JSON.parse(init.body)
    const tools = body.tools?.length ?? 0
    if (requireNoTools && tools !== 0) throw new Error('PILOT_TOOL_CATALOG_NONEMPTY')
    const snapshots = []
    const factBlocks = []
    for (const message of body.messages) {
      if (message.role !== 'user') continue
      const blocks = Array.isArray(message.content) ? message.content : [{ text: message.content }]
      for (const block of blocks) {
        for (const fact of block.text?.matchAll(/^\[Charter \/ Verified tool facts, context only\]\n[^\n]+\n\[[^\n]*\]/gm) ?? []) {
          factBlocks.push(createHash('sha256').update(fact[0]).digest('hex'))
        }
        if (!block.text?.startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')) continue
        for (const snapshot of block.text.matchAll(/\[Charter \/ Active verified user constraints\]\nBaseline: (\d+)\n[^\n]+\n\[[^\n]*\]/g)) {
          snapshots.push({
            version: Number(snapshot[1]),
            sha256: createHash('sha256').update(snapshot[0]).digest('hex'),
          })
        }
      }
    }
    const response = await upstream(input, init)
    record({ type: 'request', status: response.status, model: body.model, tools, snapshots, factBlocks })
    return response
  }
  ctx.on('dispose', () => { globalThis.fetch = upstream })
}
