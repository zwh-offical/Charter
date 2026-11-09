# Charter

Research implementation of a DSH compaction backend with deterministic preservation of operator-confirmed user constraints, pre/post-commit integrity checks, model-visible policy snapshots, and an independent audit pipeline.

Current status: **P0 contract verification in progress; the pinned DSH CLI is runnable through `npx`, but live gates are blocked because no non-production model route is configured.** No compaction capability is claimed yet.

## Commands

```bash
npm ci
npm test
npm run typecheck
```

See `PLAN.md` for the execution protocol and `docs/GATE_A.md` for live gate status.
