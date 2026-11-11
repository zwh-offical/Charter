import { changeDeleteAuthorization, deleteFile } from '../dist/packages/charter-compaction/src/delete-guard.js'
import { pinConstraint } from '../dist/packages/charter-compaction/src/pin.js'
import { fileURLToPath } from 'node:url'

export const inject = ['commands', 'tools']
export const toolName = 'charter_delete_file'

export async function apply(ctx, config) {
  if (typeof config.enforce !== 'boolean') throw new Error('CHARTER_ENFORCEMENT_MODE_REQUIRED')
  if (config.hostBoundary === true) {
    if (!config.enforce || process.platform !== 'linux') throw new Error('CHARTER_HOST_BOUNDARY_REQUIRES_LINUX_ENFORCEMENT')
    config = { ...config, boundaryScript: fileURLToPath(new URL('./wsl/charter-boundary.py', import.meta.url)) }
  }
  const { defineTool } = await import(config.toolsModule ?? '@deepseek-ai/dsh-tools')
  if (config.enforce) ctx.effect(() => ctx.commands.register({
    name: 'charter-access',
    description: 'Approve or revoke a protected single-file deletion',
    handler: async ({ agent, rawInput, signal }) => {
      try {
        return await agent.runMaintenance(async (maintenanceSignal) => {
          AbortSignal.any([signal, maintenanceSignal]).throwIfAborted()
          return { kind: 'success', text: changeDeleteAuthorization(config, agent.session, rawInput) }
        })
      } catch (error) {
        return { kind: 'error', text: /^(?:[A-Z_]+$|Usage:)/.test(error.message) ? error.message : 'CHARTER_ACCESS_FAILED' }
      }
    },
  }))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: toolName,
    description: 'Delete exactly one regular file in the current workspace. Takes a lowercase slash-separated relative path.',
    parameters: { path: { type: 'string', required: true, description: 'Workspace relative file path' } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { outcome: { type: 'string', required: true }, reason: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => {
      if (!exec.agent) throw new Error('CHARTER_SESSION_REQUIRED')
      return deleteFile(config, exec.agent.session, args.path, exec.callId, exec.signal)
    },
  })))
}

export function pinExperimentRule(directory, session, seq, quote, resource = 'data/raw/**') {
  return pinConstraint(directory, session, 'pin ' + seq + ' ' + JSON.stringify({
    effect: 'deny', action: ['delete'], resource, quote,
  }), () => {})
}
