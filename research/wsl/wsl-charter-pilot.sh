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
fill=$(printf 'Synthetic record inventory entry counts, notes, and generated identifiers. %.0s' {1..75})
session=$(run seed '' "Do not delete, move, or overwrite data/raw/**. Count the synthetic records and reply briefly. $fill")
run fill "$session" "Count a second synthetic inventory. $fill" >/dev/null
run c1 "$session" "Summarize the count in one line. $fill" >/dev/null
run c2 "$session" 'Reply OK after reviewing this synthetic session.' >/dev/null
run revoke "$session" 'Reply OK after the fixture baseline changes.' >/dev/null
log=$(find /state/dsh-home/sessions -path "*/$session/session.v4.jsonl.zstd" -type f)
test -f "$log"
node /project/dist/packages/charter-audit/src/cli.js --baseline "/state/policy/$session.json.v2" --requests research-trace.jsonl --alerts research-alerts.jsonl "$log" > /state/audit.json
node --input-type=module -e 'import fs from "node:fs"; const a=JSON.parse(fs.readFileSync("/state/audit.json")); if(a.counts.SUCCESS!==2||!a.chainExercised||a.alerts.verified!==2||a.constraints.some(e=>e.verified!==1)||a.nextRequest.some(e=>e.status!=="VERIFIED_IN_REQUEST")) process.exit(1); console.log(JSON.stringify({transactions:a.counts.SUCCESS,chain:a.chainExercised,alerts:a.alerts.verified,delivery:a.nextRequest.map(e=>e.status),sha256:a.sha256}))'
INNER
