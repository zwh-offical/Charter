import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'

describe('DSH 0.2.2-rc.1 dynamic context contract', () => {
  it('refreshes one required Charter context from V1 to V2 without duplication', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      let version = 1
      ctx.systemPrompt.context({
        name: 'charter:active-constraints',
        order: 125,
        required: true,
        interpolate: false,
        text: () => `CHARTER_POLICY_SENTINEL_V${version}`,
      })

      const accepted = await ctx.systemPrompt.assemble()
      expect(renderContextSnapshot(accepted)).toContain('CHARTER_POLICY_SENTINEL_V1')

      version = 2
      const refreshed = ctx.systemPrompt.refreshContext(accepted)
      const snapshot = renderContextSnapshot(refreshed)
      expect(snapshot).toContain('CHARTER_POLICY_SENTINEL_V2')
      expect(snapshot).not.toContain('CHARTER_POLICY_SENTINEL_V1')
      expect(refreshed.contexts.filter(entry => entry.name === 'charter:active-constraints')).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('restores a missing required Charter context on refresh', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      ctx.systemPrompt.context({
        name: 'charter:active-constraints',
        order: 125,
        required: true,
        interpolate: false,
        text: 'CHARTER_POLICY_SENTINEL_V1',
      })
      const accepted = await ctx.systemPrompt.assemble()
      accepted.contexts = []

      const restored = ctx.systemPrompt.refreshContext(accepted)
      expect(restored.contexts).toEqual([{
        name: 'charter:active-constraints',
        text: 'CHARTER_POLICY_SENTINEL_V1',
        interpolate: false,
      }])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects duplicate registration instead of injecting the policy twice', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      const contribution = {
        name: 'charter:active-constraints',
        order: 125,
        required: true,
        interpolate: false,
        text: 'CHARTER_POLICY_SENTINEL_V1',
      } as const
      ctx.systemPrompt.context(contribution)
      expect(() => ctx.systemPrompt.context(contribution)).toThrow('already registered')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
