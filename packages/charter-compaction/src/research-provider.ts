import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import CharterCompaction, { type CharterConfig } from './index.js'
import { pinConstraint } from './pin.js'
import { renderPolicy } from './policy.js'

/** The live research profile requires a model and scoped prompt service. */
export default class CharterResearchCompaction extends CharterCompaction {
  static override inject = [...CharterCompaction.inject, 'llm', 'systemPrompt', 'sessionPersistence', 'commands']

  constructor(ctx: Context, config: CharterConfig = {}) {
    if (!config.policyDirectory || !config.alertsFile) throw new Error('Research mode requires a private policy directory and alert file')
    const directory = config.policyDirectory
    super(ctx, config)
    if (config.enablePinCommand) {
      ctx.effect(() => ctx.commands.register({
        name: 'charter',
        description: 'Pin an original user constraint with explicit scope',
        recordInput: false,
        handler: async ({ agent, rawInput, signal }) => {
          try {
            return await agent.runMaintenance(async (maintenanceSignal) => {
              AbortSignal.any([signal, maintenanceSignal]).throwIfAborted()
              const policy = pinConstraint(directory, agent.session, rawInput, (candidate) => {
                const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: renderPolicy(candidate) }] })
                if (ctx.tokenMeter.estimateMessage(message) > 2048) throw new Error('POLICY_BUDGET_EXCEEDED')
              })
              return { kind: 'success', text: `Charter baseline ${policy.baseline_version}, ${policy.items.length} active constraints` }
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : ''
            return { kind: 'error', text: /^(?:[A-Z_]+$|Usage:)/.test(message) ? message : 'CHARTER_PIN_FAILED' }
          }
        },
      }))
    }
  }
}
