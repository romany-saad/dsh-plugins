// Plugin config with the defaults of design section 7.
export const DEFAULT_CONFIG = {
  tools: { enabled: true },
  drift: { command: '', cwd: '', mode: 'report' },
}

export function resolveConfig(config = {}) {
  const drift = { ...DEFAULT_CONFIG.drift, ...(config.drift ?? {}) }
  if (drift.mode !== 'report' && drift.mode !== 'apply') throw new Error(`dsh-cockpit: drift.mode must be report or apply, got ${JSON.stringify(drift.mode)}`)
  return {
    tools: { ...DEFAULT_CONFIG.tools, ...(config.tools ?? {}) },
    drift,
    ...(config.dataDir ? { dataDir: config.dataDir } : {}),
  }
}
