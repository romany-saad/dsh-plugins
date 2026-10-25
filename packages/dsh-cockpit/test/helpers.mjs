import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.js'
import { createStore } from '../lib/store.js'
import { createBoardTools } from '../lib/tools.js'

// No network in tests (design 9).
globalThis.fetch = () => { throw new Error('network access in a test') }

export async function tempHome() {
  return mkdtemp(join(tmpdir(), 'cockpit-test-'))
}

export async function setup(config = {}, { home } = {}) {
  home ??= await tempHome()
  const dataDir = join(home, 'data', 'dsh-cockpit')
  let tick = 0
  const store = createStore({ dataDir, now: () => new Date(Date.UTC(2026, 9, 25, 7, 0, tick++)).toISOString() })
  const tools = createBoardTools({ store, config: resolveConfig(config), dshHome: home })
  const exec = (sessionId = 'sess-1') => ({ agent: { session: { id: sessionId } }, signal: new AbortController().signal })
  return { home, dataDir, store, tools, exec }
}
