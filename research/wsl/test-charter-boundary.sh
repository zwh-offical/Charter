#!/usr/bin/env bash
set -euo pipefail
umask 077
boundary=$(realpath "$(dirname "$0")/charter-boundary.py")
root=$(mktemp -d "${TMPDIR:-/tmp}/charter-boundary.XXXXXX")
mkdir "$root/protected" "$root/scratch" "$root/host-state"
printf 'original\n' > "$root/protected/target.txt"
printf 'preserve sibling\n' > "$root/protected/sibling.txt"
printf 'host only\n' > "$root/host-state/policy.txt"
before=$(sha256sum "$root/protected/target.txt" "$root/protected/sibling.txt" "$root/host-state/policy.txt")

python3 "$boundary" "$root" run --runtime "$(dirname "$boundary")" -- /bin/bash -se -- "$root" <<'PROBE'
deny() {
  if "$@" 2>/dev/null; then
    printf 'BYPASS SUCCEEDED: %s\n' "$*" >&2
    exit 1
  fi
}
test "$(cat /workspace/protected/target.txt)" = original
for tool in rm cp mv ln python3; do command -v "$tool" >/dev/null; done
python3 -c 'from pathlib import Path; assert Path("/workspace/protected/target.txt").read_text() == "original\n"'
test ! -e "$1/host-state/policy.txt"
test ! -e /workspace/host-state
test ! -e /mnt/c
test ! -e /init
test ! -e /proc/sys/fs/binfmt_misc/WSLInterop
grep -Eq '^CapEff:[[:space:]]+0000000000000000$' /proc/self/status
printf 'writable\n' > cache.txt
deny rm /workspace/protected/target.txt
deny bash -c 'printf overwritten > /workspace/protected/target.txt'
deny cp cache.txt /workspace/protected/target.txt
deny mv /workspace/protected/target.txt renamed.txt
deny mv /workspace/protected /workspace/other
deny python3 -c 'import os; os.unlink("/workspace/protected/target.txt")'
deny python3 -c 'from pathlib import Path; Path("/workspace/protected/target.txt").write_text("overwritten")'
deny python3 -c 'import os; os.replace("cache.txt", "/workspace/protected/target.txt")'
deny ln /workspace/protected/target.txt linked.txt
ln -s /workspace/protected/target.txt symlink.txt
deny bash -c 'printf overwritten > symlink.txt'
deny bash -c 'printf tampered >> /runtime/0/charter-boundary.py'
deny bash -c 'printf "%s" '"'"'{"session":"fake","callId":"call","callSeq":10,"approvalId":"approval","approvalSeq":5,"policyHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","path":"target.txt"}'"'"' |
  python3 /runtime/0/charter-boundary.py /workspace execute-authorized'
mv cache.txt renamed.txt
rm renamed.txt symlink.txt
printf 'Blocked 12 bypass attempts. Protected reads and scratch mutations succeeded.\n'
PROBE

test "$before" = "$(sha256sum "$root/protected/target.txt" "$root/protected/sibling.txt" "$root/host-state/policy.txt")"
ln "$root/protected/target.txt" "$root/scratch/existing-link.txt"
if python3 "$boundary" "$root" run -- /bin/true; then
  echo 'Unsafe hard-link layout accepted' >&2
  exit 1
fi
rm -- "$root/scratch/existing-link.txt"
if python3 "$boundary" "$root" approve-delete ../scratch/target.txt; then
  echo 'Unsafe operator path accepted' >&2
  exit 1
fi
python3 "$boundary" "$root" approve-delete target.txt
test ! -e "$root/protected/target.txt"
test "$(cat "$root/protected/sibling.txt")" = 'preserve sibling'
python3 - "$root/host-state/delete.jsonl" <<'PYTHON'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as audit:
    approved, deleted = map(json.loads, audit)
assert approved.pop("event") == "approved"
assert deleted.pop("event") == "deleted"
assert approved == deleted and approved["path"] == "target.txt"
PYTHON
printf 'Operator deleted exactly the approved file. Audit matched. Fixture: %s\n' "$root"
if (( $# )); then
  test "$#" -eq 2
  version=$(python3 "$boundary" "$root" run --runtime "$1" --runtime "$2" -- /runtime/1/node_modules/.bin/dsh --version)
  test "$version" = 0.2.2-rc.1
  printf 'DSH %s launched inside the same isolation profile.\n' "$version"
fi
