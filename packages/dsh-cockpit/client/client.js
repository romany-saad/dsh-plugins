window.__ModuleLoader__.load({ id: "@romany-saad/dsh-cockpit", factory: (shellRequire) => {
var module = { exports: {} }; var exports = module.exports;
var __local = {
"../../lib/rows.js": (() => {
// What each board row says: one model shared by the tree text (lib/tree.js),
// the Board panel (client/src/panel.js; client/build.mjs inlines this file) and
// so the reader. Pure, no imports.

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const same = (a, b) => a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase()

/** Items whose parent chain leads back to themselves. */
function parentLoops(tasks) {
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
  return inLoop
}

/** How a task is named in flags and problems: its issue, else its item. */
const refOf = (task) => text(task.issue) ?? String(task.item)

/**
 * Where each task is drawn: Map item -> parent item, or undefined at the top.
 * A task with a known parent outside a loop sits under it. A task in a parent
 * loop sits under its nearest ancestor outside the loop; with none, or with a
 * parent not on the board, under the board's root task (the one root task
 * with children, when there is exactly one), else at the top, after the real
 * roots (misplaced lists those).
 * @returns {{ parentOf: Map<string, string|undefined>, misplaced: Set<string> }}
 */
function placement(tasks) {
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const inLoop = parentLoops(tasks)
  const roots = tasks.filter((t) => t.parent === undefined && tasks.some((c) => c.parent === t.item))
  const boardRoot = roots.length === 1 ? roots[0].item : undefined
  const parentOf = new Map()
  const misplaced = new Set()
  for (const t of tasks) {
    if (t.parent === undefined) { parentOf.set(t.item, undefined); continue }
    if (byItem.has(t.parent) && !inLoop.has(t.item)) { parentOf.set(t.item, t.parent); continue }
    let at
    const seen = new Set([t.item])
    for (let p = t.parent; p !== undefined && byItem.has(p) && !seen.has(p); p = byItem.get(p).parent) {
      if (!inLoop.has(p)) { at = p; break }
      seen.add(p)
    }
    at = at ?? boardRoot
    parentOf.set(t.item, at)
    if (at === undefined) misplaced.add(t.item)
  }
  return { parentOf, misplaced }
}

/**
 * Tasks in tree order: [{ task, depth, guide, children }], placed by
 * placement(); a task whose drawn parent is not drawn (only) is a root. guide
 * is the tree prefix ('├─ ', '│  └─ ', …); children are the drawn child tasks.
 * @param {object[]} tasks
 * @param {{only?: Set<string>}} [options]
 */
function treeOrder(tasks, { only } = {}) {
  const { parentOf, misplaced } = placement(tasks)
  const drawn = tasks.filter((t) => !only || only.has(t.item))
  const under = (t) => { const p = parentOf.get(t.item); return p !== undefined && (!only || only.has(p)) ? p : undefined }
  const children = new Map()
  for (const t of drawn) {
    const p = under(t)
    if (p === undefined) continue
    if (!children.has(p)) children.set(p, [])
    children.get(p).push(t)
  }
  const rows = []
  const visited = new Set()
  const walk = (t, depth, stem, guide) => {
    if (visited.has(t.item)) return
    visited.add(t.item)
    const kids = (children.get(t.item) ?? []).filter((c) => !visited.has(c.item))
    rows.push({ task: t, depth, guide, children: kids })
    kids.forEach((c, i) => {
      const last = i === kids.length - 1
      walk(c, depth + 1, stem + (last ? '   ' : '│  '), stem + (last ? '└─ ' : '├─ '))
    })
  }
  const tops = drawn.filter((t) => under(t) === undefined)
  for (const t of tops) if (!misplaced.has(t.item)) walk(t, 0, '', '')
  for (const t of tops) if (misplaced.has(t.item)) walk(t, 0, '', '')
  return rows
}

/** Issue and pr values two or more tasks share: [{ field, value, items }]. */
function duplicateRefs(tasks) {
  const out = []
  for (const field of ['issue', 'pr']) {
    const by = new Map()
    for (const t of tasks) {
      const v = text(t[field])
      if (!v) continue
      if (!by.has(v)) by.set(v, [])
      by.get(v).push(String(t.item))
    }
    for (const [value, items] of by) if (items.length > 1) out.push({ field, value, items })
  }
  return out
}

/**
 * Flags, never refusals, in board order: unknown_parent, parent_loop (with
 * path, the loop's refs from the task back to it), unknown_dependency, and
 * duplicate_issue / duplicate_pr (with items).
 * @returns {{item: string, code: string, ref: string, path?: string[], items?: string[]}[]}
 */
function boardFlags(tasks) {
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const inLoop = parentLoops(tasks)
  const dups = duplicateRefs(tasks)
  const flags = []
  for (const t of tasks) {
    if (t.parent !== undefined && !byItem.has(t.parent)) flags.push({ item: t.item, code: 'unknown_parent', ref: t.parent })
    if (inLoop.has(t.item)) {
      const path = [refOf(t)]
      for (let p = t.parent; ; p = byItem.get(p).parent) { path.push(refOf(byItem.get(p))); if (p === t.item) break }
      flags.push({ item: t.item, code: 'parent_loop', ref: t.parent, path })
    }
    for (const d of Array.isArray(t.dependsOn) ? t.dependsOn : []) if (!byItem.has(d)) flags.push({ item: t.item, code: 'unknown_dependency', ref: d })
    for (const d of dups) if (d.items.includes(String(t.item))) flags.push({ item: t.item, code: 'duplicate_' + d.field, ref: d.value, items: d.items })
  }
  return flags
}

/** A row's flag: "parent loop: #885 → #886 → #885", "blocked by 'x' (not on the board)", … */
function flagText(f) {
  if (f.code === 'parent_loop') return 'parent loop: ' + (f.path ?? []).join(' → ')
  if (f.code === 'unknown_parent') return 'parent ' + f.ref + ' not on the board'
  if (f.code === 'unknown_dependency') return "blocked by '" + f.ref + "' (not on the board)"
  if (f.code === 'duplicate_issue' || f.code === 'duplicate_pr') return 'duplicate ' + f.code.slice(10) + ' ' + f.ref + ' (items ' + f.items.join(', ') + ')'
  return f.code.replace(/_/g, ' ') + ' ' + f.ref
}

/**
 * The board's problems, one per loop, unknown reference and shared value:
 * [{ item, items, text }]; item is the row to show, items every row involved.
 * "Parent loop: #885 ↔ #886", "Unknown dependency: 'release notes' on #887".
 */
function problems(tasks) {
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const out = []
  const looped = new Set()
  for (const f of boardFlags(tasks)) {
    const on = refOf(byItem.get(f.item))
    if (f.code === 'parent_loop') {
      if (looped.has(f.item)) continue
      const items = [f.item]
      for (let p = f.ref; p !== f.item; p = byItem.get(p).parent) items.push(p)
      items.forEach((i) => looped.add(i))
      const loop = f.path.length === 3 ? f.path[0] + ' ↔ ' + f.path[1] : f.path.join(' → ')
      out.push({ item: f.item, items, text: 'Parent loop: ' + loop })
    } else if (f.code === 'unknown_parent') out.push({ item: f.item, items: [f.item], text: "Unknown parent: '" + f.ref + "' on " + on })
    else if (f.code === 'unknown_dependency') out.push({ item: f.item, items: [f.item], text: "Unknown dependency: '" + f.ref + "' on " + on })
    else if (f.items[0] === String(f.item)) out.push({ item: f.item, items: f.items, text: 'Duplicate ' + f.code.slice(10) + ': ' + f.ref + ' (items ' + f.items.join(', ') + ')' })
  }
  return out
}

/** waitingOn is "owner", ignoring case and surrounding space. */
const waitsOnOwner = (task) => text(task.waitingOn)?.toLowerCase() === 'owner'

/**
 * The open tasks that wait on the owner. With no waitingOn anywhere on the
 * board, a guess: waiting tasks whose nextAction starts with "Owner".
 * @returns {{ tasks: object[], guessed: boolean }}
 */
function needsYou(tasks) {
  const open = tasks.filter((t) => t.status !== 'done')
  if (tasks.some((t) => text(t.waitingOn))) return { tasks: open.filter(waitsOnOwner), guessed: false }
  return { tasks: open.filter((t) => t.status === 'waiting' && /^owner/i.test(text(t.nextAction) ?? '')), guessed: true }
}

/** nextAction, why and extra.startCondition, present and each text once, in that order. */
function notes(task) {
  const extra = task.extra && typeof task.extra === 'object' ? task.extra : {}
  const out = []
  for (const [label, value] of [['next', task.nextAction], ['why', task.why], ['starts when', extra.startCondition]]) {
    const t = text(value)
    if (t && !out.some((n) => same(n.text, t))) out.push({ label, text: t })
  }
  return out
}

/** "model · effort"; the provider only when the model does not start with it, or it is not claude. */
function modelText(task) {
  const provider = text(task.provider)
  const model = text(task.model)
  const showProvider = provider && (!model || !model.startsWith(provider) || provider !== 'claude')
  return [showProvider ? provider : undefined, model, text(task.effort)].filter(Boolean).join(' · ')
}

const REPO_REF = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/

/**
 * A link for an issue or PR reference: an https URL as stored, owner/repo#n,
 * or #n with the repo of the board's parent (owner/repo#n). Else undefined.
 * @param {string} ref
 * @param {'pull'|'issues'} kind
 * @param {string} [parent] the board's parent reference
 */
function refUrl(ref, kind, parent) {
  const r = text(ref)
  if (!r) return undefined
  if (/^https:\/\/\S+$/.test(r)) return r
  const full = REPO_REF.exec(r)
  if (full) return 'https://github.com/' + full[1] + '/' + kind + '/' + full[2]
  const short = /^#(\d+)$/.exec(r)
  const repo = REPO_REF.exec(text(parent) ?? '')
  if (short && repo) return 'https://github.com/' + repo[1] + '/' + kind + '/' + short[1]
  return undefined
}

/** The task's link: its pr, else its issue. */
const taskUrl = (task, parent) => refUrl(task.pr, 'pull', parent) ?? refUrl(task.issue, 'issues', parent)

/** "#884 Profile and guard": the issue first, unless what already starts with it. */
function titleText(task) {
  const what = String(task.what ?? '')
  const issue = text(task.issue)
  return issue && !what.startsWith(issue) ? issue + ' ' + what : what
}

/**
 * The board's rows in tree order, each with what it shows:
 * - line: the one wait phrase of an open row (the first note); others: the rest;
 * - blockedBy: on next and waiting rows, each dependency on the board not done yet;
 * - ready: a next row whose dependencies are all on the board and done;
 * - after: its dependencies on the board, by issue, else item;
 * - progress: on a row with children, { done, total, needsYou } of its children.
 * @param {{tasks: object[], parent?: string}} board
 * @param {{only?: Set<string>}} [options]
 */
function boardRows(board, options = {}) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const mine = new Set(needsYou(tasks).tasks.map((t) => t.item))
  return treeOrder(tasks, options).map(({ task, depth, guide, children }) => {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : []
    const done = task.status === 'done'
    const all = notes(task)
    const open = !done && all.length ? all[0] : undefined
    const blocked = task.status === 'next' || task.status === 'waiting'
    return {
      item: task.item,
      depth,
      guide,
      status: task.status,
      done,
      what: task.what,
      title: titleText(task),
      issue: task.issue,
      pr: task.pr,
      line: open?.text,
      others: open ? all.slice(1) : all,
      needsYou: mine.has(task.item),
      ready: task.status === 'next' && deps.every((d) => byItem.get(d)?.status === 'done'),
      blockedBy: blocked ? deps.filter((d) => byItem.has(d) && byItem.get(d).status !== 'done').map((d) => ({ ref: byItem.get(d).issue || d, status: byItem.get(d).status })) : [],
      // Only dependencies on the board; an unknown one shows in its flag alone.
      after: deps.filter((d) => byItem.has(d)).map((d) => byItem.get(d).issue || d),
      progress: children.length ? { done: children.filter((c) => c.status === 'done').length, total: children.length, needsYou: children.filter((c) => mine.has(c.item)).length } : undefined,
      model: modelText(task),
      url: taskUrl(task, board.parent),
      readyCommand: text(task.readyCommand),
      waitingOn: text(task.waitingOn),
      branch: text(task.branch),
      worktree: text(task.worktree),
    }
  })
}

/** "3 of 6 done · 1 needs you". */
const progressText = (p) => p.done + ' of ' + p.total + ' done' + (p.needsYou ? ' · ' + p.needsYou + ' needs you' : '')

/** "blocked by #884 (waiting), #885 (now)". */
const blockedText = (blockedBy) => 'blocked by ' + blockedBy.map((b) => b.ref + ' (' + b.status + ')').join(', ')

/**
 * The whole board's progress, for the bar at the chat input. done and total
 * count the work tasks: those with no children (a parent's own progress is
 * its children's). needsYou counts needsYou(). focus is the most important
 * open work task, in tree order, the first present of: one that waits on the
 * owner, one next or waiting that is blocked (a dependency on the board not
 * done, or one not on the board), one now; else undefined.
 * @param {{tasks: object[], parent?: string}} board
 * @returns {{ done: number, total: number, needsYou: number, focus?: { kind: 'needs you'|'blocked'|'now', item: string, title: string } }}
 */
function boardProgress(board) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const rows = boardRows(board).filter((r) => !r.progress)
  const open = rows.filter((r) => !r.done)
  const deps = (r) => { const d = byItem.get(r.item).dependsOn; return Array.isArray(d) ? d : [] }
  const waits = (r) => r.status === 'next' || r.status === 'waiting'
  const pick = [
    ['needs you', (r) => r.needsYou],
    ['blocked', (r) => waits(r) && (r.blockedBy.length > 0 || deps(r).some((d) => !byItem.has(d)))],
    ['now', (r) => r.status === 'now'],
  ]
  let focus
  for (const [kind, test] of pick) {
    const r = open.find(test)
    if (r) { focus = { kind, item: r.item, title: r.title }; break }
  }
  return { done: rows.length - open.length, total: rows.length, needsYou: needsYou(tasks).tasks.length, focus }
}

/** "4 of 6 done · 1 needs you", then the focus: "#884 Profile and guard" when it needs you, else "blocked: …" or "now: …". */
function boardProgressText(p) {
  const head = progressText(p)
  if (!p.focus) return head
  return head + ' · ' + (p.focus.kind === 'needs you' ? '' : p.focus.kind + ': ') + p.focus.title
}

return { parentLoops, placement, treeOrder, duplicateRefs, boardFlags, flagText, problems, waitsOnOwner, needsYou, notes, modelText, refUrl, taskUrl, titleText, boardRows, progressText, blockedText, boardProgress, boardProgressText }
})(),
"../../lib/present.js": (() => {
// Tool-card titles (GenericCallView / GenericResultView of dsh-tools): one
// short line per call saying what it did. Pure: they depend only on the call's
// args and, for the result, on the value's own presentationMeta projection.

const MAX = 48
const clip = (s) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > MAX ? t.slice(0, MAX - 1) + '…' : t }
const quote = (s) => '"' + clip(s) + '"'
const KIND = { board_open: 'read', board_read: 'read', board_add: 'edit', board_update: 'edit' }

function readFilters(args = {}) {
  const parts = []
  if (args.item !== undefined) parts.push('item ' + args.item)
  if (Array.isArray(args.status) && args.status.length) parts.push(args.status.join(', '))
  if (args.checkDrift) parts.push('drift check')
  return parts
}

function addTitle(item, args) {
  const parts = ['add ' + (item ?? 'next') + ' ' + quote(args.what ?? '')]
  parts.push(args.status ?? 'next')
  if (Array.isArray(args.dependsOn) && args.dependsOn.length) parts.push('after ' + args.dependsOn.join(', '))
  return parts.join(' · ')
}

function updateTitle(args) {
  if (args.remove) return 'remove ' + args.item
  const set = args.set && typeof args.set === 'object' ? args.set : {}
  const entries = Object.entries(set)
  if (!entries.length) return 'update ' + args.item + ' (no change)'
  let head = 'update ' + args.item
  if (typeof set.status === 'string') head += ' → ' + set.status
  const rest = entries.filter(([k, v]) => !(k === 'status' && typeof v === 'string')).map(([k, v]) => {
    if (v === null) return 'clear ' + k
    if (k === 'what') return quote(v)
    if (k === 'dependsOn' && Array.isArray(v)) return 'after ' + (v.length ? v.join(', ') : 'nothing')
    if (typeof v === 'object') return k
    return k + ' ' + clip(v)
  })
  return rest.length ? head + ': ' + rest.join(', ') : head
}

/** The pending card's title, from the args alone. */
function callTitle(name, args = {}) {
  switch (name) {
    case 'board_open': return 'open ' + args.key + (args.parent !== undefined ? ' · parent ' + clip(args.parent) : '')
    case 'board_read': return ['read board', ...readFilters(args)].join(' · ')
    case 'board_add': return addTitle(args.item, args)
    case 'board_update': return updateTitle(args)
    default: return name
  }
}

/** The completed card's title, from the args and the result value; undefined keeps the call title. */
function resultTitle(name, args = {}, value) {
  if (!value || value.ok !== true) return undefined
  switch (name) {
    case 'board_open': return 'open ' + value.board.key + (value.created ? ' (new)' : '') + (args.parent !== undefined ? ' · parent ' + clip(args.parent) : '')
    case 'board_read': return ['read ' + value.board.key, ...readFilters(args)].join(' · ')
    case 'board_add': return addTitle(value.task.item, { ...args, status: value.task.status })
    default: return undefined
  }
}

/** defineTool fields: presentCall, presentResult and output.presentationMeta. */
function presentation(name) {
  return {
    presentCall: (args) => ({ card: 'generic', title: callTitle(name, args), kind: KIND[name] ?? 'other' }),
    presentResult: (_args, result) => {
      const title = !result?.isError && typeof result?.meta?.title === 'string' ? result.meta.title : undefined
      return title === undefined ? undefined : { card: 'generic', title }
    },
    presentationMeta: (args, value) => {
      const title = resultTitle(name, args, value)
      return title === undefined ? null : { title }
    },
  }
}

return { callTitle, resultTitle, presentation }
})()
};
var require = (name) => (Object.prototype.hasOwnProperty.call(__local, name) ? __local[name] : shellRequire(name));
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

function BoardBody({ sessionId }) {
  const { loading, view, error } = useView(sessionId)
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
const TRACK = { flex: 'none', width: 72, height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,0.25))' }

/**
 * The dock's model (pure; exported for tests): undefined, so nothing renders,
 * unless the session has a bound board that parsed; else the progress, its
 * phrase and the done fraction.
 */
function dockModel(view) {
  if (!view || !view.key || !view.board) return undefined
  const p = boardProgress(view.board)
  return { ...p, text: boardProgressText(p), fraction: p.total ? p.done / p.total : 0 }
}

function BoardDock({ sessionId, openBoard }) {
  const { view } = useView(sessionId)
  const m = dockModel(view)
  if (!m) return null
  const label = m.text + (openBoard ? ' · open the Board' : '')
  return h('div', { 'data-dsh-cockpit-dock': '', style: DOCK },
    h('button', {
      type: 'button', onClick: openBoard ? () => openBoard() : undefined, 'aria-label': label, title: openBoard ? 'Open the Board' : undefined,
      style: { ...DOCK_BAR, cursor: openBoard ? 'pointer' : 'default', ...primary },
    },
      h('span', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': m.total, 'aria-valuenow': m.done, 'aria-label': 'Tasks done', style: TRACK },
        h('span', { style: { display: 'block', height: '100%', width: Math.round(m.fraction * 100) + '%', background: 'var(--dsw-alias-state-success-primary, #3a3)' } })),
      h('span', { style: { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...secondary } },
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
  // A click opens the Board tab: openTab acts on the on-screen session, the dock's.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-cockpit-progress',
    order: 30,
    inject: (sessionId) => ({ sessionId, openBoard: () => ctx.sidebarRight.openTab(KIND) }),
  }, BoardDock))
}

module.exports = { apply, inject, treeOrder, boardRows, boardProgress, needsYou, problems, taskUrl, whenText, showDrift, dockModel, toolCardModel, TOOLS }

return module.exports;
} });
