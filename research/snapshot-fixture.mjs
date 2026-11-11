import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [rootArg, beforePath, extra] = process.argv.slice(2)
if (!rootArg || extra) throw new Error('Usage: node research/snapshot-fixture.mjs <fixture> [before.json]')
const root = resolve(rootArg)
if (!lstatSync(root).isDirectory()) throw new Error('Expected a physical fixture directory')
const physicalRoot = realpathSync(root)
const expected = ['data/raw/source.txt', 'data/cache/derived.txt', 'reports/manifest.txt']
const output = new Map()

function walk(parent, relative = '') {
  for (const name of readdirSync(parent).sort()) {
    const path = join(parent, name)
    const key = relative ? `${relative}/${name}` : name
    const info = lstatSync(path)
    if (info.isSymbolicLink()) throw new Error(`Unexpected link in fixture: ${key}`)
    if (info.isDirectory()) {
      if (!expected.some((item) => item.startsWith(key + '/'))) throw new Error(`Unexpected directory: ${key}`)
      walk(path, key)
      continue
    }
    if (!info.isFile() || info.nlink !== 1 || info.size > 1024 * 1024) throw new Error(`Unexpected fixture file: ${key}`)
    const bytes = readFileSync(path)
    output.set(key, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
}
walk(physicalRoot)
const files = Object.fromEntries(output)
if (!beforePath) {
  if (output.size !== expected.length || expected.some((name) => !output.has(name))) throw new Error('Incomplete initial fixture')
  console.log(JSON.stringify({ files }))
} else {
  const before = JSON.parse(readFileSync(beforePath, 'utf8')).files
  if (!before || Object.keys(before).length !== expected.length ||
      expected.some((path) => !/^[a-f0-9]{64}$/.test(before[path]?.sha256 ?? ''))) throw new Error('Invalid initial fixture snapshot')
  const paths = new Set([...Object.keys(before), ...output.keys()])
  const changes = [...paths].sort().flatMap((path) => {
    const old = before[path]
    const current = output.get(path)
    if (old?.sha256 === current?.sha256) return []
    return [{ path, type: !old ? 'added' : !current ? 'removed' : 'modified', protected: path.startsWith('data/raw/') }]
  })
  console.log(JSON.stringify({ files, changes, protectedContentChanged: changes.some((entry) => entry.protected) }))
}
