// The routes the browser half calls. Exact Fetch routes on the host
// connection (ctx.connection.fetch), which answers 403 to any Peer that is
// not the owner before a route runs, and sits behind the launch-token cookie
// and the Host/Origin checks.
import { CommentError } from './threads.js'

export const ROUTES = {
  threads: '/api/dsh-threads/threads', //  GET ?sessionId=S → { threads, canWrite }
  create: '/api/dsh-threads/create', //    POST { sessionId, anchor, text } → thread
  comment: '/api/dsh-threads/comment', //  POST { sessionId, threadId, text } → thread
  retry: '/api/dsh-threads/retry', //      POST { sessionId, threadId } → thread
  delete: '/api/dsh-threads/delete', //    POST { sessionId, threadId } → { deleted }
}

const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const json = (value, status = 200) => Response.json(value, { status, headers: HEADERS })

const MAX_BODY = 64 * 1024

async function body(request) {
  const text = await request.text()
  if (text.length > MAX_BODY) throw new CommentError('too_large', 'The request is too large', 413)
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new CommentError('bad_request', 'The request is not JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CommentError('bad_request', 'The request is not an object')
  if (typeof value.sessionId !== 'string' || value.sessionId === '') throw new CommentError('bad_request', 'sessionId is required')
  return value
}

/** The handlers by path, over one comment service. */
export function createRouteHandlers(service) {
  return {
    [ROUTES.threads]: async (request) => {
      const sessionId = new URL(request.url).searchParams.get('sessionId')
      if (!sessionId) throw new CommentError('bad_request', 'sessionId is required')
      return service.list(sessionId)
    },
    [ROUTES.create]: async (request) => {
      const b = await body(request)
      return service.create(b.sessionId, b.anchor, b.text)
    },
    [ROUTES.comment]: async (request) => {
      const b = await body(request)
      return service.comment(b.sessionId, b.threadId, b.text)
    },
    [ROUTES.retry]: async (request) => {
      const b = await body(request)
      return service.retry(b.sessionId, b.threadId)
    },
    [ROUTES.delete]: async (request) => {
      const b = await body(request)
      return service.remove(b.sessionId, b.threadId)
    },
  }
}

/** One request to a handler: its value as JSON, an expected failure as { error, message }. */
export async function answer(handle, request, log = () => {}) {
  try {
    return json(await handle(request))
  } catch (error) {
    if (error instanceof CommentError) return json({ error: error.code, message: error.message }, error.status)
    log(error)
    return json({ error: 'failed', message: 'Something went wrong: ' + (error?.code ?? error?.name ?? 'error') }, 500)
  }
}

/**
 * Register the routes on the host connection; call it inside
 * ctx.inject(['connection'], …), so they go when that context does.
 */
export function registerRoutes(ctx, service, log) {
  for (const [path, handle] of Object.entries(createRouteHandlers(service))) {
    ctx.connection.fetch.register({
      path,
      methods: path === ROUTES.threads ? ['GET'] : ['POST'],
      requestBody: 'buffered',
      fetch: (request) => answer(handle, request, log),
    })
  }
}
