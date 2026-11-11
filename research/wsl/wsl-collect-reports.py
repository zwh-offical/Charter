import hashlib
import json
import pathlib
import sys

root = pathlib.Path.home() / "charter-r11-lab" / sys.argv[1]
reports = []
for file in sorted(root.glob("*/report.json")):
    run = json.loads(file.read_text())
    run["isolationVerified"] = (file.parent / "isolation.txt").is_file()
    run["patchSha256"] = {
        p.stem.removesuffix(".patch"): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(file.parent.glob("*.patch.json"))
    }
    run["fixtureManifestSha256"] = hashlib.sha256((file.parent / "fixture.json").read_bytes()).hexdigest()
    usages = []
    for stage in run["stages"]:
        p = file.parent / (stage["stage"] + ".jsonl")
        if p.is_file():
            for line in p.read_text().splitlines():
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if row.get("type") == "status" and row.get("phase") == "step_end" and isinstance(row.get("usage"), dict):
                    usages.append(row["usage"])
    run["conversationUsage"] = {
        key: sum(value.get(key, 0) for value in usages)
        for key in ("inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens")
    } if usages else None
    reports.append(run)
print(json.dumps({"batch": root.name, "runs": reports}, ensure_ascii=True))
