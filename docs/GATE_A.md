# Gate A status

Updated: 2026-11-09

| Gate | Status | Evidence / blocker |
|---|---|---|
| P0-01 environment isolation | WSL_VERIFIED | Each formal run used a private namespace, non-root UID, zero effective capabilities, and no Windows drive or interop mount. |
| P0-01A repository bootstrap | PASS | TypeScript repository, tests, scripts, and planned directories exist. |
| P0-02 source contract lock | PASS | Official source locked at `dsh-v0.2.2-rc.1` / commit `66491b...`; pinned npm CLI reports the same version; signatures and composed headless profile facts are recorded in `DSH_CONTRACT.md`. |
| P0-03 B0 real baseline | WSL_VERIFIED | Six isolated B0 runs persisted 12 official transactions. |
| P0-04 dynamic context runtime proof | WINDOWS_RUNTIME_VERIFIED | A live callback advanced from V1 to V2 in one process, a second agent had no marker, and an earlier probe verified restoration after B0 compaction. |
| Gate A-1 B1 provider | WSL_VERIFIED | Six isolated B1 runs persisted 12 transactions. Separate B0 runs loaded the official provider. |
| Gate A-2 independent audit | WSL_VERIFIED | The auditor reconstructed all 24 transactions and C1→C2 lineage, then matched 12 B1 alerts and 12 next-request hashes. |

## Safe continuation requirements

1. Preserve this completed batch and obtain independent human semantic sign-off.
2. Repair S2 full-condition retention and S3 second-round fact retention.
3. Repeat with a new batch and record compression-strength differences.

See WSL_RESULTS.md for the isolated results.
