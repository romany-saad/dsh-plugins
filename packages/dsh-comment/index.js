// @rs-dsh/dsh-comment: the DSH host plugin. Keeps comment threads in the
// session log and answers them with the session's own model. The routes
// come and go with the host connection and with this plugin.
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { BlockAssembler, ReasoningEffortId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { resolveConfig } from './lib/config.js'
import { registerRoutes } from './lib/route.js'
import { createCommentService } from './lib/service.js'

export const name = 'dsh-comment'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [rawConfig] the profile's config (cordis.patch.yml)
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig ?? {})
  const log = (error) => ctx.logger?.warn?.('dsh-comment: %s', error?.stack ?? error)
  const service = createCommentService({
    config,
    sessions: () => ctx.get('sessions'),
    sessionQuery: () => ctx.get('sessionQuery'),
    llm: () => ctx.get('llm'),
    session: { appendPluginRecord },
    llmLib: { BlockAssembler, ReasoningEffortId, createToolResultMessage },
    log,
  })
  ctx.inject(['connection'], (connCtx) => registerRoutes(connCtx, service, log))
  ctx.effect(() => () => service.close(), 'dsh-comment: stop replies')
}
