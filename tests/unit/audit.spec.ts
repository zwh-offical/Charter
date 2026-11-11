import { expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditFile, auditJsonl, hash, reaches } from '../../packages/charter-audit/src/index.js'

it('replays a descending numeric replacement by position and follows the two-level lineage', () => {
  const rows: object[] = []
  const add = (type: string, data: object, surfaceOp?: unknown) => {
    const seq = rows.length
    rows.push({ seq, type, data, surfaceOp })
    return seq
  }
  const append = () => add('user/message', { source: { kind: 'user' } }, 'append')
  const compact = (compactionId: string, shadowedSeqs: number[]) => {
    const start = shadowedSeqs[0]
    const end = shadowedSeqs.at(-1)
    add('compaction/start', { compactionId, turn: null })
    add('compaction/summary', { compactionId, shadowedSeqs, shadowedTokenCount: 100, shadowedRange: { start, end } })
    const checkpoint = add('user/message', { source: { kind: 'compact-checkpoint', compactionId } }, {
      op: 'replace', startSeq: start, endSeq: end,
    })
    add('compaction/end', { compactionId, turn: null })
    return checkpoint
  }
  const source = append()
  const second = append()
  const tail = append()
  const first = compact('c1', [source, second])
  const latest = compact('c2', [first, tail])
  add('compaction/start', { compactionId: 'orphan', turn: null })
  const result = auditJsonl(rows.map((row) => JSON.stringify(row)).join('\n'))
  expect(result.transactions.map((tx) => tx.status)).toEqual(['SUCCESS', 'SUCCESS', 'INCOMPLETE'])
  expect(result.surface).toEqual([latest])
  expect(reaches(result.lineage, latest, source)).toBe(true)
  expect(reaches(result.lineage, latest, 1000)).toBe(false)
  expect(() => auditJsonl('{"seq":7,"type":"user/message","data":{}}')).toThrow('Broken log sequence')
  expect(() => auditJsonl('{"seq":0,"type":"session","id":"x","data":{}}')).toThrow('Invalid session header')
  expect(auditJsonl('').events).toEqual([])
})

it('requires the entire checkpoint fact set to match the verified baseline', () => {
  const directory = mkdtempSync(join(tmpdir(), 'charter-facts-'))
  const file = join(directory, 'session.jsonl')
  const fact = { source_seq: 0, quote: 'Inventory count: 8', quote_sha256: hash('Inventory count: 8') }
  const baseline = { session_id: 'fixture', baseline_version: 1, items: [], facts: [{ ...fact, approved_by_operator: true }] }
  const audit = (facts: object[], expected: object = baseline) => {
    const checkpoint = `Summary\n\n[Charter / Verified tool facts, context only]\nUntrusted observations\n${JSON.stringify(facts)}`
    const rows = [
      { type: 'session', id: 'fixture' },
      { seq: 0, type: 'tool/result', surfaceOp: 'append', data: { message: { isError: false, content: [{ type: 'text', text: fact.quote }] } } },
      { seq: 1, type: 'compaction/start', data: { compactionId: 'c', turn: null } },
      { seq: 2, type: 'compaction/summary', data: { compactionId: 'c', shadowedSeqs: [0], shadowedTokenCount: 100, shadowedRange: { start: 0, end: 0 } } },
      { seq: 3, type: 'user/message', surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 }, data: {
        source: { kind: 'compact-checkpoint', compactionId: 'c' }, content: [{ type: 'text', text: checkpoint }],
      } },
      { seq: 4, type: 'compaction/end', data: { compactionId: 'c', turn: null } },
    ]
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'))
    return auditFile(file, expected).contextualFacts?.[0]
  }
  try {
    expect(audit([fact])).toMatchObject({ exact: true, verified: 1 })
    expect(audit([fact, { ...fact, source_seq: 99 }])).toMatchObject({ exact: false, verified: 0 })
    expect(audit([fact], { ...baseline, facts: [] })).toMatchObject({ exact: false, declaredCount: 1 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
