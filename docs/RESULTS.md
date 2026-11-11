# Results

## Model-backed B1 Windows pilot

Session `session-e2778647-8984-4fc9-abe2-afe50a4ffa3b` completed C1 and C2 on
`deepseek-official/deepseek-flash` with zero model tools. The raw compressed
log SHA-256 was `6587f8e812f8e3f36f0b53596cec667853cc1ff96cdeaa89b3fadedfae21788a`.

| Observation | C1 | C2 |
| --- | --- | --- |
| Visible surface count | 6 → 4 | 7 → 5 |
| Shadowed sequence positions | 11, 12, 17 | 39, 28, 31 |
| Checkpoint sequence | 39 | 61 |
| Verified original restriction | 1 / 1 | 1 / 1 |
| Matching V2 snapshots in next request | 1 / 1 | 1 / 1 |
| Summary usage, total tokens | 1,177 | 1,257 |

The auditor replayed the descending numeric C2 range by surface position
and linked it through C1 to original user seq 11. After revocation the latest
actual snapshot was V3. Earlier snapshots remained as superseded history.
The auditor matched both post-commit alert hashes against the persisted
checkpoints. See `research/windows-b1-audit.json` and the matching traces.

A separate same-process probe observed V1 and V2 on the first agent and no
markers on either provider call for the second. The final headless prompt
changed runtime metadata and retained multiple historical snapshots.

Earlier pilot attempts exposed startup injection, summary truncation, semantic
candidate rejection, and a post-commit readback error. They are separate from
the successful pilot. The formal sample remains 0 of 16.

## B1 local fixture, 2026-11-09

The built Charter provider mounted in DSH `0.2.2-rc.1` with the native provider
disabled. A fresh B1 session `session-1db95eba-14e3-4d02-8b84-74a5fd5e4ddb`
ran official `/compact`. The model-free excerpt replaced two marked synthetic
messages, reducing the visible history from 3 to 2. The third message survived.

Persisted transaction `7eefad45-ee1b-4a47-a34f-d704ca00c379` had start at 7,
summary at 8, replacement checkpoint at 9, and end at 10. The replacement
shadowed seqs 3 and 4. The compressed session file SHA-256 was
`0ec256bb08632891435cdf25997e1009837b8bcc3db43fb5f684e3c01cbb2545`.
Omitting the B1 overlay in a new session restored `BasicCompactionEngine`.
Both follow-up headless prompts stopped at `MISSING_CREDENTIAL`; the fixture
was intentionally run without the desktop credential store.

Four tests, typecheck, and build passed. Automatic compaction remains
disabled. This run covers the local P1 fixture, with formal Gate A still open.

## Windows live synthetic run, 2026-11-09

The desktop DSH launcher `0.2.2-rc.1` used its official basic compaction
provider and the configured `deepseek-official/deepseek-flash` route.
The run used a separate DSH home and empty fixture, read-only permissions,
disabled approvals, and zero model tools. The existing local credential store
was referenced without copying credentials. This was a Windows host run.
The plan's separate OS environment and test-only credential status were
not established.

Session `session-1d3d0067-1c7b-4b2f-a166-9165c693fc0b` persisted
`session.v4.jsonl.zstd` with SHA-256
`881928af9d23e703d40890409cb796be9e387a7c9ba82d958f02370a79aad622`.
The command ran once the resumed agent was idle. The transaction
`8ce7148a-b868-4201-bcf6-7705636b070f` reduced the surface from 7 to 3
messages. The summary recorded 5 shadowed events and 2,807 estimated tokens.

| Sequence | Persisted event |
| --- | --- |
| 12 | V1 user-role runtime-context snapshot |
| 29 | V2 user-role runtime-context snapshot, superseding earlier snapshots |
| 37 | `compaction/start` with `turn: null` |
| 39 | `compaction/summary` with model call metadata and `shadowedSeqs: [11, 12, 17, 28, 29]` |
| 40 | `user/message` checkpoint with `surfaceOp: { op: 'replace', startSeq: 11, endSeq: 29 }` |
| 41 | `compaction/end` with `turn: null` |
| 51 | Restored V2 user-role runtime-context snapshot |
| 52 | Next model request header |

The provider returned HTTP 200 for the captured requests. The first request
contained V1. The next contained historical V1 followed by V2 in the
superseding runtime-context wrapper. After compaction, only V2 appeared as a
runtime-context snapshot. V1 still appeared as ordinary checkpoint text.
The fixed section marker appeared in the system role and was later mentioned
in the checkpoint. An independent control session had neither marker.
The evidence file retains structural markers, counts, and status only.

The V2 update was applied across headless process resumes. The same-process
callback update and same-process agent isolation remain unverified.

## Windows preflight, 2026-11-09

- Node `24.22.1`, npm `11.9.0`, desktop DSH launcher `0.2.2-rc.1`.
- `npm ci` installed the locked dependencies. All four tests, typecheck, and build
  passed. Vitest required execution outside the restricted shell after it
  reported `spawn EPERM` during test startup.
- The composed headless configuration included the official basic compaction
  provider and JSONL persistence under the isolated `DSH_HOME/sessions`.
- The read-only synthetic headless request exited with status 1 and
  `MISSING_CREDENTIAL` for `deepseek-official`. DSH persisted a
  `session.v4.jsonl.zstd` file with SHA-256
  `3f4f1539efab8e1b91de4002a6ded1009930d8b971f37e735c7f958ce93d07bd`.
  This is evidence of the failed preflight only.
