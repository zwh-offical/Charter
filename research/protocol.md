# Charter r11 experimental protocol

This protocol includes the S2 and S3 amendments. The Windows and WSL pilots
are separate from the amended full batch.

## Matrix

Run the same six S1–S3/A–B fixtures on B0 and B1. Run the four S1/S2 A–B
controls without compaction. Each session has its own fixture directory, DSH
session ID, and run manifest. The unit of observation is a session. C1 and C2
are paired observations within it.

For each fixture, record the output of
`node research/make-fixture.mjs <new-directory> <scenario> <variant>`. The
generator refuses an existing destination. For S3 use an actual read tool and
identify the returned manifest lines in the persisted tool result. A tool
result is contextual information and is excluded from the authority baseline.

`node research/new-matrix.mjs <new-directory>` writes 16 empty run manifests,
the protocol and fixture hashes, and the two labeling templates. Their
`PLANNED` states are not evidence. Use `snapshot-fixture.mjs <fixture>` before
behavior and `snapshot-fixture.mjs <fixture> <before.json>` afterward. The
comparison reads files without modifying the fixture. Once human labels are
resolved, run `node research/report-metrics.mjs labels.csv behavior.csv` to
aggregate per-stage preservation and per-session behavior with missing counts.

## Order and recording

1. Confirm OS isolation, dedicated route, pinned DSH version, preset, fixture
   hash and model parameters. Keep the operator baseline outside the Agent's
   writable roots. Record any budget or coverage restriction before freezing.
2. Start a new session. For B1 S1/S2, read the actual source sequence from the
   log and have the operator verify the original quote, hash, action and
   resource. For B1 S3 keep the authorization list empty and register only
   the two verified contextual facts from the original successful tool result.
   B0 and controls receive no Charter sidecar.
3. Apply the same frozen F1 fill, trigger manual C1 and record the persisted
   transaction and current surface. Apply F2 and repeat for C2. Record whether
   the second transaction actually shadows the first checkpoint. Keep attempts,
   failures, and unobservable samples in the matrix.
4. Run the S1/S2 behavior prompt only with disposable synthetic files in the
   verified isolated environment. Save tool attempts, approvals and before/after
   file hashes separately. S3 has no destructive behavior probe.
5. Seal raw artifacts under the ignored run directory and record their hashes.
   Independently audit the log and verify selected facts against the official
   projection and actual model requests. Human reviewers label preservation,
   weakening, contradiction and ambiguity. Record all denominators and
   missing evidence, as well as compression strength and provider usage.

The B1 condition includes verified synthetic registrations. The runner
checks the fixed fixtures against the actual raw sources before setting the
approval flag. This is scripted verification. Treat the comparison as
system-level. Do not pool pilot observations into the formal matrix or
infer execution from model text alone.

After building, `node research/propose-baseline.mjs <B1-run-id> <log> <source-seq|none> <version>`
prints a proposal from the actual raw log. The operator must verify it,
set approval explicitly, and atomically install it as `<session-id>.json`
in the private policy directory. B1 rejects unapproved active entries.

`make-stage-overlay.mjs` composes the pinned headless driver for a fresh
`bootstrap` or an existing session's `c1` or `c2`. Use the same isolated
`DSH_HOME`, fixture directory, dedicated API and approved profile in each
invocation. Keep the run directory and its `policy` subdirectory outside the
agent's writable tree. Use read-only permission for bootstrap, F1, F2 and
compaction. The driver invokes the official command after the agent becomes
idle, records the result, and lets the positional headless task generate the
next actual request. The control overlay disables B0 auto compaction and
refuses manual C1 or C2.
