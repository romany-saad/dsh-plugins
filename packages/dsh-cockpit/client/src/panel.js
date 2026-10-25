// dsh-cockpit's browser half: a read-only "Board" tab in the right sidebar,
// and one-line chat card titles for the four board tools.
// Plain CommonJS body: client/build.mjs wraps it in the module-loader factory
// and inlines the core's pure lib/rows.js and lib/present.js, so the panel,
// the hub's tree text and the tool cards share their rules.
// Externals come from the shell's module table (react, ui-primitives).
const React = require('react')
const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
const { blockedText, boardRows, needsYou, progressText, taskUrl, titleText, treeOrder } = require('../../lib/rows.js')
const { callTitle } = require('../../lib/present.js')
const { StateDot, Tag } = primitives
const h = React.createElement

const ID = '@romany-saad/dsh-cockpit'
const KIND = 'dsh-cockpit-board'
const POLL_MS = 2000
// Relative to the document, as dsh-client-ui-deliverables does, so a mounted app works.
const VIEW = 'api/dsh-cockpit/view'
const TOOLS = ['board_open', 'board_read', 'board_add', 'board_update']

const DOT = { now: 'ongoing', waiting: 'warning', done: 'done', next: 'idle' }
const FLAG_TEXT = { unknown_parent: 'unknown parent', unknown_dependency: 'unknown dependency', parent_loop: 'parent loop' }
const muted = { color: 'var(--dsw-alias-label-tertiary)' }
const secondary = { color: 'var(--dsw-alias-label-secondary)' }
const primary = { color: 'var(--dsw-alias-label-primary)' }
const mono = { fontFamily: 'var(--dsw-font-family-mono, ui-monospace, monospace)' }
const small = { fontSize: 'var(--dsh-content-font-size-secondary, 12px)' }
const STATUS_WIDTH = '7.5em'
const button = { font: 'inherit', fontSize: 11, padding: '0 6px', cursor: 'pointer' }

function useView(sessionId) {
  const [state, setState] = React.useState({ loading: true })
  React.useEffect(() => {
    let stopped = false
    let controller
    const load = async () => {
      controller = new AbortController()
      try {
        const res = await fetch(VIEW + '?sessionId=' + encodeURIComponent(sessionId), { signal: controller.signal, cache: 'no-store' })
        const body = res.headers.get('content-type')?.includes('json') ? await res.json() : { error: await res.text() }
        if (!stopped) setState(res.ok ? { view: body } : { error: body.error || 'HTTP ' + res.status })
      } catch (error) {
        if (!stopped && error.name !== 'AbortError') setState({ error: String(error.message || error) })
      }
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => { stopped = true; clearInterval(timer); controller?.abort() }
  }, [sessionId])
  return state
}

const pad2 = (n) => String(n).padStart(2, '0')
/** "15:22 · 2 min ago" in local time; the date is added when it is not today. */
function whenText(iso, now = Date.now()) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return iso || ''
  const today = new Date(now)
  const clock = pad2(at.getHours()) + ':' + pad2(at.getMinutes())
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  const local = sameDay ? clock : at.getFullYear() + '-' + pad2(at.getMonth() + 1) + '-' + pad2(at.getDate()) + ' ' + clock
  const s = Math.round((now - at.getTime()) / 1000)
  const ago = s < 0 ? 'in the future' : s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago'
    : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'
  return local + ' · ' + ago
}

/** Show the drift line only when drift is configured or the file holds a drift result. */
const showDrift = (view) => Boolean(view.driftConfigured || view.board?.drift)

const flagLabel = (f) => (FLAG_TEXT[f.code] || f.code) + (f.code === 'parent_loop' ? '' : ' ' + f.ref)

function OpenLink({ url }) {
  if (!url) return null
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: url, style: { ...small, whiteSpace: 'nowrap' }, onClick: (e) => e.stopPropagation() }, 'Open')
}

function Command({ command, url }) {
  if (!command && !url) return null
  const copy = (e) => { e.stopPropagation(); navigator.clipboard?.writeText(command).catch(() => {}) }
  return h('div', { style: { ...small, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
    command ? h('code', { style: { ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1 } }, command) : h('span', { style: { flex: 1 } }),
    command ? h('button', { type: 'button', title: 'Copy the command', onClick: copy, style: button }, 'copy') : null,
    h(OpenLink, { url }))
}

function NeedsYou({ board }) {
  const { tasks, guessed } = needsYou(board.tasks)
  if (!tasks.length) return null
  return h('section', { 'data-needs-you': '', style: { margin: '8px 0', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-state-warn-label, #c90)' } },
    h('div', { style: { fontWeight: 600, ...primary, marginBottom: 4 } }, 'Needs you', guessed ? h('span', { style: { ...muted, fontWeight: 400 } }, ' (guessed)') : null),
    tasks.map((t) => h('div', { key: t.item, 'data-item': t.item, style: { padding: '4px 0' } },
      h('div', null, h('span', { style: { ...mono, ...secondary, marginRight: 8 } }, t.item), h('span', { style: primary }, titleText(t))),
      t.nextAction ? h('div', { style: { ...small, ...secondary } }, t.nextAction) : null,
      h(Command, { command: t.readyCommand, url: taskUrl(t, board.parent) }))))
}

function Detail({ row, flags, drift }) {
  const items = []
  const add = (label, value, style) => { if (value) items.push(h('div', { key: label }, h('span', { style: muted }, label + ' '), h('span', { style: style || secondary }, value))) }
  for (const n of row.others) add(n.label, n.text)
  if (row.done) add('after', row.after.join(', '))
  else if (!row.blockedBy.length) add('after', row.after.join(', '))
  add('waiting on', row.waitingOn)
  if (!row.done) add('pr', row.pr, mono)
  add('model', row.model)
  add('branch', row.branch, mono)
  add('worktree', row.worktree, mono)
  if (drift) add('drift', (drift.status || '?') + (drift.note ? ' (' + drift.note + ')' : ''))
  return h('div', { 'data-detail': '', style: { ...small, padding: '2px 0 4px', paddingLeft: 'calc(' + row.idWidth + 'ch + ' + STATUS_WIDTH + ')' } },
    items,
    row.needsYou ? null : h(Command, { command: row.readyCommand }))
}

function Status({ row }) {
  if (row.progress) return h('span', { style: { ...small, ...secondary } }, progressText(row.progress))
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
    row.done ? null : h(StateDot, { state: DOT[row.status] || 'idle' }), h('span', null, row.status))
}

function TaskRow({ row, flags, drift }) {
  const [open, setOpen] = React.useState(false)
  const toggle = () => setOpen(!open)
  const hasDetail = row.others.length || (row.pr && !row.done) || row.model || row.branch || row.worktree || row.waitingOn || drift ||
    (row.readyCommand && !row.needsYou) || (row.after.length && !row.blockedBy.length)
  const tone = row.done ? muted : primary
  const extras = []
  if (row.ready) extras.push(h(Tag, { key: 'ready' }, 'ready'))
  if (row.blockedBy.length) extras.push(h('span', { key: 'blocked', style: { ...small, ...secondary } }, blockedText(row.blockedBy)))
  if (row.needsYou) extras.push(h(Tag, { key: 'you' }, 'needs you'))
  flags.forEach((f, i) => extras.push(h(Tag, { key: 'f' + i }, '! ' + flagLabel(f))))
  if (drift) extras.push(h(Tag, { key: 'drift' }, 'drift: ' + (drift.status || '?')))
  return h('li', { 'data-item': row.item, 'data-done': row.done || undefined, style: { listStyle: 'none', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
    h('div', {
      role: hasDetail ? 'button' : undefined, tabIndex: hasDetail ? 0 : undefined, 'aria-expanded': hasDetail ? open : undefined,
      onClick: hasDetail ? toggle : undefined,
      onKeyDown: hasDetail ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } } : undefined,
      style: { display: 'flex', alignItems: 'baseline', padding: '5px 0', cursor: hasDetail ? 'pointer' : 'default' },
    },
      h('span', { style: { ...mono, ...muted, whiteSpace: 'pre', width: row.idWidth + 'ch', flex: 'none' } },
        h('span', { 'aria-hidden': true }, row.guide), h('span', { style: row.done ? muted : secondary }, row.item)),
      h('span', { style: { ...small, ...(row.done ? muted : secondary), width: STATUS_WIDTH, flex: 'none', whiteSpace: 'nowrap', overflow: 'visible' } }, h(Status, { row })),
      h('span', { style: { flex: 1, minWidth: 0 } },
        h('span', { style: tone }, row.title),
        row.done && row.pr ? h('span', { style: { ...muted, ...small, marginLeft: 8 } }, 'PR ' + row.pr) : null,
        row.line ? h('div', { style: { ...small, ...secondary, marginTop: 1 } }, row.line) : null,
        extras.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 2 } }, extras) : null),
      h('span', { style: { flex: 'none', display: 'inline-flex', gap: 6, alignItems: 'baseline', marginLeft: 6 } },
        h(OpenLink, { url: row.url }),
        hasDetail ? h('span', { 'aria-hidden': true, style: { ...muted, ...small } }, open ? '▾' : '▸') : null)),
    open ? h(Detail, { row, flags, drift }) : null)
}

function Drift({ drift }) {
  if (!drift) return h('div', { style: { ...muted, ...small } }, 'Drift: never checked')
  const differing = (drift.items || []).filter((i) => i.differs)
  return h('div', { style: small },
    h('span', { style: muted }, 'Drift checked ' + whenText(drift.checkedAt) + ': '),
    drift.error ? h('span', { style: { color: 'var(--dsw-alias-state-error, #d33)' } }, String(drift.error.message || JSON.stringify(drift.error)))
      : h('span', null, differing.length ? differing.length + ' differing' : 'no differences'))
}

function Boards({ boards, note }) {
  return h('div', null,
    h('p', { style: secondary }, note || 'This session has no board open. Boards in the folder:'),
    boards && boards.length
      ? h('ul', { style: { paddingLeft: 16 } }, boards.map((k) => h('li', { key: k, style: mono }, k)))
      : h('p', { style: muted }, 'No boards yet.'))
}

function FlagCount({ flags }) {
  if (!flags.length) return null
  const jump = () => {
    const el = typeof document !== 'undefined' && document.querySelector('[data-dsh-cockpit-board] li[data-item="' + String(flags[0].item).replace(/"/g, '\\"') + '"]')
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return h('button', { type: 'button', onClick: jump, title: 'Show the first flagged row', style: { ...button, marginLeft: 8 } }, flags.length + (flags.length === 1 ? ' flag' : ' flags'))
}

/** Rows plus the id column's width in characters (guide and item). */
function panelRows(board) {
  const rows = boardRows(board)
  const idWidth = Math.max(0, ...rows.map((r) => (r.guide + r.item).length)) + 2
  return rows.map((r) => ({ ...r, idWidth }))
}

function BoardBody({ sessionId }) {
  const { loading, view, error } = useView(sessionId)
  const wrap = (child) => h('section', { 'data-dsh-cockpit-board': '', style: { padding: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box' } }, child)
  if (loading) return wrap(h('p', { style: muted }, 'Loading board…'))
  if (error) return wrap(h('p', { role: 'alert' }, 'Board unavailable: ' + error))
  if (!view.key) return wrap(h(Boards, { boards: view.boards }))
  if (!view.board) return wrap(h('div', null, h('p', { role: 'alert' }, view.key + ': ' + view.error), view.boards ? h(Boards, { boards: view.boards, note: 'Boards in the folder:' }) : null))
  const { board } = view
  const flags = view.flags || []
  const flagsOf = new Map()
  for (const f of flags) { if (!flagsOf.has(f.item)) flagsOf.set(f.item, []); flagsOf.get(f.item).push(f) }
  const driftOf = new Map(((board.drift && board.drift.items) || []).filter((i) => i.differs).map((i) => [i.item, i]))
  return wrap(h('div', null,
    h('header', { style: { marginBottom: 8 } },
      h('div', { style: { fontWeight: 600, ...primary } }, board.key, h(FlagCount, { flags })),
      h('div', { style: { ...muted, ...small } },
        [board.parent, 'revision ' + board.revision, board.updatedAt ? whenText(board.updatedAt) : ''].filter(Boolean).join(' · '))),
    showDrift(view) ? h(Drift, { drift: board.drift }) : null,
    h(NeedsYou, { board }),
    board.tasks.length
      ? h('ul', { style: { padding: 0, margin: '8px 0 0' } },
        panelRows(board).map((row) => h(TaskRow, { key: row.item, row, flags: flagsOf.get(row.item) || [], drift: driftOf.get(row.item) })))
      : h('p', { style: muted }, 'No tasks yet.')))
}

// ---- Chat cards for the board tools (the keyed tool.call.toolview slot) ----

const parseArgs = (raw) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {} } catch { return {} } }

/**
 * The card's one-line state and title (pure; exported for tests). The title is
 * the result meta's title when the host recorded one, else lib/present.js's
 * call title from the arguments.
 */
function toolCardModel(props) {
  const name = props.toolName || props.block?.name
  const block = props.block || {}
  if (props.phase === 'preparing') return { state: 'running', title: 'Board', summary: name }
  const settled = props.phase === 'result'
  const args = parseArgs(settled ? block.call?.argsRaw ?? '' : block.argsRaw ?? '')
  const metaTitle = settled && block.meta && typeof block.meta.title === 'string' ? block.meta.title : undefined
  const state = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
  let output = null
  if (settled) {
    const parts = (block.content || []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
    output = parts.join('\n') || null
    if (output) { try { const v = JSON.parse(output); if (v && v.ok === false) return { state: 'error', title: 'Board', summary: callTitle(name, args) + ' · ' + v.code, output } } catch {} }
  }
  const summary = (metaTitle || callTitle(name, args)) + (state === 'error' ? ' · failed' : state === 'stopped' ? ' · stopped' : '')
  return { state, title: 'Board', summary, output }
}

function pretty(output) {
  try { const v = JSON.parse(output); return typeof v?.tree === 'string' ? v.tree : JSON.stringify(v, null, 2) } catch { return output }
}

function BoardToolRow(props) {
  const model = toolCardModel(props)
  const disclosure = props.useDisclosure ? props.useDisclosure() : null
  const [localOpen, setLocalOpen] = React.useState(false)
  const open = disclosure ? disclosure.expanded : localOpen
  const toggle = disclosure ? disclosure.toggle : () => setLocalOpen(!localOpen)
  const expandable = model.output !== null && model.output !== undefined
  const summaryStyle = model.state === 'error' ? { color: 'var(--dsw-alias-state-error-primary)' } : model.state === 'stopped' ? { color: 'var(--dsw-alias-state-warn-label)' } : null
  const Icon = primitives.IconChecklistOutlineRegular
  const icon = Icon ? h(Icon, { size: 14 }) : null
  const summary = h('span', { style: { ...small, ...summaryStyle, marginLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, model.summary)
  const body = open && expandable ? h('pre', { style: { ...mono, ...small, ...secondary, whiteSpace: 'pre-wrap', margin: '4px 0 4px 4px', maxHeight: 260, overflow: 'auto' } }, pretty(model.output)) : null
  if (primitives.DisclosureRow) {
    return h('div', { 'data-tool': props.toolName, 'data-state': model.state },
      h(primitives.DisclosureRow, { icon, title: model.title, open: open && expandable, expandable, onToggle: toggle, running: model.state === 'running', expandOnRowClick: true, collapsedContent: summary, keepContentWhenOpen: true }, body))
  }
  return h('div', { 'data-tool': props.toolName, 'data-state': model.state, style: { ...muted } },
    h('div', { onClick: expandable ? toggle : undefined, style: { cursor: expandable ? 'pointer' : 'default', display: 'flex', alignItems: 'center' } }, icon, h('span', { style: small }, model.title), summary),
    body)
}

const inject = ['slots', 'sidebarRightTabs']

function apply(ctx) {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: KIND,
    title: () => 'Board',
    guide: [{ id: 'open', order: 70, title: () => 'Board', description: () => "This session's dsh-cockpit board" }],
  }), 'dsh-cockpit: sidebar tab')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: ID,
    inject: (sessionId) => ({ sessionId }),
  }, BoardBody))
  for (const key of TOOLS) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key }, BoardToolRow))
  }
}

module.exports = { apply, inject, treeOrder, boardRows, needsYou, taskUrl, whenText, showDrift, toolCardModel, TOOLS }
