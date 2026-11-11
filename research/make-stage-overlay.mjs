import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const [runId, stage, privateDir, extra] = process.argv.slice(2)
const run = /^(B0|B1|CONTROL)-S[123]-[AB]$/.exec(runId ?? '')
if (!run || !['bootstrap', 'c1', 'c2'].includes(stage) || !privateDir || extra) {
  throw new Error('Usage: node research/make-stage-overlay.mjs <run-id> <bootstrap|c1|c2> <existing-private-dir>')
}
if (run[1] === 'CONTROL' && stage !== 'bootstrap') throw new Error('Controls are not compacted')
const directory = resolve(privateDir)
if (!existsSync(directory)) throw new Error('Create the private run directory first')
const policyDirectory = resolve(directory, 'policy')
if (run[1] === 'B1' && !existsSync(policyDirectory)) throw new Error('Create the private policy directory first')
const driver = new URL('./formal-driver.mjs', import.meta.url)
const provider = new URL('../dist/packages/charter-compaction/src/research-provider.js', import.meta.url)
if (run[1] === 'B1' && !existsSync(provider)) throw new Error('Build Charter before composing B1')
const insert = [
  { id: 'charter-formal-driver', name: driver.href, config: { runId, stage, policyDirectory, journal: resolve(directory, 'journal.jsonl') } },
]
const patch = run[1] === 'B1'
  ? { id: 'compaction-basic', disabled: true }
  : { id: 'compaction-basic', config: { auto: false } }
if (run[1] === 'B1') insert.unshift({
  id: 'charter-compaction',
  name: provider.href,
  config: { policyDirectory, alertsFile: resolve(directory, 'alerts.jsonl') },
})
console.log(JSON.stringify([patch, { insert }], null, 2))
