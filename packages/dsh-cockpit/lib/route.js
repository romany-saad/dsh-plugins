// The read routes the Cockpit tab uses (design sections 5 and 8). They are
// exact Fetch routes on the host connection (ctx.connection.fetch), which
// answers 403 to any Peer that is not the owner before a route runs, and sits
// behind the launch-token cookie and the Host/Origin checks. The raw web
// server has none of that, so nothing here registers on it. GET and HEAD only.
import { readFile } from 'node:fs/promises'
import { listBoards } from '../reader.js'
import { createStore, parseBoard } from './store.js'
import { boardTree } from './tree.js'

export const ROUTES = {
  boards: '/api/dsh-cockpit/boards', // { boards: string[] }
  board: '/api/dsh-cockpit/board', //   ?key=K: the board file's bytes
  view: '/api/dsh-cockpit/view', //     ?sessionId=S: what the Cockpit tab shows
}

export const METHODS = ['GET', 'HEAD']

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const json = (value, status = 200) => Response.json(value, { status, headers: HEADERS })

/** Whether the profile configured a drift command (design 5: empty means none). */
export const driftConfigured = (config) => config.drift.command.trim() !== ''

async function readText(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

const param = (request, name) => new URL(request.url).searchParams.get(name) || undefined

/**
 * The three handlers over one data directory ($DSH_HOME/data/dsh-cockpit),
 * by path. They only read: no handler writes a file.
 * @param {string} dataDir
 * @param {{ driftConfigured?: boolean }} [options]
 * @returns {Record<string, (request: Request) => Promise<Response>>}
 */
export function createRouteHandlers(dataDir, { driftConfigured = false } = {}) {
  const store = createStore({ dataDir })
  return {
    [ROUTES.boards]: async () => json({ boards: await listBoards(dataDir) }),

    // The file as stored, so a reader gets the record itself.
    [ROUTES.board]: async (request) => {
      const key = param(request, 'key')
      if (key === undefined) return json({ error: 'key is required' }, 400)
      const text = await readText(store.file(key))
      if (text === undefined) return json({ error: 'no such board' }, 404)
      return new Response(text, { headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8' } })
    },

    // The session's bound board with its tree, flags and problems; else the
    // board list. A bound board that is missing or unreadable is reported in
    // the answer, so the tab can say so.
    [ROUTES.view]: async (request) => {
      const sessionId = param(request, 'sessionId')
      if (sessionId === undefined) return json({ error: 'sessionId is required' }, 400)
      const key = await store.readBinding(sessionId)
      if (key === undefined) return json({ key: null, boards: await listBoards(dataDir) })
      const text = await readText(store.file(key))
      if (text === undefined) return json({ key, error: 'no such board', boards: await listBoards(dataDir) })
      let board
      try {
        board = parseBoard(text, key)
      } catch (error) {
        return json({ key, error: error.message })
      }
      const { tree, flags, problems } = boardTree(board)
      return json({ key, board, tree, flags, problems, driftConfigured })
    },
  }
}

/**
 * Register the routes on the host connection: call it with the context of
 * ctx.inject(['connection'], …), so they go when that context or the
 * connection does. HEAD answers GET's status and headers without the body.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dataDir: string, config: ReturnType<typeof import('./config.js').resolveConfig> }} options
 */
export function registerRoutes(ctx, { dataDir, config }) {
  const handlers = createRouteHandlers(dataDir, { driftConfigured: driftConfigured(config) })
  for (const [path, handle] of Object.entries(handlers)) {
    ctx.connection.fetch.register({
      path,
      methods: METHODS,
      requestBody: 'buffered',
      fetch: async (request) => {
        let response
        try {
          response = await handle(request)
        } catch (error) {
          response = json({ error: error?.message ?? String(error) }, 500)
        }
        if (request.method !== 'HEAD') return response
        await response.body?.cancel()
        return new Response(null, { status: response.status, headers: response.headers })
      },
    })
  }
}
