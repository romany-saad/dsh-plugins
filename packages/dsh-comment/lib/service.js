// The comment service: reads threads from a session's log, writes changed
// threads as plugin records to the live session, and runs the AI reply in
// the background. The routes (lib/route.js) are a thin layer over it.
import { randomUUID } from 'node:crypto'
import { runReply } from './reply.js'
import { currentRoute } from './session-text.js'
import {
  CommentError, RECORD_DELETE, RECORD_THREAD, cleanAnchor, cleanComment, deleteRecord, foldThreads, threadRecord, userTurns,
} from './threads.js'

/**
 * @param {object} o
 * @param {object} o.config            resolveConfig()
 * @param {() => object|undefined} o.sessions       ctx.sessions, or undefined while it is away
 * @param {() => object|undefined} o.sessionQuery   ctx.sessionQuery
 * @param {() => object|undefined} o.llm            ctx.llm
 * @param {object} o.session           { appendPluginRecord } from @deepseek-ai/dsh-session
 * @param {object} o.llmLib            { BlockAssembler, createToolResultMessage, ReasoningEffortId } from @deepseek-ai/dsh-llm
 * @param {(error: unknown) => void} [o.log]
 * @param {() => number} [o.now]
 */
export function createCommentService({ config, sessions, sessionQuery, llm, session: sessionLib, llmLib, log = () => {}, now = Date.now }) {
  const tails = new Map() // sessionId → promise: writes to one session run one at a time
  const replying = new Map() // `${sessionId} ${threadId}` → AbortController
  const failures = new Map() // `${sessionId} ${threadId}` → message of the last failed reply
  let closed = false
  const key = (sessionId, threadId) => sessionId + ' ' + threadId

  const serial = (sessionId, fn) => {
    const run = (tails.get(sessionId) ?? Promise.resolve()).then(fn, fn)
    const tail = run.then(() => {}, () => {})
    tails.set(sessionId, tail)
    tail.then(() => { if (tails.get(sessionId) === tail) tails.delete(sessionId) })
    return run
  }

  function need(service, name) {
    if (service === undefined) throw new CommentError('unavailable', `DSH's ${name} service is not running`, 503)
    return service
  }

  async function readEvents(sessionId) {
    const query = need(sessionQuery(), 'session query')
    let snapshot
    try {
      snapshot = await query.readSession(sessionId)
    } catch (error) {
      log(error)
      throw new CommentError('no_session', 'No such session', 404)
    }
    return snapshot.events
  }

  function liveSession(sessionId) {
    const live = sessions()?.get(sessionId)
    if (live === undefined) {
      throw new CommentError('inactive', 'This session is not running. Continue it (send a message) to comment on it.', 409)
    }
    return live
  }

  async function append(sessionId, type, data) {
    const store = need(sessions(), 'sessions')
    const live = liveSession(sessionId)
    sessionLib.appendPluginRecord(live, type, data)
    if (!(await store.flush(live))) throw new CommentError('not_saved', 'The comment could not be saved', 500)
  }

  /** The threads of a session, each with its reply state. */
  async function list(sessionId) {
    const threads = foldThreads(await readEvents(sessionId), sessionId)
    return {
      threads: [...threads.values()].map((t) => view(sessionId, t)),
      canWrite: sessions()?.get(sessionId) !== undefined,
    }
  }

  function view(sessionId, thread) {
    const k = key(sessionId, thread.id)
    const out = { ...thread, replying: replying.has(k) }
    if (failures.has(k)) out.failure = failures.get(k)
    return out
  }

  /** Start a thread on a passage. Returns at once; the reply follows. */
  function create(sessionId, rawAnchor, rawText) {
    const anchor = cleanAnchor(rawAnchor)
    const text = cleanComment(rawText)
    return serial(sessionId, async () => {
      liveSession(sessionId)
      const time = now()
      const thread = { id: randomUUID(), createdAt: time, anchor, messages: [{ id: randomUUID(), role: 'user', text, time }] }
      await append(sessionId, RECORD_THREAD, threadRecord(sessionId, thread))
      startReply(sessionId, thread.id)
      return view(sessionId, thread)
    })
  }

  /** Add a comment to a thread; the reply follows. */
  function comment(sessionId, threadId, rawText) {
    const text = cleanComment(rawText)
    return serial(sessionId, async () => {
      liveSession(sessionId)
      const thread = await current(sessionId, threadId)
      if (replying.has(key(sessionId, threadId))) throw new CommentError('busy', 'Wait for the reply first', 409)
      if (userTurns(thread) >= config.maxComments) {
        throw new CommentError('thread_full', `A thread holds ${config.maxComments} comments from you. Start a new one, or send this one to the chat.`, 409)
      }
      const next = { ...thread, messages: [...thread.messages, { id: randomUUID(), role: 'user', text, time: now() }] }
      await append(sessionId, RECORD_THREAD, threadRecord(sessionId, next))
      startReply(sessionId, threadId)
      return view(sessionId, next)
    })
  }

  /** Try the reply again after it failed. */
  function retry(sessionId, threadId) {
    return serial(sessionId, async () => {
      liveSession(sessionId)
      const thread = await current(sessionId, threadId)
      if (thread.messages.at(-1).role !== 'user') throw new CommentError('answered', 'This thread already has its reply', 409)
      startReply(sessionId, threadId)
      return view(sessionId, thread)
    })
  }

  function remove(sessionId, threadId) {
    return serial(sessionId, async () => {
      await current(sessionId, threadId)
      replying.get(key(sessionId, threadId))?.abort(new CommentError('deleted', 'The thread was deleted'))
      failures.delete(key(sessionId, threadId))
      await append(sessionId, RECORD_DELETE, deleteRecord(sessionId, threadId))
      return { deleted: threadId }
    })
  }

  async function current(sessionId, threadId) {
    if (typeof threadId !== 'string') throw new CommentError('bad_request', 'threadId is required')
    const thread = foldThreads(await readEvents(sessionId), sessionId).get(threadId)
    if (thread === undefined) throw new CommentError('no_thread', 'No such thread', 404)
    return thread
  }

  function startReply(sessionId, threadId) {
    const k = key(sessionId, threadId)
    failures.delete(k)
    if (!config.reply.enabled || closed) return
    const controller = new AbortController()
    replying.set(k, controller)
    const timer = setTimeout(() => controller.abort(new CommentError('timeout', 'The reply took too long', 504)), config.reply.timeoutMs)
    ;(async () => {
      try {
        const events = await readEvents(sessionId)
        const thread = foldThreads(events, sessionId).get(threadId)
        if (thread === undefined) return
        const route = currentRoute(events)
        if (route === undefined) throw new CommentError('no_model', 'The session has not used a model yet', 409)
        const result = await runReply({
          llm: need(llm(), 'LLM'),
          lib: llmLib,
          events,
          thread,
          route,
          maxTokens: config.reply.maxTokens,
          maxRounds: config.reply.maxRounds,
          signal: controller.signal,
        })
        await serial(sessionId, async () => {
          controller.signal.throwIfAborted()
          const latest = await current(sessionId, threadId)
          const next = { ...latest, messages: [...latest.messages, { id: randomUUID(), role: 'ai', text: result.text, time: now(), model: result.model }] }
          await append(sessionId, RECORD_THREAD, threadRecord(sessionId, next))
        })
      } catch (error) {
        const reason = controller.signal.aborted ? controller.signal.reason : error
        if (reason?.code === 'deleted' || closed) return
        log(error)
        failures.set(k, reason instanceof CommentError ? reason.message : 'The reply failed: ' + (reason?.message ?? String(reason)))
      } finally {
        clearTimeout(timer)
        if (replying.get(k) === controller) replying.delete(k)
      }
    })()
  }

  function close() {
    closed = true
    for (const c of replying.values()) c.abort(new CommentError('closed', 'The plugin stopped'))
    replying.clear()
  }

  return { list, create, comment, retry, remove, close, _replying: replying }
}
