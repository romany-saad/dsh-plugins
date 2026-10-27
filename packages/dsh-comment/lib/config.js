// Plugin config and its defaults. A profile patch with this plugin's id
// replaces the whole config, so every field has its default here.
export const DEFAULT_CONFIG = {
  reply: {
    enabled: true,
    maxTokens: 8192, //   output tokens per model call, reasoning included
    maxRounds: 5, //      model calls per reply; tools are offered on all but the last
    timeoutMs: 180000, // for the whole reply
  },
  maxComments: 5, //      comments from you per thread, the first one included
}

const fail = (path, want, got) => {
  throw new Error(`dsh-comment: ${path} must be ${want}, got ${JSON.stringify(got)}`)
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function positive(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail(path, 'a whole number of at least 1', value)
  return value
}

/** The resolved config; an unknown or mistyped key fails instead of being ignored. */
export function resolveConfig(config = {}) {
  if (!isObject(config)) fail('config', 'an object', config)
  for (const k of Object.keys(config)) {
    if (!(k in DEFAULT_CONFIG)) throw new Error(`dsh-comment: unknown config key ${k}; the keys are ${Object.keys(DEFAULT_CONFIG).join(', ')}`)
  }
  const reply = { ...DEFAULT_CONFIG.reply }
  if (config.reply !== undefined && config.reply !== null) {
    if (!isObject(config.reply)) fail('reply', 'an object', config.reply)
    for (const [k, v] of Object.entries(config.reply)) {
      if (!(k in reply)) throw new Error(`dsh-comment: unknown config key reply.${k}; the keys are ${Object.keys(reply).join(', ')}`)
      reply[k] = v
    }
  }
  if (typeof reply.enabled !== 'boolean') fail('reply.enabled', 'true or false', reply.enabled)
  positive(reply.maxTokens, 'reply.maxTokens')
  positive(reply.maxRounds, 'reply.maxRounds')
  positive(reply.timeoutMs, 'reply.timeoutMs')
  const maxComments = positive(config.maxComments ?? DEFAULT_CONFIG.maxComments, 'maxComments')
  return { reply, maxComments }
}
