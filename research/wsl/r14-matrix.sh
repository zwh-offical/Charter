#!/usr/bin/env bash
set -euo pipefail
umask 077
lab=${CHARTER_LAB:-"$HOME/charter-r11-lab"}
project=$(realpath "${1:?Pass the built Charter source directory}")
mode=${2:-replay}
[[ "$mode" == replay || "$mode" == live ]]
trial=${CHARTER_TRIAL:-0}
[[ "$trial" =~ ^(0|[1-9][0-9]{0,5})$ ]]
batch=$(mktemp -d "$lab/r14.$mode.XXXXXX")
echo "R14 batch: $batch"
run_one() {
  local arm=$1 state="$batch/$1"
  local net=() credentials=() proxy=() cargo=()
  if [[ -d /usr/lib/cargo ]]; then
    cargo=(--ro-bind /usr/lib/cargo /usr/lib/cargo)
  fi
  local python_lib
  python_lib=$(python3 -c 'import sysconfig; print(sysconfig.get_path("stdlib"))')
  if [[ "$mode" == live ]]; then
    net=(--share-net)
    credentials=(--ro-bind "${CHARTER_TEST_CREDENTIALS:-$lab/private/credentials.yaml}" /private/credentials.yaml)
    if [[ -n "${CHARTER_TEST_PROXY:-}" ]]; then
      proxy=(--setenv HTTPS_PROXY "$CHARTER_TEST_PROXY" --setenv NODE_OPTIONS --use-env-proxy)
    fi
  fi
  mkdir "$state" "$state/home"
  bwrap --die-with-parent --unshare-all --unshare-user "${net[@]}" --disable-userns --cap-drop ALL --clearenv \
    --ro-bind /usr/bin /usr/bin --ro-bind /usr/share /usr/share "${cargo[@]}" \
    --ro-bind /usr/lib/x86_64-linux-gnu /usr/lib/x86_64-linux-gnu --ro-bind /usr/lib64 /usr/lib64 \
    --ro-bind "$python_lib" "$python_lib" \
    --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
    --dev /dev --proc /proc --tmpfs /tmp --tmpfs /mnt \
    --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/ssl /etc/ssl \
    --ro-bind /etc/passwd /etc/passwd --ro-bind /etc/group /etc/group \
    --ro-bind "$lab/node-v24.22.1-linux-x64" /node --ro-bind "$project" /project \
    --ro-bind "$lab/dsh-tools" /dsh "${credentials[@]}" --bind "$state" /state --chdir /state \
    --setenv HOME /state/home --setenv PATH /node/bin:/usr/bin:/bin --setenv DSH_HOME /state/dsh-home \
    --setenv CHARTER_TRIAL "$trial" \
    "${proxy[@]}" /usr/bin/bash -ec '
      umask 077
      test "$(id -u)" -ne 0
      test ! -e /mnt/c/Windows
      test ! -e /init
      test ! -e /proc/sys/fs/binfmt_misc/WSLInterop
      if findmnt -rn -t 9p,drvfs; then exit 1; fi
      grep -Eq "^CapEff:[[:space:]]+0000000000000000$" /proc/self/status
      test "$(/dsh/node_modules/.bin/dsh --version)" = 0.2.2-rc.1
      printf "%s\n" "verified isolated run" > /state/isolation.txt
      if [[ "$1" == replay ]]; then
        printf "version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-r14-replay\n" > /state/mock-credentials.yml
        export DEEPSEEK_API_KEY=synthetic-r14-replay
      fi
      exec node /project/research/wsl/r14-run.mjs "$1" "$2"
    ' bash "$mode" "$arm"
}
export -f run_one
export mode batch lab project trial
shift "$(( $# >= 2 ? 2 : $# ))"
if (( $# )); then
  printf '%s\n' "$@"
else
  printf '%s\n' native r11 native-guard charter-guard
fi | xargs -P 4 -n 1 bash -c 'run_one "$1"' bash
