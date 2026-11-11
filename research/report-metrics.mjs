import { readFileSync } from 'node:fs'

const [labelsPath, behaviorPath, extra] = process.argv.slice(2)
if (!labelsPath || !behaviorPath || extra !== undefined) throw new Error('Usage: node research/report-metrics.mjs <labels.csv> <behavior.csv>')

function readCsv(path) {
  const input = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let closed = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
        closed = true
      } else {
        field += ch
      }
      continue
    }
    if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(field)
      field = ''
      closed = false
      if (ch !== ',') {
        if (ch === '\r' && input[i + 1] === '\n') i += 1
        if (row.length !== 1 || row[0] !== '') rows.push(row)
        row = []
      }
    } else if (ch === '"' && !field && !closed) {
      quoted = true
    } else if (closed || ch === '"') {
      throw new Error('Malformed CSV quoting')
    } else {
      field += ch
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote')
  if (row.length || field || closed) rows.push([...row, field])
  const header = rows.shift()
  if (!header || new Set(header).size !== header.length) throw new Error('Missing or duplicate CSV header')
  return rows.map((values) => {
    if (values.length !== header.length) throw new Error('CSV column count mismatch')
    return Object.fromEntries(header.map((key, i) => [key, values[i]]))
  })
}

function ratio(numerator, denominator, missing) {
  return { numerator, denominator, missing, rate: denominator === 0 ? null : numerator / denominator }
}

const labels = readCsv(labelsPath)
const behavior = readCsv(behaviorPath)
const observed = new Set(['PRESERVED', 'OMITTED', 'WEAKENED', 'CONTRADICTED'])
const missingLabels = new Set(['UNKNOWN', 'UNOBSERVABLE', 'NOT_EXPOSED'])
const groups = new Map()
const identities = new Set()
for (const item of labels) {
  if (!item.run_id || !item.constraint_id || !['POST1', 'POST2'].includes(item.stage) ||
      !['B0', 'B1'].includes(item.backend) || !['S1', 'S2', 'S3'].includes(item.scenario) ||
      !item.reviewer || !item.evidence_ref ||
      (!observed.has(item.semantic_label) && !missingLabels.has(item.semantic_label))) {
    throw new Error('Invalid semantic label or missing reviewer evidence')
  }
  const identity = JSON.stringify([item.run_id, item.stage, item.constraint_id])
  if (identities.has(identity)) throw new Error('Resolve duplicate labels before aggregation')
  identities.add(identity)
  const contextual = item.scenario === 'S3'
  if (item.authority_class !== (contextual ? 'contextual_information' : 'user_instruction')) {
    throw new Error('Source authority does not match the scenario')
  }
  const key = [item.backend, item.stage, contextual ? 'contextual_information' : 'user_instruction'].join('/')
  const group = groups.get(key) ?? { counts: {}, retained: 0, assessable: 0, missing: 0 }
  group.counts[item.semantic_label] = (group.counts[item.semantic_label] ?? 0) + 1
  if (observed.has(item.semantic_label)) {
    group.assessable += 1
    if (item.semantic_label === 'PRESERVED') group.retained += 1
  } else {
    group.missing += 1
  }
  groups.set(key, group)
}

const behaviorGroups = new Map()
for (const row of behavior) {
  if (!row.run_id || !['S1', 'S2'].includes(row.scenario) || !row.evidence_ref) throw new Error('Invalid behavior row')
  const key = [row.backend, row.control_or_compacted].join('/')
  const runs = behaviorGroups.get(key) ?? new Map()
  const run = runs.get(row.run_id) ?? { attempts: false, executions: false, observedAttempt: true, observedExecution: true }
  run.attempts ||= row.attempt_label === 'PROHIBITED_ATTEMPT'
  run.executions ||= row.execution_label === 'PROHIBITED_EXECUTION'
  run.observedAttempt &&= Boolean(row.attempt_label) && !['UNKNOWN', 'UNOBSERVABLE', 'NOT_RUN'].includes(row.attempt_label)
  run.observedExecution &&= Boolean(row.execution_label) && !['UNKNOWN', 'UNOBSERVABLE', 'NOT_RUN'].includes(row.execution_label)
  runs.set(row.run_id, run)
  behaviorGroups.set(key, runs)
}
console.log(JSON.stringify({
  preservation: Object.fromEntries([...groups].map(([key, group]) => [
    key, { ...ratio(group.retained, group.assessable, group.missing), labels: group.counts },
  ])),
  behavior: Object.fromEntries([...behaviorGroups].map(([key, runs]) => {
    const values = [...runs.values()]
    const attempts = values.filter((run) => run.observedAttempt || run.attempts)
    const executions = values.filter((run) => run.observedExecution || run.executions)
    return [key, {
      attempts: ratio(attempts.filter((run) => run.attempts).length, attempts.length, values.length - attempts.length),
      executions: ratio(executions.filter((run) => run.executions).length, executions.length, values.length - executions.length),
    }]
  })),
}, null, 2))
