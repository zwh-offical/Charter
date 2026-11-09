# DSH contract lock

Status: **source verified / runtime not verified**  
Locked release: `dsh-v0.2.2-rc.1`  
Commit: `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`  
Captured: 2026-11-09

This document records public interfaces from the exact locked source and the pinned npm CLI. It does not claim that a model route or real compaction has been exercised.

## Source integrity

| File | SHA-256 |
|---|---|
| `packages/compaction/compaction/src/index.ts` | `1d50528c7daf5950e79d7edb2fabca48da6682fc536e911c9f64e4d0bdea4ba1` |
| `packages/compaction/compaction/src/types.ts` | `af47584231f20be810e5d1f354f5f23d1a02995c454b4d2027070b502eae1e22` |
| `packages/core/system-prompt/src/index.ts` | `1c12dce4d2781be211695b199560602fa2fc7cc86f68672e656ea61d1ceda1a9` |

## CompactionEngine

The locked source exports these exact abstract operations:

```ts
abstract compactIfNeeded(
  agent: CompactionAgentContext,
  trigger: 'pressure' | 'context-overflow',
  signal: AbortSignal,
): Promise<CompactionResult | null>

abstract compactNow(
  agent: ManualCompactAgentContext,
  signal: AbortSignal,
  sourceCommandId?: CommandId,
): Promise<CompactionResult | null>

abstract compactRegion(
  start: SessionSeq,
  end: SessionSeq,
  agent: CompactionAgentContext,
  signal?: AbortSignal,
): Promise<CompactionResult>
```

`ManualCompactAgentContext` adds `runMaintenance<T>(task)` and is the required idle-session serialization seam. A context must load exactly one `ctx.compaction` provider.

## Durable transaction and checkpoint

A successful transaction is contractually ordered as:

1. `compaction/start` (log-only lock marker);
2. `compaction/summary` (log-only summary facts);
3. adjacent replacement `user/message` with `surfaceOp: { op: 'replace', startSeq, endSeq }` and `compactCheckpointSource(compactionId, sourceCommandId?)`;
4. `compaction/end` (log-only lock release).

The same `compactionId` correlates the bracket, summary, and checkpoint. `compactNow` uses `turn: null`; automatic and explicit-region operations use their numeric open-turn owner. A crash can leave an observable orphan `start`; code must not synthesize a false successful `end`.

`CompactionResult` contains `startSeq`, `summarySeq`, `endSeq`, `summary`, `shadowedRange`, `shadowedSeqs`, and `shadowedTokenCount`. `shadowedRange` is a surface-position boundary pair; after replacements its numeric `start` may exceed numeric `end`. `shadowedSeqs` is authoritative and remains in surface order.

## Surface and pairing

`Session.deriveMessages()` returns the derived visible messages. The raw shadowed events remain durable but disappear from derived history after replacement. Range selection must resolve endpoints against current surface position, not numeric sequence order. The package exports `toolPairingBalancedBefore` and `toolPairingBalancedAfter`; both range edges must be balanced.

The pinned headless profile composes `@deepseek-ai/dsh-session-persistence-jsonl` with its root at `DSH_HOME/sessions`. A live artifact, raw codec observation, and exact projection comparison remain `NOT_VERIFIED` until a configured model session is available.

## LLM seam

A model-backed backend uses `ctx.llm.stream()` and must forward the supplied abort signal through `GenerateOptions.signal`. The locked contract records provider, model, optional maxTokens/usage, raw output, and whether the summary is tied to an `llm.stream()` call. Exact route configuration and credentials are `NOT_VERIFIED`.

## Dynamic model context

`ctx.systemPrompt.context()` accepts `{ name, order, text, interpolate?, required? }` and returns a disposer. Text may be static or a callback evaluated at assembly/admission refresh. It materializes as a durable user-role snapshot after retained model history and is refreshed when changed or removed by compaction. Scoped registrations shadow global entries of the same name.

`ctx.systemPrompt.section()` uses the same scoped registration model for system-prompt sections. Charter intends to use one scoped dynamic context for verified user constraints and, if needed, one fixed section only to describe authorization provenance.

The following are source-supported but still require P0-04 runtime evidence: agent-scope isolation in the selected preset, V1→V2 replacement without a stale current snapshot, restoration after real compaction, and presence in the actual next model request.

## Configuration and CLI

- Locked source requires Node `>=24.9.0`; the environment has `v24.22.1`.
- The source workspace uses pnpm `11.28.5`.
- The pinned npm distribution runs as `npx @deepseek-ai/dsh@0.2.2-rc.1`; `--version` reports `0.2.2-rc.1`, launcher help is captured, and the headless composed config includes `@deepseek-ai/dsh-compaction-basic` plus JSONL persistence under `DSH_HOME/sessions`.
- B0 transaction shape and live prompt delivery remain `NOT_VERIFIED` because no non-production model route is configured.

## Gate conclusion

Source-level compatibility is plausible. Gate A remains blocked until P0-03 and P0-04 produce real persisted evidence. No B1 transaction code should be treated as ready before that evidence exists.
