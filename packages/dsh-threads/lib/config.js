// Plugin config and its defaults. A profile patch with this plugin's id
// replaces the whole config, so every field has its default here.
export const DEFAULT_CONFIG = {
  reply: {
    enabled: true,
    maxTokens: 8192, //   output tokens per model call, reasoning included
    maxRounds: 5, //      model calls per reply; tools are offered on all but the last
    timeoutMs: 180000, // for the whole reply
    files: true, //       the replier can read the working directory's files
    web: false, //        the replier can search and fetch the web
  },
  maxComments: 5, //      comments from you per thread, the first one included
}

export const MAX_CONFIG = { maxTokens: 131072, maxRounds: 20, timeoutMs: 3600000, maxComments: 100 }

const fail = (path, want, got) => {
  throw new Error(`dsh-threads: ${path} must be ${want}, got ${JSON.stringify(got)}`)
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function positive(value, path, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(path, `a whole number from 1 to ${max}`, value)
  return value
}

/** The resolved config; an unknown or mistyped key fails instead of being ignored. */
export function resolveConfig(config = {}) {
  if (!isObject(config)) fail('config', 'an object', config)
  for (const k of Object.keys(config)) {
    if (!(k in DEFAULT_CONFIG)) throw new Error(`dsh-threads: unknown config key ${k}; the keys are ${Object.keys(DEFAULT_CONFIG).join(', ')}`)
  }
  const reply = { ...DEFAULT_CONFIG.reply }
  if (config.reply !== undefined && config.reply !== null) {
    if (!isObject(config.reply)) fail('reply', 'an object', config.reply)
    for (const [k, v] of Object.entries(config.reply)) {
      if (!(k in reply)) throw new Error(`dsh-threads: unknown config key reply.${k}; the keys are ${Object.keys(reply).join(', ')}`)
      reply[k] = v
    }
  }
  for (const k of ['enabled', 'files', 'web']) if (typeof reply[k] !== 'boolean') fail('reply.' + k, 'true or false', reply[k])
  for (const key of ['maxTokens', 'maxRounds', 'timeoutMs']) positive(reply[key], 'reply.' + key, MAX_CONFIG[key])
  const maxComments = positive(config.maxComments ?? DEFAULT_CONFIG.maxComments, 'maxComments', MAX_CONFIG.maxComments)
  return { reply, maxComments }
}
