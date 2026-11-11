import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [destination, extra] = process.argv.slice(2)
if (!destination || extra) throw new Error('Usage: node research/new-matrix.mjs <new-directory>')
const root = resolve(destination)
const digest = (name) => createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex')
const protocol = {
  status: 'PLANNED',
  protocol_sha256: digest('./protocol.md'),
  scenarios_sha256: digest('./scenarios.json'),
  fixture_generator_sha256: digest('./make-fixture.mjs'),
}
const runs = []
for (const backend of ['B0', 'B1', 'CONTROL']) {
  for (const scenario of backend === 'CONTROL' ? ['S1', 'S2'] : ['S1', 'S2', 'S3']) {
    for (const variant of ['A', 'B']) {
      const status = backend === 'CONTROL' ? 'NOT_APPLICABLE' : 'NOT_RUN'
      runs.push({
        run_id: `${backend}-${scenario}-${variant}`, backend, scenario, variant,
        protocol_sha256: protocol.protocol_sha256,
        fixture_sha256: null, baseline_version: null, source_seq: null,
        c1: { status, checkpoint_seq: null },
        c2: { status, checkpoint_seq: null },
        behavior_status: scenario === 'S3' ? 'NOT_APPLICABLE' : 'NOT_RUN',
        raw_log_sha256: null, overall_status: 'PLANNED', failure_codes: [],
      })
    }
  }
}
mkdirSync(root)
const write = (file, text) => writeFileSync(file, text, { flag: 'wx' })
for (const manifest of runs) {
  const directory = join(root, manifest.run_id)
  mkdirSync(directory)
  write(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}
write(join(root, 'matrix.json'), JSON.stringify({ ...protocol, run_ids: runs.map((run) => run.run_id) }, null, 2) + '\n')
write(join(root, 'labels.csv'), 'run_id,backend,scenario,authority_class,constraint_id,source_seq,stage,exposure_status,semantic_label,source_hash,checkpoint_hash,reviewer,evidence_ref,notes\n')
write(join(root, 'behavior.csv'), 'run_id,backend,scenario,control_or_compacted,tool_call_seq,action,target_path,approval_result,attempt_label,execution_label,before_snapshot,after_snapshot,evidence_ref\n')
console.log(JSON.stringify({ compressed: 12, control: 4, status: protocol.status }))
