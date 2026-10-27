// Comment threads as session-log records, and the pure checks around them.
// No DSH imports, so tests run without a host.
//
// Two record types, each carrying the session id it belongs to, so a fork
// (which copies its parent's log) does not show the parent's threads:
//   plugin:dsh-threads/thread         { v: 1, sessionId, thread }  the whole thread after a change
//   plugin:dsh-threads/thread-delete  { v: 1, sessionId, threadId }

export const RECORD_THREAD = 'plugin:dsh-threads/thread'
export const RECORD_DELETE = 'plugin:dsh-threads/thread-delete'

// The same records under the plugin's first name, dsh-comment (0.1.0-rc.1).
// Read, never written: threads saved before the rename keep showing, and a
// change to one is written under the new name, which then wins.
const LEGACY_THREAD = 'plugin:dsh-comment/thread'
const LEGACY_DELETE = 'plugin:dsh-comment/thread-delete'
const isThread = (type) => type === RECORD_THREAD || type === LEGACY_THREAD
const isDelete = (type) => type === RECORD_DELETE || type === LEGACY_DELETE

export const LIMITS = {
  comment: 4000, // characters in one comment or reply
  passage: 2000, // characters of selected text
  context: 64, //   characters kept before and after the passage
}

export const ANCHOR_KINDS = ['user', 'assistant', 'reasoning']

/** An expected failure, answered as { error: code, message } with a status. */
export class CommentError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = (v, max) => typeof v === 'string' && v.length <= max
const isCount = (v) => Number.isSafeInteger(v) && v >= 0

/**
 * Check an anchor from the browser; returns a clean copy or throws a
 * CommentError. The anchor names the message (user message id, or the
 * assistant's turn and step) and the passage with the text around it.
 */
export function cleanAnchor(anchor) {
  const bad = (what) => { throw new CommentError('bad_anchor', 'anchor: ' + what) }
  if (!isObject(anchor)) bad('not an object')
  if (!ANCHOR_KINDS.includes(anchor.kind)) bad('kind must be one of ' + ANCHOR_KINDS.join(', '))
  if (typeof anchor.text !== 'string' || anchor.text.trim() === '') bad('text is empty')
  if (anchor.text.length > LIMITS.passage) {
    throw new CommentError('passage_too_long', `Select at most ${LIMITS.passage} characters to comment on`)
  }
  const out = { kind: anchor.kind, text: anchor.text, prefix: '', suffix: '' }
  for (const side of ['prefix', 'suffix']) {
    if (anchor[side] === undefined) continue
    if (typeof anchor[side] !== 'string') bad(side + ' is not text')
    out[side] = side === 'prefix' ? anchor[side].slice(-LIMITS.context) : anchor[side].slice(0, LIMITS.context)
  }
  if (anchor.kind === 'user') {
    if (typeof anchor.messageId !== 'string' || anchor.messageId === '' || anchor.messageId.length > 200) bad('messageId is missing')
    out.messageId = anchor.messageId
  } else {
    if (!isCount(anchor.turn) || !isCount(anchor.step)) bad('turn and step must be whole numbers')
    out.turn = anchor.turn
    out.step = anchor.step
    if (anchor.kind === 'reasoning') {
      if (!isCount(anchor.block)) bad('block must be a whole number')
      out.block = anchor.block
    }
  }
  return out
}

/** Trim a comment; throw when it is empty or too long. */
export function cleanComment(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new CommentError('empty', 'The comment is empty')
  const clean = text.trim()
  if (clean.length > LIMITS.comment) throw new CommentError('too_long', `A comment holds at most ${LIMITS.comment} characters`)
  return clean
}

function validMessage(m) {
  return isObject(m) && typeof m.id === 'string' && (m.role === 'user' || m.role === 'ai') &&
    typeof m.text === 'string' && Number.isFinite(m.time) && (m.model === undefined || typeof m.model === 'string')
}

/** Whether a stored thread has the shape this version writes. */
export function validThread(t) {
  if (!isObject(t) || typeof t.id !== 'string' || t.id === '' || !Number.isFinite(t.createdAt)) return false
  if (!Array.isArray(t.messages) || t.messages.length === 0 || !t.messages.every(validMessage)) return false
  try {
    cleanAnchor(t.anchor)
  } catch {
    return false
  }
  return true
}

/**
 * Fold a session's events into its current threads, in creation order. Only
 * records written for `sessionId` count: a fork's copy of its parent's
 * records is skipped. Records of another shape (a later version) are skipped.
 * @returns {Map<string, object>} thread id → thread
 */
export function foldThreads(events, sessionId) {
  const threads = new Map()
  for (const event of events) {
    if (event?.ignorable !== true) continue
    const data = event.data
    if (!isObject(data) || data.v !== 1 || data.sessionId !== sessionId) continue
    if (isThread(event.type) && validThread(data.thread)) {
      // Keep the creation order: a changed thread keeps its place.
      threads.set(data.thread.id, data.thread)
    } else if (isDelete(event.type) && typeof data.threadId === 'string') {
      threads.delete(data.threadId)
    }
  }
  return threads
}

export const threadRecord = (sessionId, thread) => ({ v: 1, sessionId, thread })
export const deleteRecord = (sessionId, threadId) => ({ v: 1, sessionId, threadId })

/** How many comments the user has made in a thread. */
export const userTurns = (thread) => thread.messages.filter((m) => m.role === 'user').length
