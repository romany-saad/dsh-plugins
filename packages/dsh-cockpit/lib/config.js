// Plugin config with the defaults of design section 7. A profile patch with
// the same id replaces the whole config, so every field has its default here.
export const DEFAULT_CONFIG = {
  tools: { enabled: true },
  route: { enabled: true },
  drift: { command: '', cwd: '', mode: 'report' },
  links: { issue: '', pr: '' },
}

const fail = (path, want, got) => {
  throw new Error(`dsh-cockpit: ${path} must be ${want}, got ${JSON.stringify(got)}`)
}

function section(config, name) {
  const value = config[name]
  if (value === undefined || value === null) return { ...DEFAULT_CONFIG[name] }
  if (typeof value !== 'object' || Array.isArray(value)) fail(name, 'an object', value)
  const out = { ...DEFAULT_CONFIG[name], ...value }
  for (const [k, v] of Object.entries(DEFAULT_CONFIG[name])) {
    if (typeof out[k] !== typeof v) fail(`${name}.${k}`, `a ${typeof v}`, out[k])
  }
  return out
}

/**
 * The resolved config: tools, route, drift and links, each with its defaults.
 * - tools.enabled false registers no tools (decision 15).
 * - route.enabled and drift are read by the routes and the drift runner.
 * - links (decision 20, Q3): URL patterns for issue and pr references that
 *   are not full URLs, with the placeholders {ref}, {repo} and {number} of
 *   refUrl() in lib/rows.js. Empty by default: only full http(s) URLs link.
 */
export function resolveConfig(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail('config', 'an object', config)
  const drift = section(config, 'drift')
  if (drift.mode !== 'report' && drift.mode !== 'apply') fail('drift.mode', 'report or apply', drift.mode)
  return {
    tools: section(config, 'tools'),
    route: section(config, 'route'),
    drift,
    links: section(config, 'links'),
  }
}

/**
 * The options lib/rows.js takes for links on one board: refUrl(ref, kind,
 * linkOptions(config, board)) and boardRows(board, linkOptions(config, board)).
 * A pattern left empty is left out.
 */
export function linkOptions(config, board) {
  const links = {}
  for (const kind of ['issue', 'pr']) if (config.links[kind].trim()) links[kind] = config.links[kind].trim()
  return { links, parent: board?.parent }
}
