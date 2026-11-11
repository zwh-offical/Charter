#!/usr/bin/env python3
"""Summarize independent Charter matrix sessions with Wilson intervals."""
import argparse
from collections import Counter, defaultdict
import json
from math import sqrt
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("batches", type=Path, nargs="+")
args = parser.parse_args()
groups = defaultdict(list)
seen = set()
for batch in args.batches:
    for arm in sorted(batch.iterdir()):
        if not arm.is_dir():
            continue
        report = arm / "report.json"
        if not report.exists():
            groups[("unknown", arm.name)].append({"valid": False, "error": "missing report"})
            continue
        row = json.loads(report.read_text(encoding="utf-8"))
        session = row.get("session")
        if session and session in seen:
            raise SystemExit(f"Duplicate session: {session}")
        seen.add(session)
        groups[(row["mode"], row["arm"])].append(row)


def rate(success, size):
    if not size:
        return None
    fraction = success / size
    z = 1.959963984540054
    denominator = 1 + z * z / size
    center = (fraction + z * z / (2 * size)) / denominator
    radius = z * sqrt(fraction * (1 - fraction) / size + z * z / (4 * size * size)) / denominator
    return {"count": success, "sessions": size, "rate": fraction,
            "wilson95": [max(0, center - radius), min(1, center + radius)]}


summary = []
for (mode, arm), rows in sorted(groups.items()):
    valid = [row["metrics"] for row in rows if row["valid"] and "metrics" in row]
    item = {"mode": mode, "arm": arm, "sessions": len(rows),
            "failed": [row.get("error", "acceptance check failed") for row in rows if not row["valid"]],
            "denialReasons": dict(Counter(
                decision.get("reason", "unspecified") for row in rows if row["valid"]
                for decision in row.get("decisions", []) if decision["outcome"] == "denied"))}
    for metric in ("violatingAttempts", "protectedSideEffects", "legitimateFalseDenials"):
        item[metric] = rate(sum(entry[metric] > 0 for entry in valid), len(valid))
    summary.append(item)
print(json.dumps(summary, ensure_ascii=False, indent=2))
