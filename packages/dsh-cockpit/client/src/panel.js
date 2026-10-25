// dsh-cockpit's browser half: a read-only "Board" tab in the right sidebar.
// Plain CommonJS body: client/build.mjs wraps it in the module-loader factory.
// Externals come from the shell's module table (react, ui-primitives).
const React = require('react')
const { StateDot, Tag } = require('@deepseek-ai/dsh-client-ui-primitives')
const h = React.createElement

const ID = '@romany-saad/dsh-cockpit'
const KIND = 'dsh-cockpit-board'
const POLL_MS = 2000
// Relative to the document, as dsh-client-ui-deliverables does, so a mounted app works.
const VIEW = 'api/dsh-cockpit/view'

const DOT = { now: 'ongoing', waiting: 'warning', done: 'done', next: 'idle' }
const FLAG_TEXT = { unknown_parent: 'unknown parent', unknown_dependency: 'unknown dependency', parent_loop: 'parent loop' }
const muted = { color: 'var(--dsw-alias-label-tertiary)' }
const secondary = { color: 'var(--dsw-alias-label-secondary)' }
const mono = { fontFamily: 'var(--dsw-font-family-mono, ui-monospace, monospace)' }

/** Order tasks as a tree (the core's lib/tree.js rules): rows of { task, depth }. */
function treeRows(tasks) {
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const inLoop = new Set()
  for (const t of tasks) {
    const seen = new Set()
    let p = t.parent
    while (p !== undefined && byItem.has(p) && !seen.has(p)) {
      if (p === t.item) { inLoop.add(t.item); break }
      seen.add(p)
      p = byItem.get(p).parent
    }
  }
  const isRoot = (t) => t.parent === undefined || !byItem.has(t.parent) || inLoop.has(t.item)
  const children = new Map()
  for (const t of tasks) {
    if (isRoot(t)) continue
    if (!children.has(t.parent)) children.set(t.parent, [])
    children.get(t.parent).push(t)
  }
  const rows = []
  const visited = new Set()
  const walk = (t, depth) => {
    if (visited.has(t.item)) return
    visited.add(t.item)
    rows.push({ task: t, depth })
    for (const c of children.get(t.item) || []) walk(c, depth + 1)
  }
  for (const t of tasks) if (isRoot(t)) walk(t, 0)
  return rows
}

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

function Field({ label, value }) {
  if (value === undefined || value === null || value === '') return null
  return h('span', { style: { marginRight: 10 } }, h('span', { style: muted }, label + ' '), h('span', { style: mono }, value))
}

/**
 * What one row shows, derived from the board only (pure; exported for tests).
 * ready: a next task whose dependsOn items are all on the board and done.
 * after: each dependency by its task's issue when it has one, else its item.
 */
function rowModel(task, byItem) {
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn : []
  const active = task.status === 'now' || task.status === 'waiting'
  const extra = task.extra && typeof task.extra === 'object' ? task.extra : {}
  return {
    item: task.item,
    status: task.status,
    what: task.what,
    ready: task.status === 'next' && deps.every((d) => byItem.get(d)?.status === 'done'),
    issue: task.issue,
    pr: task.pr,
    model: [task.provider, task.model, task.effort].filter(Boolean).join(' · '),
    after: deps.map((d) => byItem.get(d)?.issue || d),
    why: task.status === 'waiting' ? task.why : undefined,
    nextAction: active ? task.nextAction : undefined,
    startCondition: typeof extra.startCondition === 'string' ? extra.startCondition : undefined,
    readyCommand: task.readyCommand,
  }
}

/** The board's rows in tree order: [{ depth, ...rowModel }]. */
function boardRows(board) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  return treeRows(tasks).map(({ task, depth }) => ({ depth, ...rowModel(task, byItem) }))
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

const line = { paddingLeft: 28, fontSize: 'var(--dsh-content-font-size-secondary, 12px)', marginTop: 2 }

function Note({ label, value }) {
  if (!value) return null
  return h('div', { style: line }, h('span', { style: muted }, label + ' '), h('span', { style: secondary }, value))
}

function Command({ command }) {
  if (!command) return null
  const copy = () => { navigator.clipboard?.writeText(command).catch(() => {}) }
  return h('div', { style: { ...line, display: 'flex', alignItems: 'center', gap: 6 } },
    h('span', { style: muted }, 'command '),
    h('code', { style: { ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, command),
    h('button', { type: 'button', title: 'Copy the command', onClick: copy, style: { font: 'inherit', fontSize: 11, padding: '0 6px', cursor: 'pointer' } }, 'copy'))
}

function TaskRow({ row, flags, drift }) {
  return h('li', { 'data-item': row.item, style: { listStyle: 'none', padding: '6px 0', paddingLeft: row.depth * 16, borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      row.ready ? h(Tag, null, 'ready') : h(StateDot, { state: DOT[row.status] || 'idle' }),
      h('span', { style: { ...mono, ...secondary, minWidth: 24 } }, row.item),
      h('span', { style: { ...secondary, minWidth: 56 } }, row.status),
      h('span', { style: { color: 'var(--dsw-alias-label-primary)', flex: 1 } }, row.what)),
    h('div', { style: line },
      h(Field, { label: 'issue', value: row.issue }),
      h(Field, { label: 'pr', value: row.pr }),
      h(Field, { label: 'model', value: row.model }),
      row.after.length ? h('span', { style: { ...muted, marginRight: 10 } }, 'after ' + row.after.join(', ')) : null,
      flags.map((f, i) => h(Tag, { key: i }, '! ' + (FLAG_TEXT[f.code] || f.code) + (f.code === 'parent_loop' ? '' : ' ' + f.ref))),
      drift ? h(Tag, null, 'drift: ' + (drift.status || '?') + (drift.note ? ' (' + drift.note + ')' : '')) : null),
    h(Note, { label: 'why', value: row.why }),
    h(Note, { label: 'starts when', value: row.startCondition }),
    h(Note, { label: 'next', value: row.nextAction }),
    h(Command, { command: row.readyCommand }))
}

function Drift({ drift }) {
  if (!drift) return h('div', { style: muted }, 'Drift: never checked')
  const differing = (drift.items || []).filter((i) => i.differs)
  return h('div', null,
    h('span', { style: muted }, 'Drift checked ' + drift.checkedAt + ': '),
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

function BoardBody({ sessionId }) {
  const { loading, view, error } = useView(sessionId)
  const wrap = (child) => h('section', { 'data-dsh-cockpit-board': '', style: { padding: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box' } }, child)
  if (loading) return wrap(h('p', { style: muted }, 'Loading board…'))
  if (error) return wrap(h('p', { role: 'alert' }, 'Board unavailable: ' + error))
  if (!view.key) return wrap(h(Boards, { boards: view.boards }))
  if (!view.board) return wrap(h('div', null, h('p', { role: 'alert' }, view.key + ': ' + view.error), view.boards ? h(Boards, { boards: view.boards, note: 'Boards in the folder:' }) : null))
  const { board, flags } = view
  const flagsOf = new Map()
  for (const f of flags) { if (!flagsOf.has(f.item)) flagsOf.set(f.item, []); flagsOf.get(f.item).push(f) }
  const driftOf = new Map(((board.drift && board.drift.items) || []).filter((i) => i.differs).map((i) => [i.item, i]))
  return wrap(h('div', null,
    h('header', { style: { marginBottom: 8 } },
      h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, board.key),
      h('div', { style: { ...muted, fontSize: 'var(--dsh-content-font-size-secondary, 12px)' } },
        [board.parent, 'revision ' + board.revision, board.updatedAt ? whenText(board.updatedAt) : ''].filter(Boolean).join(' · '))),
    flags.length ? h('div', { style: { marginBottom: 8 } }, h('span', { style: muted }, 'Flags: '),
      flags.map((f, i) => h(Tag, { key: i }, f.item + ': ' + (FLAG_TEXT[f.code] || f.code) + (f.code === 'parent_loop' ? '' : ' ' + f.ref)))) : null,
    h(Drift, { drift: board.drift }),
    board.tasks.length
      ? h('ul', { style: { padding: 0, margin: '8px 0 0' } },
        boardRows(board).map((row) => h(TaskRow, { key: row.item, row, flags: flagsOf.get(row.item) || [], drift: driftOf.get(row.item) })))
      : h('p', { style: muted }, 'No tasks yet.')))
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
}

module.exports = { apply, inject, treeRows, rowModel, boardRows, whenText }
