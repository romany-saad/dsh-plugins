import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.js'

export const t = (item, status, what, more = {}) => ({ item, status, what, ...more })

export async function tempHome() {
  return mkdtemp(join(tmpdir(), 'cockpit-test-'))
}

/** A store under a fresh DSH_HOME, with a clock that ticks one second per call. */
export async function setup({ home } = {}) {
  home ??= await tempHome()
  const dataDir = join(home, 'data', 'dsh-cockpit')
  let tick = 0
  const store = createStore({ dataDir, now: () => new Date(Date.UTC(2026, 9, 25, 7, 0, tick++)).toISOString() })
  return { home, dataDir, store }
}

/** A new board as board_open creates it. */
export const newBoard = (key, at, more = {}) => ({ format: 'dsh-cockpit.board', version: 1, key, ...more, revision: 0, createdAt: at, updatedAt: at, tasks: [] })
