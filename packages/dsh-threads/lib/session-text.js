// What the replier reads: a session log turned into text. Pure functions over
// raw session events (the shape ctx.sessionQuery.readSession returns), so
// tests feed them plain arrays.

const cut = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…')
const oneLine = (s) => s.replace(/\s+/g, ' ').trim()

/** The text of a message's content blocks; reasoning only when asked. */
export function blocksText(content, { reasoning = false, tools = true } = {}) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b?.type === 'reasoning' && reasoning && typeof b.text === 'string') parts.push('(reasoning) ' + b.text)
    else if (b?.type === 'tool-call' && tools) parts.push(`→ ${b.name}(${cut(String(b.arguments ?? ''), 400)})`)
  }
  return parts.join('\n').trim()
}

/** The session's title, from its last session/title event. */
export function sessionTitle(events) {
  let title = ''
  for (const e of events) if (e.type === 'session/title' && typeof e.data?.title === 'string') title = e.data.title
  return title
}

/**
 * The model the session talks to now: the user's pick that no request has
 * used yet, else the one its last request used. Mirrors DSH's own
 * modelSelection projection. Undefined before the first request.
 */
export function currentRoute(events) {
  let lastUsed, pending
  const same = (a, b) => a && b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort
  for (const e of events) {
    if (e.type === 'model/selection' && typeof e.data?.provider === 'string' && typeof e.data?.model === 'string') {
      pending = { provider: e.data.provider, model: e.data.model, ...(e.data.reasoningEffort ? { reasoningEffort: String(e.data.reasoningEffort) } : {}) }
    } else if (e.type === 'request/header') {
      const c = e.data?.header?.config
      if (typeof c?.provider !== 'string' || typeof c?.model !== 'string') continue
      lastUsed = { provider: c.provider, model: c.model, ...(c.reasoningEffort !== undefined ? { reasoningEffort: String(c.reasoningEffort) } : {}) }
      if (same(pending, lastUsed)) pending = undefined
    }
  }
  return pending ?? lastUsed
}

/** Each event with the turn it falls in (0 before the first turn). */
function withTurns(events) {
  let turn = 0
  return events.map((e) => {
    if (e.type === 'turn/start' && Number.isSafeInteger(e.data?.turn)) turn = e.data.turn
    return { e, turn }
  })
}

/** One event as readable text, or '' for events with nothing to read. */
export function eventText(e, { reasoning = true } = {}) {
  switch (e.type) {
    case 'user/message': return blocksText(e.data?.content)
    case 'assistant/message': return blocksText(e.data?.message?.content, { reasoning })
    case 'tool/result': return blocksText(e.data?.message?.content, { tools: false })
    case 'todo/write': return Array.isArray(e.data?.todos) ? e.data.todos.map((t) => `[${t.status}] ${t.content}`).join('\n') : ''
    default: return ''
  }
}

const LABEL = { 'user/message': 'user', 'assistant/message': 'assistant', 'tool/result': 'tool result', 'todo/write': 'todo list' }

/** Find the message an anchor points at; undefined when it is not in the log. */
export function findAnchorEvent(events, anchor) {
  for (const e of events) {
    if (anchor.kind === 'user') {
      if (e.type === 'user/message' && e.data?.id === anchor.messageId) return e
    } else if (e.type === 'assistant/message' && e.data?.turn === anchor.turn && e.data?.step === anchor.step) {
      return e
    }
  }
  return undefined
}

/** The text an anchor sits in: a user message, an assistant reply, or one reasoning block of it. */
export function anchorSource(event, anchor) {
  if (event === undefined) return ''
  if (anchor.kind === 'user') return blocksText(event.data?.content)
  const content = event.data?.message?.content ?? []
  if (anchor.kind === 'reasoning') {
    const blocks = content.filter((b) => b?.type === 'reasoning')
    const block = blocks[anchor.block] ?? undefined
    return block !== undefined ? block.text : blocks.map((b) => b.text).join('\n\n')
  }
  return blocksText(content, { tools: false })
}

/** Cut a long text to about `max` characters, keeping the part around `passage`. */
export function around(text, passage, max) {
  if (text.length <= max) return text
  const flat = (s) => s.replace(/\s+/g, ' ')
  let at = text.indexOf(passage)
  if (at === -1) at = flat(text).indexOf(flat(passage))
  if (at === -1) return cut(text, max)
  const start = Math.max(0, Math.min(at - Math.floor((max - passage.length) / 2), text.length - max))
  return (start > 0 ? '…' : '') + text.slice(start, start + max) + (start + max < text.length ? '…' : '')
}

/** The user's prompt(s) of a turn: the user messages from its start up to `before`. */
export function turnPrompt(events, turn, beforeSeq = Infinity) {
  const parts = []
  for (const { e, turn: t } of withTurns(events)) {
    if (e.seq >= beforeSeq) break
    if (t === turn && e.type === 'user/message') parts.push(blocksText(e.data?.content))
  }
  return parts.join('\n\n')
}

/** The turn an event sits in. */
export function turnOf(events, seq) {
  let found = 0
  for (const { e, turn } of withTurns(events)) {
    if (e.seq === seq) return turn
    if (e.seq > seq) break
    found = turn
  }
  return found
}

/** The first assistant text after `seq`, within the same turn. */
export function replyAfter(events, seq) {
  const turn = turnOf(events, seq)
  for (const { e, turn: t } of withTurns(events)) {
    if (e.seq <= seq || t !== turn) continue
    if (e.type === 'assistant/message') {
      const text = blocksText(e.data?.message?.content, { tools: false })
      if (text) return text
    }
  }
  return ''
}

// ------------------------------------------------------------- the tools

export const TOOL_SCHEMAS = [
  {
    name: 'session_outline',
    description: 'List the turns of the session: each turn number, the seq range of its events, and the start of the user prompt that began it.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_in_session',
    description: 'Find events in the session whose text contains the given words (case-insensitive, literal). Searches user prompts, assistant replies and reasoning, tool calls and tool results. Returns seq numbers and short snippets; read one in full with read_event.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Literal text to look for.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_event',
    description: 'Read one session event in full by its seq number (long text is cut).',
    parameters: {
      type: 'object',
      properties: { seq: { type: 'integer', minimum: 0 } },
      required: ['seq'],
      additionalProperties: false,
    },
  },
]

const MAX_OUTLINE = 80
const MAX_HITS = 15
const MAX_EVENT = 6000

/**
 * The replier's three read-only tools over one session's events.
 * @returns {(name: string, args: object) => string} throws on a bad call
 */
export function sessionTools(events) {
  const rows = withTurns(events)
  return (name, args) => {
    if (name === 'session_outline') {
      const turns = new Map()
      for (const { e, turn } of rows) {
        if (turn === 0) continue
        const t = turns.get(turn) ?? { from: e.seq, to: e.seq, prompt: '' }
        t.to = e.seq
        if (!t.prompt && e.type === 'user/message') t.prompt = oneLine(blocksText(e.data?.content))
        turns.set(turn, t)
      }
      const all = [...turns.entries()]
      const shown = all.slice(-MAX_OUTLINE)
      const lines = shown.map(([n, t]) => `Turn ${n} (seq ${t.from}–${t.to}): ${cut(t.prompt, 160) || '(no prompt)'}`)
      if (shown.length < all.length) lines.unshift(`(${all.length - shown.length} earlier turns not shown)`)
      return lines.join('\n') || 'The session has no turns yet.'
    }
    if (name === 'find_in_session') {
      const needle = typeof args?.text === 'string' ? args.text.trim().toLowerCase() : ''
      if (!needle) throw new Error('text is required')
      const hits = []
      let total = 0
      for (const { e, turn } of rows) {
        const text = eventText(e)
        const at = text.toLowerCase().indexOf(needle)
        if (at === -1) continue
        total++
        if (hits.length >= MAX_HITS) continue
        const from = Math.max(0, at - 80)
        const snippet = oneLine(text.slice(from, at + needle.length + 120))
        hits.push(`seq ${e.seq} · turn ${turn} · ${LABEL[e.type]}: ${from > 0 ? '…' : ''}${snippet}…`)
      }
      if (total === 0) return `No event contains "${args.text}".`
      if (total > hits.length) hits.push(`(${total - hits.length} more matches; use more specific words)`)
      return hits.join('\n')
    }
    if (name === 'read_event') {
      const seq = args?.seq
      if (!Number.isSafeInteger(seq)) throw new Error('seq must be a whole number')
      const row = rows.find(({ e }) => e.seq === seq)
      if (row === undefined) throw new Error(`no event with seq ${seq}`)
      const text = eventText(row.e)
      const head = `seq ${seq} · turn ${row.turn} · ${LABEL[row.e.type] ?? row.e.type}`
      if (!text) return head + '\n(no readable text in this event)'
      return head + '\n' + cut(text, MAX_EVENT)
    }
    throw new Error('unknown tool ' + name)
  }
}
