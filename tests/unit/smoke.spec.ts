import { describe, expect, it } from 'vitest'
import { CHARTER_COMPACTION_STATUS } from '../../packages/charter-compaction/src/index.js'

describe('P0 repository smoke test', () => {
  it('does not claim an unverified backend is implemented', () => {
    expect(CHARTER_COMPACTION_STATUS).toBe('BLOCKED_CONTRACT')
  })
})
