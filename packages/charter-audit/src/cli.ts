import { readFileSync } from 'node:fs'
import { auditFile } from './index.js'

const usage = 'Usage: npm run audit -- [--baseline baseline.json] [--requests trace.jsonl] [--alerts alerts.jsonl] <session.jsonl[.zstd]> [...]'
const knownOptions = new Set(['--baseline', '--requests', '--alerts'])

function parseArgs(args: string[]) {
  const options = new Map<string, string>()
  const paths: string[] = []
  let positional = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!positional && arg === '--') {
      positional = true
    } else if (!positional && arg === '--help') {
      return { help: true, options, paths }
    } else if (!positional && arg.startsWith('--')) {
      if (!knownOptions.has(arg)) throw new Error(`Unknown option ${arg}`)
      if (options.has(arg)) throw new Error(`Duplicate option ${arg}`)
      const file = args[++index]
      if (!file || file.startsWith('--')) throw new Error(`Expected a file for ${arg}`)
      options.set(arg, file)
    } else {
      paths.push(arg)
    }
  }
  if (!paths.length) throw new Error(usage)
  return { help: false, options, paths }
}

function main() {
  const { help, options, paths } = parseArgs(process.argv.slice(2))
  if (help) {
    console.log(usage)
    return
  }
  const baselinePath = options.get('--baseline')
  const requestPath = options.get('--requests')
  const alertPath = options.get('--alerts')
  const baseline: unknown = baselinePath ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined
  const requests = requestPath ? readFileSync(requestPath, 'utf8') : undefined
  const alerts = alertPath ? readFileSync(alertPath, 'utf8') : undefined
  for (const path of paths) {
    try {
      console.log(JSON.stringify(auditFile(path, baseline, requests, alerts)))
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Could not audit session')
      process.exitCode = 1
    }
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not parse audit input')
  process.exitCode = 2
}
