// The Inbox (#51): rough items noted for later, on the board but outside its
// task tree. No imports: client/build.mjs inlines this file, so the Board tab,
// the tools and the tree text share these rules.

/** open: not refined yet; refined: turned into board tasks; dropped: will not be done. */
export const INBOX_STATES = ['open', 'refined', 'dropped']

/** Every inbox item field, in the order the file stores them. */
export const INBOX_FIELDS = ['id', 'text', 'state', 'source', 'note', 'refinedInto', 'refinedWith', 'addedAt', 'updatedAt', 'clearedAt']

/** The board's inbox; a board without one, or a hand-written one that is not a list, has none. */
export const inboxOf = (board) => (Array.isArray(board?.inbox) ? board.inbox.filter((i) => i && typeof i === 'object' && typeof i.id === 'string') : [])

/** The items the tab and the tree text show: every item not cleared. */
export const shownInbox = (inbox) => inbox.filter((i) => typeof i.clearedAt !== 'string')

/** The open items, which wait to be refined. */
export const openInbox = (inbox) => inbox.filter((i) => i.state === 'open')

/**
 * The next id: i plus one more than the largest number used or recorded in
 * seq (the board's inboxSeq, the last id given), else i1. So an id is never
 * given twice, not even after its item was deleted.
 */
export function nextInboxId(inbox, seq = 0) {
  let max = Number.isInteger(seq) && seq > 0 ? seq : 0
  for (const i of inbox) {
    const m = /^i(\d+)$/.exec(i.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return 'i' + (max + 1)
}

/** Copy an item with its fields in file order, dropping undefined ones and keeping unknown ones after. */
export function orderInboxItem(item) {
  const out = {}
  for (const f of INBOX_FIELDS) if (item[f] !== undefined) out[f] = item[f]
  for (const [k, v] of Object.entries(item)) if (!(k in out) && v !== undefined) out[k] = v
  return out
}

/**
 * The key of the board the first inbox item opens when the session has none:
 * "session-" and the first 8 characters of the session id after its own
 * "session-" prefix; "inbox" without a session.
 */
export function defaultBoardKey(sessionId) {
  const id = String(sessionId ?? '').replace(/^session-/, '')
  return id ? 'session-' + id.slice(0, 8) : 'inbox'
}

/** "3 in inbox": the open items; empty when there are none. */
export const inboxCount = (inbox) => {
  const n = openInbox(inbox).length
  return n ? n + ' in inbox' : ''
}

/** One line of the tree text: "i3  open     text", then what it became. */
export function inboxLine(item, idWidth = 4) {
  const state = String(item.state ?? 'open')
  let line = String(item.id).padEnd(idWidth) + state.padEnd(9) + String(item.text ?? '')
  if (Array.isArray(item.refinedInto) && item.refinedInto.length) line += '   → ' + item.refinedInto.join(', ')
  if (typeof item.refinedWith === 'string' && item.refinedWith) line += ' (with ' + item.refinedWith + ')'
  if (typeof item.note === 'string' && item.note) line += '   note: ' + item.note
  return line
}

/** The tree text's Inbox block, or '' with nothing shown. all: cleared items too. */
export function inboxText(inbox, { all = false } = {}) {
  const items = all ? inbox : shownInbox(inbox)
  if (!items.length) return ''
  const width = Math.max(4, ...items.map((i) => String(i.id).length + 2))
  const open = openInbox(items).length
  return 'Inbox (' + open + ' open):\n' + items.map((i) => '  ' + inboxLine(i, width) + (typeof i.clearedAt === 'string' ? '   (cleared)' : '')).join('\n')
}

/** The composer text each Inbox button fills; the agent acts on it when the user sends it. */
export const inboxPrompts = {
  add: (text) => 'Add to the inbox: ' + text,
  refine: (ids) => '/cockpit-refine' + (ids && ids.length ? ' ' + ids.join(' ') : ''),
  clear: (ids) => 'Clear inbox item' + (ids.length > 1 ? 's ' : ' ') + ids.join(', ') + '.',
}
