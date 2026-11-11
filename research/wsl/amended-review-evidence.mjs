import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const root = path.join(process.env.HOME, 'charter-r11-lab', process.argv[2])
const sdk = path.join(process.env.HOME, 'charter-r11-lab', 'project-fix', 'node_modules', '@deepseek-ai')
const { Session, SessionId } = await import(pathToFileURL(path.join(sdk, 'dsh-session', 'lib', 'index.js')))
const hash = (value) => createHash('sha256').update(value).digest('hex')
const output = []
for (const id of fs.readdirSync(root).sort()) {
  const dir = path.join(root, id)
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json')))
  if (!report.session) {
    output.push({ runId: id, failures: report.failures })
    continue
  }
  const sessions = path.join(dir, 'dsh-home', 'sessions')
  const file = fs.readdirSync(sessions).map((cwd) => path.join(sessions, cwd, report.session, 'session.v4.jsonl.zstd')).find(fs.existsSync)
  const data = fs.readFileSync(file)
  const rows = zlib.zstdDecompressSync(data).toString().trim().split('\n').map(JSON.parse)
  const bySeq = new Map(rows.map((row) => [row.seq, row]))
  const lastTurn = rows.findLast((row) => row.type === 'turn/start')?.seq
  const behavior = report.observedBehavior ? rows.filter((row) => row.seq > lastTurn && row.type === 'assistant/message').flatMap((row) =>
    row.data.message.content.filter((block) => block.type === 'tool-call').map((block) => ({
      seq: row.seq, tool: block.name, arguments: JSON.parse(block.arguments),
    }))) : []
  const checkpoints = report.audit?.transactions.filter((tx) => tx.status === 'SUCCESS').map((tx) => {
    let officialSurfaceMatches = null
    try {
      const session = Session.create(SessionId(report.session), rows.filter((row) => Number.isInteger(row.seq) && row.seq <= tx.end))
      officialSurfaceMatches = JSON.stringify(session.surface.nodes) === JSON.stringify(tx.after)
    } catch {
      // Raw store encodings may require the host's configured replay projections.
    }
    const relevant = tx.after.filter((seq) => seq !== tx.checkpoint).flatMap((seq) => {
      const row = bySeq.get(seq)
      if (row?.type === 'system/message') return []
      return (row?.data?.content ?? row?.data?.message?.content ?? [])
        .filter((block) => block.type === 'text').flatMap((block) => block.text.split('\n'))
        .filter((line) => /data[/\\](?:raw|cache)|先报告|uncertain|不可替换|派生缓存/i.test(line))
        .map((line) => ({ seq, text: line.slice(0, 500) }))
    })
    return {
      seq: tx.checkpoint,
      shadowed: tx.shadowed,
      surface: tx.after,
      officialSurfaceMatches,
      relevant,
      text: bySeq.get(tx.checkpoint)?.data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    }
  }) ?? []
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'before.json'))).files
  const finalHashes = Object.fromEntries(Object.keys(before).map((file) => {
    const target = path.join(dir, 'fixture', file)
    return [file, fs.existsSync(target) ? hash(fs.readFileSync(target)) : null]
  }))
  let baselineMatchesReconstruction
  if (report.backend === 'B1') {
    const script = path.join(process.env.HOME, 'charter-r11-lab', 'project-fix', 'research', 'propose-baseline.mjs')
    const expected = spawnSync(process.execPath, [script, id, file, String(report.sourceSeq ?? report.toolSourceSeq), '2'], { encoding: 'utf8' })
    const actual = path.join(dir, 'policy', report.session + '.json')
    if (expected.status === 0 && fs.existsSync(actual)) {
      const proposal = JSON.parse(expected.stdout)
      for (const item of [...proposal.items, ...(proposal.facts ?? [])]) item.approved_by_operator = true
      baselineMatchesReconstruction = fs.readFileSync(actual, 'utf8') === JSON.stringify(proposal)
    } else {
      baselineMatchesReconstruction = false
    }
  }
  output.push({
    runId: id,
    logSha256: hash(data),
    originalUserSeq: report.sourceSeq,
    originalToolSeq: report.toolSourceSeq,
    checkpoints,
    behavior,
    beforeHashes: before,
    finalHashes,
    baselineMatchesReconstruction,
  })
}
console.log(JSON.stringify(output))
