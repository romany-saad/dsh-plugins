// The read routes the Cockpit tab uses (design sections 5 and 8). They are
// exact Fetch routes on the host connection (ctx.connection.fetch), which
// answers 403 to any Peer that is not the owner before a route runs, and sits
// behind the launch-token cookie and the Host/Origin checks. The raw web
// server has none of that, so nothing here registers on it. GET and HEAD only.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listBoards } from '../reader.js'
import { driftConfigured } from './config.js'
import { BoardError, boardFile, createStore, parseBoard } from './store.js'
import { boardTree } from './tree.js'

export const ROUTES = {
  boards: '/api/dsh-cockpit/boards', // { boards: string[] }
  board: '/api/dsh-cockpit/board', //   ?key=K: the board file's bytes
  view: '/api/dsh-cockpit/view', //     ?sessionId=S: what the Cockpit tab shows
}

export const METHODS = ['GET', 'HEAD']

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const json = (value, status = 200) => Response.json(value, { status, headers: HEADERS })

const param = (request, name) => new URL(request.url).searchParams.get(name) || undefined

/**
 * The text of the board with this key; undefined when there is none. The file
 * is boards/<encodeURIComponent(key)>.json. listBoards lists a name that is not
 * percent-encoded (a fallback hub's "100%.json") as it is, so such a key is
 * also looked up by that exact name, among the names in boards/ only.
 */
async function boardText(dataDir, key) {
  const read = async (file) => {
    try {
      return await readFile(file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
  }
  const text = await read(boardFile(dataDir, key))
  if (text !== undefined || encodeURIComponent(key) === key) return text
  let names
  try {
    names = await readdir(join(dataDir, 'boards'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  return names.includes(key + '.json') ? read(join(dataDir, 'boards', key + '.json')) : undefined
}

/**
 * What the view says about a board it cannot show: a BoardError's message
 * names the key and the problem; a filesystem error only its code, since its
 * message holds absolute paths; anything else, such as a task that is not an
 * object, its message.
 */
function viewError(key, error) {
  if (error instanceof BoardError) return error.message
  if (typeof error?.code === 'string') return `${key}: cannot read the board (${error.code})`
  return `${key}: cannot draw the board (${error?.message ?? error})`
}

/**
 * The three handlers over one data directory ($DSH_HOME/data/dsh-cockpit),
 * by path. They only read: no handler writes a file.
 * @param {string} dataDir
 * @param {{ drift?: boolean }} [options] drift: whether a drift command is configured
 * @returns {Record<string, (request: Request) => Promise<Response>>}
 */
export function createRouteHandlers(dataDir, { drift = false } = {}) {
  const store = createStore({ dataDir })
  return {
    [ROUTES.boards]: async () => json({ boards: await listBoards(dataDir) }),

    // The file as stored, so a reader gets the record itself.
    [ROUTES.board]: async (request) => {
      const key = param(request, 'key')
      if (key === undefined) return json({ error: 'key is required' }, 400)
      const text = await boardText(dataDir, key)
      if (text === undefined) return json({ error: 'no such board' }, 404)
      return new Response(text, { headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8' } })
    },

    // The session's bound board with its tree, flags and problems; else the
    // board list. A bound board that is missing, or that cannot be read or
    // drawn, is reported in the answer, so the tab can say so.
    [ROUTES.view]: async (request) => {
      const sessionId = param(request, 'sessionId')
      if (sessionId === undefined) return json({ error: 'sessionId is required' }, 400)
      const key = await store.readBinding(sessionId)
      if (key === undefined) return json({ key: null, boards: await listBoards(dataDir) })
      let board, drawn
      try {
        const text = await boardText(dataDir, key)
        if (text === undefined) return json({ key, error: 'no such board', boards: await listBoards(dataDir) })
        board = parseBoard(text, key)
        drawn = boardTree(board)
      } catch (error) {
        return json({ key, error: viewError(key, error) })
      }
      const { tree, flags, problems } = drawn
      return json({ key, board, tree, flags, problems, driftConfigured: drift })
    },
  }
}

/**
 * Register the routes on the host connection: call it with the context of
 * ctx.inject(['connection'], …), so they go when that context or the
 * connection does. HEAD answers GET's status and headers without the body.
 * An unexpected error is a 500 that names only its code, not the paths in
 * its message.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dataDir: string, config: ReturnType<typeof import('./config.js').resolveConfig> }} options
 */
export function registerRoutes(ctx, { dataDir, config }) {
  const handlers = createRouteHandlers(dataDir, { drift: driftConfigured(config) })
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
          response = json({ error: 'read failed: ' + (error?.code ?? 'error') }, 500)
        }
        if (request.method !== 'HEAD') return response
        await response.body?.cancel()
        return new Response(null, { status: response.status, headers: response.headers })
      },
    })
  }
}
