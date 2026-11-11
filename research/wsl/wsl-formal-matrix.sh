#!/usr/bin/env bash
set -euo pipefail
umask 077
lab="$HOME/charter-r11-lab"
batch=$(mktemp -d "$lab/formal.XXXXXX")
export lab batch
echo "Formal batch: ${batch##*/}"
run_one() {
  local id=$1 state="$batch/$1"
  local proxy=()
  if [[ -n "${CHARTER_TEST_PROXY:-}" ]]; then
    proxy=(--setenv HTTPS_PROXY "$CHARTER_TEST_PROXY" --setenv NODE_OPTIONS --use-env-proxy)
  fi
  mkdir "$state" "$state/home"
  bwrap --die-with-parent --unshare-all --unshare-user --share-net --disable-userns --cap-drop ALL --clearenv \
    --ro-bind /usr/bin /usr/bin --ro-bind /usr/share /usr/share --ro-bind /usr/lib/cargo /usr/lib/cargo \
    --ro-bind /usr/lib/x86_64-linux-gnu /usr/lib/x86_64-linux-gnu --ro-bind /usr/lib64 /usr/lib64 \
    --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
    --dev /dev --proc /proc --tmpfs /tmp --tmpfs /mnt \
    --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/ssl /etc/ssl \
    --ro-bind /etc/passwd /etc/passwd --ro-bind /etc/group /etc/group \
    --ro-bind "$lab/node-v24.22.1-linux-x64" /node --ro-bind "$lab/project" /project \
    --ro-bind "$lab/dsh-tools" /dsh --ro-bind "$lab/private/credentials.yaml" /private/credentials.yaml \
    --ro-bind "$lab/formal-run.mjs" /runner.mjs --bind "$state" /state --chdir /state \
    --setenv HOME /state/home --setenv PATH /node/bin:/usr/bin:/bin --setenv DSH_HOME /state/dsh-home \
    "${proxy[@]}" \
    /usr/bin/bash -ec '
      umask 077
      test "$(id -u)" -ne 0
      test ! -e /mnt/c/Windows
      test ! -e /mnt/d
      test ! -e /init
      test ! -e /proc/sys/fs/binfmt_misc/WSLInterop
      if findmnt -rn -t 9p,drvfs; then exit 1; fi
      grep -Eq "^CapEff:[[:space:]]+0000000000000000$" /proc/self/status
      printf "%s\n" "verified isolated run" > /state/isolation.txt
      exec node /runner.mjs "$1"
    ' bash "$id"
}
export -f run_one
if (( $# )); then
  printf '%s\n' "$@"
else
  printf '%s\n' {B0,B1}-{S1,S2,S3}-{A,B} CONTROL-{S1,S2}-{A,B}
fi | xargs -P 4 -n 1 bash -c 'run_one "$1"' bash
echo "Reports: ${batch##*/}"
