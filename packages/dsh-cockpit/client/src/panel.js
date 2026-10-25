// dsh-cockpit's browser half: a read-only "Board" tab in the right sidebar,
// a progress bar above the chat input, and one-line chat card titles for the
// four board tools.
// Plain CommonJS body: client/build.mjs wraps it in the module-loader factory
// and inlines the core's pure lib/rows.js and lib/present.js, so the panel,
// the hub's tree text and the tool cards share their rules.
// Externals come from the shell's module table (react, ui-primitives).
const React = require('react')
const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
const { blockedText, boardFlags, boardProgress, boardProgressText, boardRows, flagText, needsYou, problems, progressText, taskUrl, titleText, treeOrder } = require('../../lib/rows.js')
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
const muted = { color: 'var(--dsw-alias-label-tertiary)' }
const secondary = { color: 'var(--dsw-alias-label-secondary)' }
const primary = { color: 'var(--dsw-alias-label-primary)' }
const mono = { fontFamily: 'var(--dsw-font-family-mono, ui-monospace, monospace)' }
const small = { fontSize: 'var(--dsh-content-font-size-secondary, 12px)' }
const STATUS_WIDTH = '8.5em'
// The status dot's slot, kept on every row so the status words line up.
const DOT_SLOT = { display: 'inline-flex', justifyContent: 'center', width: '1em', flex: 'none' }
// Tree guides: thin and faint, scenery rather than content.
const guideStyle = { color: 'var(--dsw-alias-label-tertiary)', opacity: 0.45 }
const button = { font: 'inherit', fontSize: 11, padding: '0 6px', cursor: 'pointer' }
// The row's right-hand columns, fixed so every row's right edge lines up.
const OPEN_SLOT = { display: 'inline-block', width: '3em', textAlign: 'right', flex: 'none' }
const OPENER_SLOT = { display: 'inline-block', width: '1em', textAlign: 'center', flex: 'none' }

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

/** Show the drift line when drift is configured or the file holds a drift result; else hide it. */
const showDrift = (view) => Boolean(view.driftConfigured || view.board?.drift)

function OpenLink({ url }) {
  if (!url) return null
  // No title tooltip: it covered the next row's link. The browser's status bar
  // shows the URL on hover.
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open ' + url, style: { ...muted, fontSize: 11, whiteSpace: 'nowrap', textDecoration: 'none' }, onClick: (e) => e.stopPropagation() }, 'Open')
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
  add('model', row.model)
  add('branch', row.branch, mono)
  add('worktree', row.worktree, mono)
  if (drift) add('drift', (drift.status || '?') + (drift.note ? ' (' + drift.note + ')' : ''))
  return h('div', { 'data-detail': '', style: { ...small, padding: '2px 0 4px', paddingLeft: 'calc(' + row.idWidth + 'ch + ' + STATUS_WIDTH + ')' } },
    items,
    row.needsYou ? null : h(Command, { command: row.readyCommand }))
}

function Status({ row }) {
  const slot = row.progress ? null : row.done ? h('span', { style: { ...muted, fontSize: 11 } }, '✓') : h(StateDot, { state: DOT[row.status] || 'idle' })
  return h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 6 } },
    h('span', { 'aria-hidden': true, 'data-dot': '', style: DOT_SLOT }, slot),
    row.progress ? h('span', { style: secondary }, progressText(row.progress)) : h('span', null, row.status))
}

function TaskRow({ row, flags, drift }) {
  const [open, setOpen] = React.useState(false)
  const toggle = () => setOpen(!open)
  const hasDetail = row.others.length || row.model || row.branch || row.worktree || row.waitingOn || drift ||
    (row.readyCommand && !row.needsYou) || (row.after.length && !row.blockedBy.length)
  const tone = row.done ? muted : primary
  const extras = []
  if (row.ready) extras.push(h(Tag, { key: 'ready' }, 'ready'))
  if (row.blockedBy.length) extras.push(h('span', { key: 'blocked', style: { ...small, ...secondary } }, blockedText(row.blockedBy)))
  if (row.needsYou) extras.push(h(Tag, { key: 'you' }, 'needs you'))
  flags.forEach((f, i) => extras.push(h(Tag, { key: 'f' + i }, '! ' + flagText(f))))
  if (drift) extras.push(h(Tag, { key: 'drift' }, 'drift: ' + (drift.status || '?')))
  return h('li', { 'data-item': row.item, 'data-done': row.done || undefined, style: { listStyle: 'none', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
    h('div', {
      role: hasDetail ? 'button' : undefined, tabIndex: hasDetail ? 0 : undefined, 'aria-expanded': hasDetail ? open : undefined,
      onClick: hasDetail ? toggle : undefined,
      onKeyDown: hasDetail ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } } : undefined,
      style: { display: 'flex', alignItems: 'baseline', padding: '5px 0', cursor: hasDetail ? 'pointer' : 'default' },
    },
      h('span', { style: { ...mono, ...muted, whiteSpace: 'pre', width: row.idWidth + 'ch', flex: 'none' } },
        h('span', { 'aria-hidden': true, style: guideStyle }, row.guide), h('span', { style: row.done ? muted : secondary }, row.item)),
      h('span', { style: { ...small, ...(row.done ? muted : secondary), width: STATUS_WIDTH, flex: 'none', whiteSpace: 'nowrap', overflow: 'visible' } }, h(Status, { row })),
      h('span', { style: { flex: 1, minWidth: 0 } },
        h('span', { style: tone }, row.title),
        row.pr ? h('span', { style: { ...muted, ...small, marginLeft: 8, whiteSpace: 'nowrap' } }, 'PR ' + row.pr) : null,
        // A row in Needs you shows its action there only; here just the tag.
        row.line && !row.needsYou ? h('div', { style: { ...small, ...secondary, marginTop: 1 } }, row.line) : null,
        extras.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 2 } }, extras) : null),
      h('span', { style: { flex: 'none', display: 'inline-flex', gap: 6, alignItems: 'baseline', marginLeft: 6 } },
        h('span', { 'data-open-slot': '', style: OPEN_SLOT }, h(OpenLink, { url: row.url })),
        h('span', { 'data-opener': '', 'aria-hidden': true, style: { ...OPENER_SLOT, ...muted, ...small } }, hasDetail ? (open ? '▾' : '▸') : null))),
    open ? h(Detail, { row, flags, drift }) : null)
}

function Drift({ drift }) {
  if (!drift) return h('div', { style: { ...muted, ...small } }, 'Drift check available · not run yet')
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

function showRow(item) {
  const el = typeof document !== 'undefined' && document.querySelector('[data-dsh-cockpit-board] li[data-item="' + String(item).replace(/["\\]/g, '\\$&') + '"]')
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/** One line per problem under the header; each shows its row. None: nothing. */
function Problems({ tasks }) {
  const list = problems(tasks)
  if (!list.length) return null
  const warn = 'var(--dsw-alias-state-warn-label, #c90)'
  return h('section', { 'data-problems': '', style: { ...small, margin: '6px 0', padding: '4px 8px', borderLeft: '2px solid ' + warn } },
    list.map((p, i) => h('div', { key: i },
      h('button', { type: 'button', onClick: () => showRow(p.item), title: 'Show the row', style: { font: 'inherit', background: 'none', border: 0, padding: '1px 0', cursor: 'pointer', textAlign: 'left', ...secondary } },
        h('span', { 'aria-hidden': true, style: { color: warn, marginRight: 6 } }, '!'), p.text))))
}

/** Rows plus the id column's width in characters (guide and item). */
function panelRows(board) {
  const rows = boardRows(board)
  const idWidth = Math.max(0, ...rows.map((r) => (r.guide + r.item).length)) + 2
  return rows.map((r) => ({ ...r, idWidth }))
}

// Tab id -> the navigation revision already scrolled to, so a remounted body
// does not jump back to an old click.
const scrolledTo = new Map()

/**
 * A dock segment opens the tab with params { item }; the body scrolls to that
 * row once the board has rendered, once per navigation.
 */
function useShowRow(useTabInfo, ready) {
  const tab = useTabInfo ? useTabInfo().tab : undefined
  const nav = tab && tab.navigation
  const item = nav && nav.params && nav.params.item
  React.useEffect(() => {
    if (!ready || item === undefined || scrolledTo.get(tab.id) === nav.revision) return
    scrolledTo.set(tab.id, nav.revision)
    showRow(item)
  }, [ready, item, nav && nav.revision])
}

function BoardBody({ sessionId, useTabInfo }) {
  const { loading, view, error } = useView(sessionId)
  useShowRow(useTabInfo, Boolean(view && view.board))
  const wrap = (child) => h('section', { 'data-dsh-cockpit-board': '', style: { padding: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box' } }, child)
  if (loading) return wrap(h('p', { style: muted }, 'Loading board…'))
  if (error) return wrap(h('p', { role: 'alert' }, 'Board unavailable: ' + error))
  if (!view.key) return wrap(h(Boards, { boards: view.boards }))
  if (!view.board) return wrap(h('div', null, h('p', { role: 'alert' }, view.key + ': ' + view.error), view.boards ? h(Boards, { boards: view.boards, note: 'Boards in the folder:' }) : null))
  const { board } = view
  // Flags from the shared rules, so the panel and the hub's text agree.
  const flags = boardFlags(board.tasks)
  const flagsOf = new Map()
  for (const f of flags) { if (!flagsOf.has(f.item)) flagsOf.set(f.item, []); flagsOf.get(f.item).push(f) }
  const driftOf = new Map(((board.drift && board.drift.items) || []).filter((i) => i.differs).map((i) => [i.item, i]))
  return wrap(h('div', null,
    h('header', { style: { marginBottom: 8 } },
      h('div', { style: { fontWeight: 600, ...primary } }, board.key),
      h('div', { style: { ...muted, ...small } },
        [board.parent, 'revision ' + board.revision, board.updatedAt ? whenText(board.updatedAt) : ''].filter(Boolean).join(' · '))),
    h(Problems, { tasks: board.tasks }),
    showDrift(view) ? h(Drift, { drift: board.drift }) : null,
    h(NeedsYou, { board }),
    board.tasks.length
      ? h('ul', { style: { padding: 0, margin: '8px 0 0' } },
        panelRows(board).map((row) => h(TaskRow, { key: row.item, row, flags: flagsOf.get(row.item) || [], drift: driftOf.get(row.item) })))
      : h('p', { style: muted }, 'No tasks yet.')))
}

// ---- The progress bar above the chat input (conversation.input.dock) ----

// Sized like the other composer docks (the goal strip): the composer's width, its panel elevation.
const DOCK = {
  boxSizing: 'border-box', margin: '0 auto',
  width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 0px) - 4 * var(--dsh-composer-dock-inset, 0px))',
}
const DOCK_BAR = {
  boxSizing: 'border-box', width: '100%', maxWidth: 'calc(var(--dsh-composer-card-max-width, 100%) - 4 * var(--dsh-composer-dock-inset, 0px))',
  margin: '0 auto', height: 32, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 10,
  font: 'inherit', fontSize: 13, textAlign: 'left', border: 0, borderRadius: 'var(--dsw-radius-md, 8px)',
  background: 'var(--dsw-specific-menu, var(--dsw-alias-bg-l1, transparent))', boxShadow: 'var(--dsw-elevation-panel)',
  '--dsw-elevation-stroke-color': 'var(--dsw-alias-border-l1)',
}
// The bar: one segment per work task, a 2 px gap between; above SEGMENT_MAX one fill.
const TRACK = { flex: 'none', height: 6, display: 'flex', gap: 2, alignItems: 'stretch' }
const SEGMENT = { flex: '1 1 0', minWidth: 3, borderRadius: 1.5, boxSizing: 'border-box', cursor: 'pointer' }
const SUCCESS = 'var(--dsw-alias-state-success-primary, #3a3)'
const ACCENT = 'var(--dsw-alias-brand-primary, #36f)'
const WARN = 'var(--dsw-alias-state-warn-primary, #c90)'
const LIGHT = 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.6))'
const FAINT = 'var(--dsw-alias-fill-l2, rgba(127,127,127,0.25))'
// Status by fill and shape, never moving: the bar polls and sits by the input.
// now is half filled with the accent (started, not finished); needs you is
// the warn fill with an outline; the tooltip and phrase say it in words.
const FILL = {
  done: { background: SUCCESS },
  now: { background: 'linear-gradient(to right, ' + ACCENT + ' 50%, ' + FAINT + ' 50%)', boxShadow: 'inset 0 0 0 1px ' + ACCENT },
  waiting: { background: WARN },
  'needs you': { background: WARN, boxShadow: 'inset 0 0 0 1px var(--dsw-alias-label-primary, #000)' },
  ready: { background: LIGHT, opacity: 0.7 },
  blocked: { background: FAINT },
}

/**
 * The dock's model (pure; exported for tests): undefined, so nothing renders,
 * unless the session has a bound board that parsed; else the progress with its
 * segments, its phrase and the done fraction.
 */
function dockModel(view) {
  if (!view || !view.key || !view.board) return undefined
  const p = boardProgress(view.board)
  return { ...p, text: boardProgressText(p), fraction: p.total ? p.done / p.total : 0 }
}

/** The bar as text, for tests and the hub: "[✓][✓][◐ now][·blocked][!waiting]". */
const SEGMENT_TEXT = { done: '✓', now: '◐ now', waiting: '!waiting', 'needs you': '!!needs you', ready: '○ready', blocked: '·blocked' }
const segmentsText = (m) => (m.continuous ? '[' + '█'.repeat(Math.round(m.fraction * 10)).padEnd(10, '░') + ']' : m.segments.map((g) => '[' + SEGMENT_TEXT[g.kind] + ']').join(''))

function Bar({ m, openBoard }) {
  if (m.continuous || !m.segments.length) {
    return h('span', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': m.total, 'aria-valuenow': m.done, 'aria-label': 'Tasks done', title: progressText(m), style: { ...TRACK, width: 72, borderRadius: 2, overflow: 'hidden', background: FAINT } },
      h('span', { style: { display: 'block', height: '100%', width: Math.round(m.fraction * 100) + '%', background: SUCCESS } }))
  }
  const width = Math.min(180, Math.max(72, m.segments.length * 16))
  return h('span', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': m.total, 'aria-valuenow': m.done, 'aria-label': 'Tasks done', style: { ...TRACK, width } },
    m.segments.map((g) => h('span', {
      key: g.item, 'data-segment': g.kind, 'data-item': g.item, title: g.tooltip,
      onClick: openBoard ? (e) => { e.stopPropagation(); openBoard(g.item) } : undefined,
      style: { ...SEGMENT, ...FILL[g.kind], cursor: openBoard ? 'pointer' : 'default' },
    })))
}

function BoardDock({ sessionId, openBoard }) {
  const { view } = useView(sessionId)
  const m = dockModel(view)
  if (!m) return null
  const label = m.text + (openBoard ? ' · open the Board' : '')
  const open = openBoard ? () => openBoard() : undefined
  return h('div', { 'data-dsh-cockpit-dock': '', style: DOCK },
    // A div, not a button: the segments inside take their own clicks.
    h('div', {
      role: openBoard ? 'button' : undefined, tabIndex: openBoard ? 0 : undefined, onClick: open, 'aria-label': label,
      onKeyDown: open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } : undefined,
      style: { ...DOCK_BAR, cursor: openBoard ? 'pointer' : 'default', ...primary },
    },
      h(Bar, { m, openBoard }),
      h('span', { title: openBoard ? 'Open the Board' : undefined, style: { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...secondary } },
        h('span', { style: primary }, progressText(m)),
        m.text.length > progressText(m).length ? m.text.slice(progressText(m).length) : null)))
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

const inject = ['slots', 'sidebarRightTabs', 'sidebarRight']

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
  // Above the input box, after the Todo, Goal and Queue docks (orders 0, 10, 20).
  // A click opens the Board tab: openTab acts on the on-screen session, the dock's;
  // a segment's click also names its row.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-cockpit-progress',
    order: 30,
    // With an item, the Board scrolls to its row (navigation params, see useShowRow).
    inject: (sessionId) => ({ sessionId, openBoard: (item) => ctx.sidebarRight.openTab(KIND, item === undefined ? undefined : { params: { item } }) }),
  }, BoardDock))
}

module.exports = { apply, inject, treeOrder, boardRows, boardProgress, needsYou, problems, taskUrl, whenText, showDrift, dockModel, segmentsText, toolCardModel, TOOLS }
