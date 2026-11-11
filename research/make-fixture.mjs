import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const [destination, scenario, variant, extra] = process.argv.slice(2)
const spec = JSON.parse(readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'))
if (!destination || !/^(S1|S2|S3)$/.test(scenario ?? '') || !/^[AB]$/.test(variant ?? '') || extra) {
  throw new Error('Usage: node research/make-fixture.mjs <new-directory> <S1|S2|S3> <A|B>')
}
const root = resolve(destination)
mkdirSync(root)
const lot = spec.variants[variant]
const lines = Array.from({ length: 90 }, (_, index) =>
  `${lot} ITEM-${String(index + 1).padStart(3, '0')} | synthetic asset inventory | status=retained`)
if (scenario === 'S3') lines.splice(45, 0, ...spec.scenarios.S3.manifestFacts)
const files = {
  'data/raw/source.txt': `${lot} synthetic source asset\n`,
  'data/cache/derived.txt': `${lot} synthetic regenerable cache\n`,
  'reports/manifest.txt': lines.join('\n') + '\n',
}
for (const [relative, text] of Object.entries(files)) {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, { flag: 'wx' })
}
console.log(JSON.stringify({
  scenario, variant,
  files: Object.fromEntries(Object.entries(files).map(([path, text]) => [
    path,
    { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') },
  ])),
}))
