// Owner-only read routes for the board data (design 8). They are exact Fetch
// routes on the host connection, which answers 403 to any non-owner Peer and
// sits behind the launch-token cookie and Host checks. Read-only: GET and HEAD.
import { readFile } from 'node:fs/promises'
import { listBoards } from '../reader.js'
import { createStore, parseBoard } from './store.js'
import { boardTree } from './tree.js'

export const ROUTES = {
  boards: '/api/dsh-cockpit/boards', // { boards: string[] }
  board: '/api/dsh-cockpit/board', //   ?key=K: the board file's bytes
  view: '/api/dsh-cockpit/view', //     ?sessionId=S: what the GUI panel shows
}

const headers = { 'cache-control': 'no-store' }
const json = (value, status = 200) => Response.json(value, { status, headers })

async function readText(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

/** The three handlers for one data directory ($DSH_HOME/data/dsh-cockpit). */
export function createRouteHandlers(dataDir) {
  const store = createStore({ dataDir })
  return {
    [ROUTES.boards]: async () => json({ boards: await listBoards(dataDir) }),

    [ROUTES.board]: async (request) => {
      const key = new URL(request.url).searchParams.get('key')
      if (!key) return json({ error: 'key is required' }, 400)
      const text = await readText(store.file(key))
      if (text === undefined) return json({ error: 'no such board' }, 404)
      return new Response(text, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } })
    },

    // The session's bound board with its tree and flags, else the board list.
    [ROUTES.view]: async (request) => {
      const sessionId = new URL(request.url).searchParams.get('sessionId')
      if (!sessionId) return json({ error: 'sessionId is required' }, 400)
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
      const { tree, flags } = boardTree(board)
      return json({ key, board, tree, flags })
    },
  }
}

/**
 * Register the routes on a host connection (ctx.connection inside
 * ctx.inject(['connection'], …)); each disposer is tied to ctx.
 */
export function registerRoutes(ctx, dataDir) {
  for (const [path, handle] of Object.entries(createRouteHandlers(dataDir))) {
    ctx.effect(() => ctx.connection.fetch.register({
      path,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const response = await handle(request)
        return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response
      },
    }), `dsh-cockpit: route ${path}`)
  }
}
