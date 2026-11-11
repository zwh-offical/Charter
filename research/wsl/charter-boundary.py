#!/usr/bin/env python3
"""Run untrusted Linux tools with read-only data and a separate operator delete path."""

import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
from uuid import uuid4

DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
PROTECTED = "protected"
SCRATCH = "scratch"
STATE = "host-state"


def layout(root):
    root = root.resolve(strict=True)
    if os.geteuid() == 0 or root.stat().st_uid != os.geteuid() or root.stat().st_mode & 0o077:
        raise ValueError("Use a private workspace owned by the non-root operator")
    for name in (PROTECTED, SCRATCH, STATE):
        info = (root / name).lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError(f"Expected a private, real directory: {name}")
    mount = subprocess.check_output(["findmnt", "-n", "-o", "FSTYPE", "-T", root], text=True).strip()
    if mount not in {"ext4", "xfs", "btrfs", "tmpfs"}:
        raise ValueError("Use a native Linux filesystem inside WSL")
    mounts = json.loads(subprocess.check_output(
        ["findmnt", "--json", "--list", "--output", "TARGET"], text=True))
    targets = [Path(entry["target"]) for entry in mounts["filesystems"]]
    for target in targets:
        if any(target.is_relative_to(root / name) for name in (PROTECTED, SCRATCH, STATE)):
            raise ValueError(f"Unexpected nested mount: {target}")
    return root, targets


def run_tool(root, command, runtime, targets):
    if not command:
        raise ValueError("Supply a command after --")
    runtime = [directory.resolve(strict=True) for directory in runtime]
    for directory in runtime:
        if not directory.is_dir() or root.is_relative_to(directory) or directory.is_relative_to(root):
            raise ValueError("Runtime directories must be separate from the workspace and host state")
    for target in targets:
        if any(target.is_relative_to(directory) for directory in runtime):
            raise ValueError(f"Unexpected runtime mount: {target}")
    for name in (PROTECTED, SCRATCH):
        for directory, _, files in os.walk(root / name, onerror=raise_walk_error):
            for file in files:
                path = Path(directory) / file
                info = path.lstat()
                if not stat.S_ISLNK(info.st_mode) and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
                    raise ValueError(f"Unexpected special or shared file: {path}")
    args = ["bwrap", "--die-with-parent", "--new-session", "--unshare-all", "--unshare-user",
            "--disable-userns", "--cap-drop", "ALL", "--clearenv"]
    for directory in ("/usr/bin", "/usr/lib/x86_64-linux-gnu", "/usr/lib/cargo", "/usr/lib64", "/usr/share",
                      f"/usr/lib/python{sys.version_info.major}.{sys.version_info.minor}"):
        if Path(directory).exists():
            args += ["--ro-bind", directory, directory]
    args += ["--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib",
             "--symlink", "usr/lib64", "/lib64", "--dev", "/dev", "--proc", "/proc",
             "--tmpfs", "/tmp", "--dir", "/workspace",
             "--ro-bind", str(root / PROTECTED), "/workspace/protected",
             "--bind", str(root / SCRATCH), "/workspace/scratch"]
    runtime_bins = []
    for index, directory in enumerate(runtime):
        destination = f"/runtime/{index}"
        args += ["--ro-bind", str(directory), destination]
        runtime_bins.append(destination + "/bin")
    args += ["--remount-ro", "/", "--chdir", "/workspace/scratch",
             "--setenv", "PATH", ":".join([*runtime_bins, "/usr/bin", "/bin"]),
             "--setenv", "HOME", "/workspace/scratch",
             "--", *command]
    return subprocess.run(args, check=False, close_fds=True).returncode


def raise_walk_error(error):
    raise error


class DeleteRejected(ValueError):
    pass


def delete_file(root, value, receipt=None):
    relative = PurePosixPath(value)
    parts = value.split("/")
    if (relative.is_absolute() or len(value) > 512 or
            any(not re.fullmatch(r"[a-z0-9_][a-z0-9_.-]*", part) or part.endswith(".") or
                re.match(r"(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)", part) for part in parts)):
        raise ValueError("Expected a canonical path relative to the protected directory")

    with ExitStack() as stack:
        def open_dir(path, parent=None):
            fd = os.open(path, DIR_FLAGS, dir_fd=parent)
            stack.callback(os.close, fd)
            return fd

        base = open_dir(root)
        state = open_dir(STATE, base)
        fcntl.flock(state, fcntl.LOCK_EX)
        audit = os.open("delete.jsonl", os.O_RDWR | os.O_APPEND | os.O_CREAT |
                        os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=state)
        stack.callback(os.close, audit)
        audit_info = os.fstat(audit)
        if not stat.S_ISREG(audit_info.st_mode) or audit_info.st_nlink != 1:
            raise ValueError("Expected a private regular audit file")
        audit_file = stack.enter_context(os.fdopen(audit, "a+", closefd=False, encoding="utf-8"))
        if receipt:
            audit_file.seek(0)
            for line in audit_file:
                event = json.loads(line)
                prior = event.get("charter", {})
                if prior.get("session") == receipt["session"] and (
                        prior.get("approvalId") == receipt["approvalId"] or
                        prior.get("callId") == receipt["callId"]):
                    raise DeleteRejected("Authorization or request already consumed")
        parent = open_dir(PROTECTED, base)
        for part in parts[:-1]:
            parent = open_dir(part, parent)
        name = parts[-1]
        target = os.open(name, os.O_PATH | os.O_NOFOLLOW, dir_fd=parent)
        stack.callback(os.close, target)
        info = os.fstat(target)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("Expected a regular file with exactly one link")

        operation = {"id": uuid4().hex, "path": value, "operator_uid": os.geteuid(),
                     "device": info.st_dev, "inode": info.st_ino,
                     "approved_at": datetime.now(timezone.utc).isoformat()}
        if receipt:
            operation["charter"] = receipt

        def record(event):
            audit_file.write(json.dumps({**operation, "event": event}) + "\n")
            audit_file.flush()
            os.fsync(audit)

        record("approved")
        os.fsync(state)
        try:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if (current.st_dev, current.st_ino, current.st_nlink) != (info.st_dev, info.st_ino, 1):
                raise OSError("Protected target changed before unlink")
            os.unlink(name, dir_fd=parent)
        except OSError:
            record("unlink_failed")
            raise
        os.fsync(parent)
        record("deleted")


def read_receipt():
    payload = sys.stdin.buffer.read(4097)
    if len(payload) > 4096:
        raise DeleteRejected("Oversized Charter receipt")
    receipt = json.loads(payload)
    if not isinstance(receipt, dict) or set(receipt) != {
            "session", "callId", "callSeq", "approvalId", "approvalSeq", "policyHash", "path"}:
        raise DeleteRejected("Invalid Charter receipt")
    if (not all(isinstance(receipt[key], str) and re.fullmatch(r"[A-Za-z0-9_-]{1,256}", receipt[key])
                for key in ("session", "callId", "approvalId")) or
            not isinstance(receipt["policyHash"], str) or not re.fullmatch("[a-f0-9]{64}", receipt["policyHash"]) or
            not all(type(receipt[key]) is int for key in ("callSeq", "approvalSeq")) or
            not 0 <= receipt["approvalSeq"] < receipt["callSeq"] or not isinstance(receipt["path"], str)):
        raise DeleteRejected("Invalid Charter receipt")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    commands = parser.add_subparsers(dest="action", required=True)
    run = commands.add_parser("run", help="Run an untrusted command inside the isolated workspace")
    run.add_argument("--runtime", action="append", type=Path, default=[],
                     help="Mount an operator-trusted code directory read-only under /runtime (repeatable)")
    run.add_argument("command", nargs=argparse.REMAINDER)
    delete = commands.add_parser("approve-delete", help="Approve and execute one exact deletion as the host operator")
    delete.add_argument("path")
    commands.add_parser("execute-authorized", help="Internal command for the trusted Charter host")
    args = parser.parse_args()
    try:
        root, targets = layout(args.root)
        if args.action == "run":
            command = args.command[1:] if args.command[:1] == ["--"] else args.command
            return run_tool(root, command, args.runtime, targets)
        if args.action == "execute-authorized":
            receipt = read_receipt()
            delete_file(root, receipt["path"], receipt)
        else:
            delete_file(root, args.path)
        return 0
    except DeleteRejected as error:
        print(f"charter-boundary: {error}", file=sys.stderr)
        return 3
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"charter-boundary: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
