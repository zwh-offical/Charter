# Charter P0 handoff

Source and CLI pinned to DSH 0.2.2-rc.1 (66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db).

Current implementation consists of repository scaffolding and three dynamic-context contract tests plus one smoke test. The B1 compaction backend and independent auditor remain placeholders.

Validation: 4 tests passed; TypeScript typecheck passed.

A real isolated headless session failed with MISSING_CREDENTIAL for deepseek-official. P0-03 real B0 compaction and P0-04 actual model-input verification remain blocked pending a non-production model credential. Configure credentials securely; do not place secrets in this repository.

Next: complete P0-03/P0-04 before implementing B1. See PLAN.md and docs/GATE_A.md.
