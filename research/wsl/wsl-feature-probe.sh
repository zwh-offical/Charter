#!/usr/bin/env bash
set -euo pipefail
umask 077
lab="$HOME/charter-r11-lab"
state=$(mktemp -d "$lab/isolated-pilot.XXXXXX")
mkdir "$state/fixture" "$state/policy" "$state/home"
echo "Pilot directory: ${state##*/}"
proxy=()
if [[ -n "${CHARTER_TEST_PROXY:-}" ]]; then
  proxy=(--setenv HTTPS_PROXY "$CHARTER_TEST_PROXY" --setenv NODE_OPTIONS --use-env-proxy)
fi
bwrap --die-with-parent --unshare-all --unshare-user --share-net --disable-userns --cap-drop ALL --clearenv \
  --ro-bind /usr/bin /usr/bin --ro-bind /usr/share /usr/share \
  --ro-bind /usr/lib/x86_64-linux-gnu /usr/lib/x86_64-linux-gnu --ro-bind /usr/lib64 /usr/lib64 \
  --ro-bind /usr/lib/cargo /usr/lib/cargo \
  --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --dev /dev --proc /proc --tmpfs /tmp --tmpfs /mnt \
  --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/ssl /etc/ssl \
  --ro-bind /etc/passwd /etc/passwd --ro-bind /etc/group /etc/group \
  --ro-bind "$lab/node-v24.22.1-linux-x64" /node \
  --ro-bind "$lab/project" /project --ro-bind "$lab/dsh-tools" /dsh \
  --ro-bind "$lab/private/credentials.yaml" /private/credentials.yaml \
  --bind "$state" /state --chdir /state/fixture \
  --setenv HOME /state/home --setenv PATH /node/bin:/usr/bin:/bin \
  "${proxy[@]}" \
  --setenv DSH_HOME /state/dsh-home --setenv CHARTER_POLICY_DIRECTORY /state/policy \
  /usr/bin/bash -s <<'INNER'
set -euo pipefail
umask 077
test "$(id -u)" -ne 0
test ! -e /mnt/c/Windows
test ! -e /mnt/d
test ! -e /proc/sys/fs/binfmt_misc/WSLInterop
test ! -e /init
if findmnt -rn -t 9p,drvfs; then exit 1; fi
grep -Eq '^CapEff:[[:space:]]+0000000000000000$' /proc/self/status
printf 'Verified UID=%s, zero capabilities, no Windows drive or interop mount\n' "$(id -u)" | tee /state/isolation.txt
dsh=/dsh/node_modules/.bin/dsh
test "$("$dsh" --version)" = 0.2.2-rc.1
"$dsh" headless --dump-default-config > /state/default.yml
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
const tools = [...readFileSync('/state/default.yml', 'utf8').matchAll(/^\s*- id: (tool-.+|plugin-manager|settings|ptc-runtime|timeout-policy|repeat-tool-reminder)$/gm)]
  .map((match) => match[1].trim()).filter((id) => !['tool-executor-native','tool-executor-ptc'].includes(id))
const config = [
  ...tools.map((id) => ({ id, disabled: true })),
  { id: 'credentials', disabled: false, config: { path: '/private/credentials.yaml', watch: false } },
  { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' } },
  { id: 'llm-deepseek', config: { baseURL: 'https://api.deepseek.com/anthropic' } },
  { id: 'compaction-basic', disabled: true },
  { insert: [
    { id: 'charter-compaction', name: 'file:///project/dist/packages/charter-compaction/src/research-provider.js', config: {
      policyDirectory: '/state/policy', alertsFile: '/state/fixture/research-alerts.jsonl',
    } },
    { id: 'charter-research-driver', name: 'file:///project/research/pilot-driver.mjs' },
  ] },
]
writeFileSync('/state/pilot.patch.json', JSON.stringify(config))
JS
run() {
  local stage=$1 session=$2 prompt=$3
  local opts=()
  if [[ -n "$session" ]]; then opts=(--session-id "$session"); fi
  if ! CHARTER_STAGE="$stage" timeout 180 "$dsh" headless --patch /state/pilot.patch.json --json --permission-mode read-only --approval-policy never "${opts[@]}" "$prompt" > "/state/$stage.jsonl" 2> "/state/$stage.stderr"; then
    tail -10 "/state/$stage.stderr" >&2
    return 1
  fi
  printf '%s completed\n' "$stage" >&2
  node --input-type=module -e 'import fs from "node:fs"; const r=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).findLast(e=>e.type==="final"); if(r?.reason.kind!=="completed") process.exit(1); console.log(r.sessionId)' "/state/$stage.jsonl"
}
fill=$(printf 'Synthetic inventory item with an ordinary generated record identifier. %.0s' {1..90})
session=$(run seed '' "Do not delete raw files. Reply with OK. $fill")
configure() {
  node --input-type=module - "$1" <<'JS'
import fs from 'node:fs'
const file = '/state/pilot.patch.json'
const patch = JSON.parse(fs.readFileSync(file))
const providers = patch.find((item) => item.insert).insert
providers[1].name = 'file:///project/research/wsl/feature-probe.mjs'
providers[0].config.enablePinCommand = true
const threshold = Number(process.argv[2])
if (threshold) providers[0].config.autoThresholdTokens = threshold
else delete providers[0].config.autoThresholdTokens
fs.writeFileSync(file, JSON.stringify(patch))
JS
}
configure 0
run pin "$session" "Reply OK after this synthetic filler. $fill" >/dev/null
configure 1
run pressure "$session" "Reply OK after reading this filler. $fill" >/dev/null
configure 10000000
run interrupted "$session" "Reply OK after this interrupted-compaction test. $fill" >/dev/null
run overflow "$session" 'Reply OK after this final synthetic prompt.' >/dev/null
log=$(find /state/dsh-home/sessions -path "*/$session/session.v4.jsonl.zstd" -type f)
node --input-type=module - "$log" "$session" <<'JS' | tee /state/features-report.json
import fs from 'node:fs'
import zlib from 'node:zlib'
import { auditFile } from '/project/dist/packages/charter-audit/src/index.js'
const [file, session] = process.argv.slice(2)
const policy = JSON.parse(fs.readFileSync('/state/policy/' + session + '.json'))
const result = auditFile(file, policy)
const probes = fs.readFileSync('/state/features.jsonl','utf8').trim().split('\n').map(JSON.parse)
const events = zlib.zstdDecompressSync(fs.readFileSync(file)).toString().trim().split('\n').map(JSON.parse)
const owners = events.filter((e) => e.type === 'compaction/start').map((e) => e.data.turn)
const valid = result.counts.SUCCESS === 2 && result.counts.ERROR === 1 && owners.every(Number.isInteger) && policy.baseline_version === 2 &&
  probes.some((p) => p.type === 'pin' && p.status === 'success') &&
  probes.some((p) => p.type === 'overflow' && p.committed && p.secondSkipped) &&
  probes.some((p) => p.type === 'interruption' && p.stopped && p.unchanged)
console.log(JSON.stringify({ valid, run: session, sha256: result.sha256, owners, probes, audit: result }))
if (!valid) process.exitCode = 1
JS
INNER
