// @rs-dsh/dsh-cockpit: the DSH host plugin. Registers the four board
// tools inside ctx.inject(['tools'], …) and the read routes inside
// ctx.inject(['connection'], …), so they come and go with those services and
// with this plugin.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveConfig } from './lib/config.js'
import { presentation } from './lib/present.js'
import { registerRoutes } from './lib/route.js'
import { createStore } from './lib/store.js'
import { RESULT_SPEC, TOOL_SPECS, createBoardTools } from './lib/tools.js'

export const name = 'dsh-cockpit'

const render = (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]

/** The four tool definitions over these bodies; exported for tests. */
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
      // board_read only reads the file, unless it runs the drift command.
      ...(toolName === 'board_read' ? { isConcurrencySafe: (args) => args?.checkDrift !== true } : {}),
      execute: (args, exec) => bodies[toolName](args, exec),
    })
  })
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [rawConfig] the profile's config (cordis.patch.yml)
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig ?? {})
  // $DSH_HOME/data/dsh-cockpit, with the home resolved as the rest of DSH does.
  const dataDir = dshHomePath('data', 'dsh-cockpit')
  // The read routes, owner-only on the host connection (lib/route.js).
  if (config.route.enabled) ctx.inject(['connection'], (connCtx) => registerRoutes(connCtx, { dataDir, config }))
  if (!config.tools.enabled) return
  const store = createStore({ dataDir })
  const bodies = createBoardTools({ store, drift: config.drift, dshHome: resolveDshHome() })
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of createDefinitions(bodies)) toolsCtx.tools.register(definition)
  })
}
