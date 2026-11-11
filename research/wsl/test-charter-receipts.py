#!/usr/bin/env python3
"""Adversarial tests for the trusted host executor using synthetic files."""
import json
import os
import resource
from pathlib import Path
import subprocess
import sys
import tempfile

script = Path(__file__).with_name("charter-boundary.py")
with tempfile.TemporaryDirectory(prefix="charter-receipt-") as temporary:
    root = Path(temporary)
    for name in ("protected", "scratch", "host-state"):
        (root / name).mkdir(mode=0o700)
    target = root / "protected/target.txt"
    audit = root / "host-state/delete.jsonl"
    receipt = {"session": "fixture", "callId": "call-1", "callSeq": 10,
               "approvalId": "approval-1", "approvalSeq": 5, "policyHash": "a" * 64, "path": "target.txt"}
    cmd = [sys.executable, str(script), str(root), "execute-authorized"]

    def execute(value):
        return subprocess.run(cmd, input=json.dumps(value), text=True, capture_output=True)

    target.write_text("keep", encoding="utf-8")
    audit.symlink_to("/dev/full")
    assert execute(receipt).returncode != 0 and target.read_text() == "keep"
    audit.unlink()
    write_failure = subprocess.run(cmd, input=json.dumps(receipt), text=True, capture_output=True,
                                   preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0)))
    assert write_failure.returncode != 0 and target.read_text() == "keep"
    assert execute({**receipt, "callSeq": 4}).returncode != 0 and target.exists()
    children = [subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                for _ in range(2)]
    for child in children:
        child.stdin.write(json.dumps(receipt).encode())
        child.stdin.close()
    assert sorted(child.wait(timeout=10) for child in children) == [0, 3] and not target.exists()
    records = [json.loads(line) for line in audit.read_text().splitlines()]
    assert [row["event"] for row in records] == ["approved", "deleted"]
    target.write_text("replacement", encoding="utf-8")
    assert execute({**receipt, "callId": "call-2", "callSeq": 11}).returncode == 3 and target.exists()
    # Kill the executor at unlink, after it has flushed its intent.
    crash_receipt = {**receipt, "callId": "crash-call", "approvalId": "crash-approval"}
    crash_hook = """
import os, runpy, signal, sys
os.unlink = lambda *args, **kwargs: os.kill(os.getpid(), signal.SIGKILL)
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name="__main__")
"""
    crashed = subprocess.run([sys.executable, "-c", crash_hook, *cmd[1:]],
                             input=json.dumps(crash_receipt), text=True, capture_output=True)
    assert crashed.returncode == -9
    assert json.loads(audit.read_text().splitlines()[-1])["event"] == "approved"
    assert execute(crash_receipt).returncode == 3 and target.read_text() == "replacement"
    # A corrupt ledger must never be mistaken for an empty one.
    audit.write_text('{"event":', encoding="utf-8")
    assert execute({**receipt, "approvalId": "approval-2"}).returncode != 0 and target.exists()
print("PASS: audit write admission, invalid chronology, concurrent attempts, replay, interrupted intent, corrupt ledger")
