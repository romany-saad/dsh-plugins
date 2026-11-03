// @rs-dsh/dsh-threads: the DSH host plugin. Keeps comment threads in the
// session log and answers them with the session's own model. The routes
// come and go with the host connection and with this plugin.
import z from '@deepseek-ai/schemastery'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { BlockAssembler, ReasoningEffortId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { MAX_CONFIG, resolveConfig } from './lib/config.js'
import { FILE_TOOL_SCHEMAS, WEB_TOOL_SCHEMAS, fileTools, webTools } from './lib/host-tools.js'
import { registerRoutes } from './lib/route.js'
import { createCommentService } from './lib/service.js'

export const name = 'dsh-threads'

// Host-backed settings update the running config in place.
export const Config = z.object({
  reply: z.object({
    enabled: z.boolean().default(true).volatile(),
    maxTokens: z.natural().min(1).max(MAX_CONFIG.maxTokens).default(8192).volatile(),
    maxRounds: z.natural().min(1).max(MAX_CONFIG.maxRounds).default(5).volatile(),
    timeoutMs: z.natural().min(1).max(MAX_CONFIG.timeoutMs).default(180000).volatile(),
    files: z.boolean().default(true).volatile(),
    web: z.boolean().default(false).volatile(),
  }),
  maxComments: z.natural().min(1).max(MAX_CONFIG.maxComments).default(5).volatile(),
})

// DSH's own packages, loaded only when a tool needs them: ripgrep's path from
// dsh-tool-fs-search, the search and fetch formatting from dsh-tool-web.
const optional = (load) => {
  let promise
  return () => (promise ??= load().catch(() => undefined))
}
const fsSearch = optional(() => import('@deepseek-ai/dsh-tool-fs-search'))
const toolWeb = optional(() => import('@deepseek-ai/dsh-tool-web'))

/**
 * The replier's tools beyond the session, from the services DSH runs now.
 * @param {object} o
 * @param {object} o.config    resolveConfig()
 * @param {(name: string) => object|undefined} o.get   ctx.get
 * @param {() => Promise<object|undefined>} [o.loadSearch]
 * @param {() => Promise<object|undefined>} [o.loadWeb]
 */
export function hostTools({ config, get, loadSearch = fsSearch, loadWeb = toolWeb }) {
  return async ({ cwd }) => {
    const tools = []
    const fs = get('fs')
    if (config.reply.files && fs !== undefined && cwd !== undefined) {
      const search = await loadSearch()
      const subprocess = get('subprocess')
      const canSearch = subprocess !== undefined && typeof search?.resolveRgPath === 'function'
      tools.push({
        schemas: FILE_TOOL_SCHEMAS.filter((t) => canSearch || (t.name !== 'glob' && t.name !== 'grep')),
        run: fileTools({ fs, cwd, ...(canSearch ? { subprocess, rgPath: search.resolveRgPath } : {}) }),
      })
    }
    const web = config.reply.web ? get('web') : undefined
    const format = web === undefined ? undefined : await loadWeb()
    if (typeof format?.formatFetchOutput === 'function' && typeof format?.formatSearchOutput === 'function') {
      tools.push({ schemas: WEB_TOOL_SCHEMAS, run: webTools({ web, format }) })
    }
    return tools
  }
}

/** Resolve plain config or live schema references on each access. */
export function liveConfig(rawConfig) {
  // Volatile schema fields are stable references whose get() returns the latest value.
  const read = (value) => typeof value?.get === 'function' ? value.get() : value
  const current = () => resolveConfig({
    ...(rawConfig ?? {}),
    ...(rawConfig?.reply && { reply: Object.fromEntries(Object.entries(rawConfig.reply).map(([key, value]) => [key, read(value)])) }),
    ...(rawConfig?.maxComments !== undefined && { maxComments: read(rawConfig.maxComments) }),
  })
  current()
  return {
    get reply() { return current().reply },
    get maxComments() { return current().maxComments },
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [rawConfig] the profile's config (cordis.patch.yml)
 */
export function apply(ctx, rawConfig) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  const config = liveConfig(rawConfig)
  const log = (error) => ctx.logger?.warn?.('dsh-threads: %s', error?.stack ?? error)
  const service = createCommentService({
    config,
    sessions: () => ctx.get('sessions'),
    sessionQuery: () => ctx.get('sessionQuery'),
    llm: () => ctx.get('llm'),
    session: { appendPluginRecord },
    llmLib: { BlockAssembler, ReasoningEffortId, createToolResultMessage },
    extraTools: hostTools({ config, get: (name) => ctx.get(name) }),
    log,
  })
  ctx.inject(['connection'], (connCtx) => registerRoutes(connCtx, service, log))
  ctx.effect(() => () => service.close(), 'dsh-threads: stop replies')
}
