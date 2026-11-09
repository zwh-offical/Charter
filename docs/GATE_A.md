# Gate A status

Updated: 2026-11-09

| Gate | Status | Evidence / blocker |
|---|---|---|
| P0-01 environment isolation | PASS | Managed isolated workspace; `/workspace` is the only durable writable root; no production project or secrets configured. |
| P0-01A repository bootstrap | PASS | TypeScript repository, tests, scripts, and planned directories exist. |
| P0-02 source contract lock | PASS | Official source locked at `dsh-v0.2.2-rc.1` / commit `66491b...`; pinned npm CLI reports the same version; signatures and composed headless profile facts are recorded in `DSH_CONTRACT.md`. |
| P0-03 B0 real baseline | BLOCKED_CONTRACT | Pinned CLI and isolated JSONL session root are available, but no non-production model route is configured for a real summary request. |
| P0-04 dynamic context runtime proof | BLOCKED_PROMPT_SCOPE | Source supports scoped dynamic context, but there is no configured DSH agent/model request from which to capture actual-input evidence. |
| Gate A-1 B1 provider | NOT_STARTED | Intentionally deferred until P0 runtime gates pass. |
| Gate A-2 independent audit | NOT_STARTED | Depends on real B0/B1 logs. |

## Safe continuation requirements

1. Configure a non-production model route in the isolated DSH profile without sharing credentials in chat.
2. Run a synthetic B0 session and preserve the start/summary/replacement/end evidence from the isolated JSONL store.
3. Run sentinel V1, update to V2, compact, and inspect the next actual model request for scope, freshness, and restoration.

Until then, the repository must report `BLOCKED_CONTRACT`; a placeholder cannot be described as a working compaction backend.
