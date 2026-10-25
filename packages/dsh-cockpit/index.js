// @romany-saad/dsh-cockpit: the DSH host plugin. Registers the four board
// tools inside ctx.inject(['tools'], …), as dsh-plugin-subscriptions does.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveConfig } from './lib/config.js'
import { createStore } from './lib/store.js'
import { RESULT_SPEC, TOOL_SPECS, createBoardTools } from './lib/tools.js'
import { registerRoutes } from './lib/route.js'
import { presentation } from './lib/present.js'

export const name = 'dsh-cockpit'

const render = (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]

/** Build the four tool definitions; exported for tests. */
export function createDefinitions(bodies) {
  return Object.entries(TOOL_SPECS).map(([toolName, spec]) => {
    const { presentCall, presentResult, presentationMeta } = presentation(toolName)
    return defineTool({
      name: toolName,
      description: spec.description,
      parameters: spec.parameters,
      output: { schema: RESULT_SPEC, render, presentationMeta },
      presentCall,
      presentResult,
      ...(toolName === 'board_read' ? { isConcurrencySafe: (args) => !args.checkDrift } : {}),
      execute: (args, exec) => bodies[toolName](args, exec),
    })
  })
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  const dataDir = config.dataDir ?? dshHomePath('data', 'dsh-cockpit')
  const store = createStore({ dataDir })
  if (rawConfig.route?.enabled !== false) ctx.inject(['connection'], (connCtx) => registerRoutes(connCtx, dataDir))
  const bodies = createBoardTools({ store, config, dshHome: resolveDshHome() })
  if (!config.tools.enabled) return
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of createDefinitions(bodies)) toolsCtx.tools.register(definition)
  })
}
