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

/** "model · effort" (sep between); the provider only when the model does not start with it, or it is not claude. */
function modelText(task, sep = ' · ') {
  const provider = text(task.provider)
  const model = text(task.model)
  const showProvider = provider && (!model || !model.startsWith(provider) || provider !== 'claude')
  return [showProvider ? provider : undefined, model, text(task.effort)].filter(Boolean).join(sep)
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
      lineLabel: open?.label,
      others: open ? all.slice(1) : all,
      needsYou: mine.has(task.item),
      ready: task.status === 'next' && deps.every((d) => byItem.get(d)?.status === 'done'),
      blockedBy: blocked ? deps.filter((d) => byItem.has(d) && byItem.get(d).status !== 'done').map((d) => ({ ref: byItem.get(d).issue || d, status: byItem.get(d).status })) : [],
      // Only dependencies on the board; an unknown one shows in its flag alone.
      after: deps.filter((d) => byItem.has(d)).map((d) => byItem.get(d).issue || d),
      progress: children.length ? { done: children.filter((c) => c.status === 'done').length, total: children.length, needsYou: children.filter((c) => mine.has(c.item)).length } : undefined,
      model: modelText(task),
      url: taskUrl(task, board.parent),
      prUrl: refUrl(task.pr, 'pull', board.parent),
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

/** Above this many work tasks the bar is one continuous fill: segments get too thin. */
const SEGMENT_MAX = 24

/**
 * The whole board's progress, for the bar at the chat input. done and total
 * count the work tasks: those with no children (a parent's own progress is
 * its children's). needsYou counts needsYou().
 *
 * segments: one per work task, in tree order, { item, kind, tooltip }; kind is
 * done, 'needs you' (an open task needsYou() lists), now, waiting, ready (next,
 * every dependency on the board and done) or blocked (next, else). tooltip:
 * "#887 Live checks and docs · next · blocked by #884". A task's blockers are
 * its row's blockedBy (by issue, else item) and, on a next or waiting task,
 * each dependency not on the board: "'release notes' (not on the board)".
 * continuous: more than SEGMENT_MAX work tasks, so the bar draws one fill.
 *
 * focus is the most important open work, in tree order, the first present of:
 * one that needs you ("#884 Profile and guard"), one with blockers ("#887
 * blocked by #886 (waiting)"), the ones now ("in progress: #885 Work reports", "2 in
 * progress: #885, #886"); else undefined.
 * @param {{tasks: object[], parent?: string}} board
 * @returns {{ done: number, total: number, needsYou: number, continuous: boolean,
 *   segments: { item: string, kind: string, tooltip: string }[],
 *   focus?: { kind: 'needs you'|'blocked'|'now', item: string, title: string, text: string } }}
 */
function boardProgress(board) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const rows = boardRows(board).filter((r) => !r.progress)
  const work = rows.map((r) => {
    const task = byItem.get(r.item)
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : []
    const waits = r.status === 'next' || r.status === 'waiting'
    const unknown = waits ? deps.filter((d) => !byItem.has(d)).map((d) => "'" + d + "' (not on the board)") : []
    const blockers = r.blockedBy.map((b) => b.ref).concat(unknown)
    // The phrase names each blocker's status too: "#886 (waiting)".
    const blockersWithStatus = r.blockedBy.map((b) => b.ref + ' (' + b.status + ')').concat(unknown)
    const kind = r.done ? 'done' : r.needsYou ? 'needs you' : r.status === 'now' ? 'now' : r.status === 'waiting' ? 'waiting' : r.ready ? 'ready' : 'blocked'
    const runner = r.status === 'now' ? modelText(task, ' ') : ''
    const tooltip = [r.title, r.status, runner, blockers.length ? 'blocked by ' + blockers.join(', ') : '', kind === 'ready' ? 'ready' : '', r.needsYou && !r.done ? 'needs you' : ''].filter(Boolean).join(' · ')
    return { row: r, blockers, blockersWithStatus, segment: { item: r.item, kind, tooltip } }
  })
  const open = work.filter((w) => !w.row.done)
  const at = (w, kind, text) => ({ kind, item: w.row.item, title: w.row.title, text })
  let focus
  const mine = open.find((w) => w.row.needsYou)
  const blocked = open.find((w) => w.blockers.length)
  const now = open.filter((w) => w.row.status === 'now')
  if (mine) focus = at(mine, 'needs you', mine.row.title)
  else if (blocked) focus = at(blocked, 'blocked', refOf(blocked.row) + ' blocked by ' + blocked.blockersWithStatus.join(', '))
  else if (now.length === 1) focus = at(now[0], 'now', 'in progress: ' + now[0].row.title)
  else if (now.length) focus = at(now[0], 'now', now.length + ' in progress: ' + now.map((w) => refOf(w.row)).join(', '))
  return {
    done: rows.length - open.length, total: rows.length, needsYou: needsYou(tasks).tasks.length,
    segments: work.map((w) => w.segment), continuous: rows.length > SEGMENT_MAX, focus,
  }
}

/** "4 of 6 done · 1 needs you", then the focus's text. */
function boardProgressText(p) {
  const head = progressText(p)
  return p.focus ? head + ' · ' + p.focus.text : head
}

// ---- Batch 6: what the Board panel (design C, Outline) and the strip show ----

/** The row's status mark: a check for done, a ring for next, else a dot (now: accent, waiting: grey). */
const STATUS_MARK = { done: 'check', next: 'ring', now: 'dot-now', waiting: 'dot-waiting' }

/** The meta line's label for each note: "Next:", "Reason:", "Start when:". */
const NOTE_LABEL = { next: 'Next:', why: 'Reason:', 'starts when': 'Start when:', 'waiting on': 'Waiting on' }
/** The detail grid's key for each note. */
const DETAIL_KEY = { next: 'Next', why: 'Reason', 'starts when': 'Start when' }

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** "PR #892" from "#892", "o/r#892" or ".../pull/892"; "PR" for anything else. */
function prText(pr) {
  const v = text(pr)
  if (!v) return undefined
  const n = /(?:#|\/pull\/)(\d+)\/?$/.exec(v)
  return n ? 'PR #' + n[1] : 'PR'
}

/**
 * One row's cells in the fixed columns (id · status · title · PR · chevron),
 * from a boardRows() row and its boardFlags():
 * - parent: a top row with children, drawn as the parent row (progress, no status);
 * - mark: STATUS_MARK; wrap: open titles wrap, done titles truncate (tooltip: the title);
 * - indent: 16 px steps inside the title cell, depth below the parent row; elbow: └ from depth 2;
 * - pr: "PR #892", linked by prUrl;
 * - next: the one meta line of an open row not in Needs you, { label, text }:
 *   "Waiting on <who>" on a waiting row with waitingOn (not the owner), else its first note;
 * - blockedBy, ready, needsYou ("Needs you · see top"); problems: each flag's text, in place;
 * - detail: [{ key, value, mono }] (the other notes, waiting on, model, branch, worktree);
 * - command: the ready command, unless the row is in Needs you (the card has it);
 * - expandable: detail or a command to show.
 */
function rowCells(row, flags = []) {
  const parent = Boolean(row.progress) && row.depth === 0
  // The one meta line: an open row's first note, unless Needs you holds it.
  // A waiting row that names who it waits on (not the owner) says so: "Waiting on CI".
  const waitsOn = row.status === 'waiting' && row.waitingOn && row.waitingOn.toLowerCase() !== 'owner' ? row.waitingOn : undefined
  const open = !row.done && !row.needsYou
  const shown = open && waitsOn ? { label: 'waiting on', text: waitsOn } : open && row.line ? { label: row.lineLabel, text: row.line } : undefined
  const notesLeft = row.line && (!shown || waitsOn) ? [{ label: row.lineLabel, text: row.line }, ...row.others] : row.others
  const detail = notesLeft.map((n) => ({ key: DETAIL_KEY[n.label] ?? capital(n.label), value: n.text, mono: false }))
  if (row.waitingOn && row.waitingOn.toLowerCase() !== 'owner' && !waitsOn) detail.push({ key: 'Waiting on', value: row.waitingOn, mono: false })
  if (row.model) detail.push({ key: 'Model', value: row.model, mono: true })
  if (row.branch) detail.push({ key: 'Branch', value: row.branch, mono: true })
  if (row.worktree) detail.push({ key: 'Worktree', value: row.worktree, mono: true })
  const command = row.needsYou ? undefined : row.readyCommand
  return {
    item: row.item,
    parent,
    status: parent ? undefined : row.status,
    mark: parent ? undefined : STATUS_MARK[row.status] ?? 'dot-waiting',
    title: row.title,
    wrap: !row.done,
    indent: parent ? 0 : Math.max(0, row.depth - 1),
    elbow: !parent && row.depth >= 2,
    pr: prText(row.pr),
    prUrl: row.prUrl,
    progress: parent ? progressText({ done: row.progress.done, total: row.progress.total }) : undefined,
    progressNeedsYou: parent && row.progress.needsYou ? row.progress.needsYou + ' needs you' : undefined,
    next: shown ? { label: NOTE_LABEL[shown.label] ?? capital(shown.label) + ':', text: shown.text } : undefined,
    needsYou: !row.done && row.needsYou,
    blockedBy: row.blockedBy,
    ready: row.ready,
    problems: flags.map((f) => capital(flagText(f))),
    detail,
    command,
    expandable: detail.length > 0 || Boolean(command),
  }
}

/**
 * A problems-section line from a problems() entry: { item, kind, refs, text };
 * kind is the text before its colon ("Parent loop"), refs the rows involved,
 * by issue, else item ("#885, #886"), text the full problem (the tooltip).
 */
function problemLine(p, tasks = []) {
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const i = p.text.indexOf(': ')
  const refs = p.items.map((it) => (byItem.has(it) ? refOf(byItem.get(it)) : String(it))).join(', ')
  return { item: p.item, kind: i < 0 ? p.text : p.text.slice(0, i), refs, text: p.text }
}

/** What the panel shows with no board: the design's title and one line. */
const EMPTY_STATE = {
  title: 'No board in this session',
  line: 'A hub agent binds a board when it starts to coordinate work. The board shows here after that.',
}

/**
 * The owner's ask for the strip: the task's nextAction without its "Owner:"
 * lead, first letter lower, final period dropped, "for" the task's title;
 * with no nextAction, the title alone.
 */
function askText(task) {
  const raw = (text(task.nextAction) ?? '').replace(/^owner\s*[:,-]?\s*/i, '').replace(/\.$/, '').trim()
  return raw ? raw.charAt(0).toLowerCase() + raw.slice(1) + ' for ' + titleText(task) : titleText(task)
}

/**
 * The strip above the chat input (design C):
 * - normal: { kind: 'normal', key, done: "4 of 6 done", focus?: the focus phrase };
 * - needs you: { kind: 'needs you', text: "Needs you: <ask>", command?, item } for
 *   one ask (command: its readyCommand, for Copy command), "2 need you" (no
 *   command) for more. Both carry the progress (segments) of boardProgress().
 * @param {{key?: string, tasks: object[], parent?: string}} board
 */
function stripModel(board) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const p = boardProgress(board)
  const mine = needsYou(tasks).tasks
  const base = { key: board?.key, progress: p, done: progressText({ done: p.done, total: p.total }) }
  if (mine.length === 1) return { ...base, kind: 'needs you', text: 'Needs you: ' + askText(mine[0]), command: text(mine[0].readyCommand), item: mine[0].item }
  if (mine.length > 1) return { ...base, kind: 'needs you', text: mine.length + ' need you', item: mine[0].item }
  return { ...base, kind: 'normal', focus: p.focus?.text }
}

/** The strip as one line of text: "sim-883 · 4 of 6 done · <focus> · Board ›" or "⚠ Needs you: … · Copy command · Board ›". */
function stripText(m) {
  if (m.kind === 'needs you') return ['⚠ ' + m.text, m.command ? 'Copy command' : '', 'Board ›'].filter(Boolean).join(' · ')
  return [m.key, m.done, m.focus, 'Board ›'].filter(Boolean).join(' · ')
}
return { parentLoops, placement, treeOrder, duplicateRefs, boardFlags, flagText, problems, waitsOnOwner, needsYou, notes, modelText, refUrl, taskUrl, titleText, boardRows, progressText, blockedText, SEGMENT_MAX, boardProgress, boardProgressText, STATUS_MARK, prText, rowCells, problemLine, EMPTY_STATE, askText, stripModel, stripText }
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
})(),
"./command-box.js": (() => {
// CommandBox: a command in monospace with a Copy button fixed at its top right.
// The command wraps at spaces first, then anywhere (white-space: pre-wrap with
// overflow-wrap: anywhere, in a minmax(0, 1fr) grid cell), so it never widens
// the panel. Import-free: client/build.mjs inlines it; React comes from the
// caller, so the copy state machine below is testable without a browser.

/** How long "Copied" (or "Copy failed") shows before the button reads Copy again. */
const COPY_RESET_MS = 1500

/** The button's words in each state. */
const COPY_LABEL = { idle: 'Copy', copied: 'Copied', failed: 'Copy failed' }

/**
 * The copy state machine: idle | copied | failed. 'copied' and 'failed' come
 * from the clipboard write; 'reset' (COPY_RESET_MS later) returns to idle.
 * Anything else keeps the state.
 */
function copyStep(state, event) {
  if (event === 'copied' || event === 'failed') return event
  if (event === 'reset') return 'idle'
  return state
}

/** Write text with clipboard.writeText: 'copied', or 'failed' when there is no clipboard or it refuses. */
async function copyText(text, clipboard) {
  try {
    if (!clipboard || typeof clipboard.writeText !== 'function') return 'failed'
    await clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** The copy icon: two overlapping rounded squares. */
function copyIcon(h) {
  return h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round', 'aria-hidden': true },
    h('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5 }), h('path', { d: 'M10.5 3.5H4a1.5 1.5 0 00-1.5 1.5v6' }))
}

/**
 * The hook and component, built on the caller's React.
 * useCopy(text) -> [state, copy]; copy(event) copies text and stops the click.
 * CommandBox({ command, label }) draws the box; label names the button for
 * screen readers ("Copy command for #886").
 */
function makeCommandBox(React) {
  const h = React.createElement
  function useCopy(text) {
    const [state, setState] = React.useState('idle')
    const timer = React.useRef ? React.useRef(undefined) : { current: undefined }
    React.useEffect(() => () => clearTimeout(timer.current), [])
    const copy = (e) => {
      if (e && e.stopPropagation) e.stopPropagation()
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      copyText(text, clipboard).then((result) => {
        setState((s) => copyStep(s, result))
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setState((s) => copyStep(s, 'reset')), COPY_RESET_MS)
      })
    }
    return [state, copy]
  }
  function CommandBox({ command, label }) {
    const [state, copy] = useCopy(command)
    return h('div', { className: 'dshc-cmd', 'data-command-box': '' },
      h('code', null, command),
      h('button', { type: 'button', className: 'dshc-btn', 'aria-label': state === 'idle' ? label || 'Copy command' : COPY_LABEL[state], 'data-copy-state': state, onClick: copy },
        copyIcon(h), COPY_LABEL[state]),
      // Announce the result without moving focus.
      h('span', { role: 'status', className: 'dshc-sr' }, state === 'idle' ? '' : COPY_LABEL[state]))
  }
  return { CommandBox, useCopy }
}

return { COPY_RESET_MS, COPY_LABEL, copyStep, copyText, copyIcon, makeCommandBox }
})()
};
var require = (name) => (Object.prototype.hasOwnProperty.call(__local, name) ? __local[name] : shellRequire(name));
// dsh-cockpit's browser half: a read-only "Board" tab in the right sidebar
// (design C, Outline, refined), a progress strip above the chat input, and
// one-line chat card titles for the four board tools.
// Plain CommonJS body: client/build.mjs wraps it in the module-loader factory
// and inlines the core's pure lib/rows.js, lib/present.js and the CommandBox
// (client/src/command-box.js), so the panel,
// the hub's tree text and the tool cards share their rules.
// Externals come from the shell's module table (react, ui-primitives).
const React = require('react')
const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
const { boardFlags, boardProgress, boardProgressText, boardRows, needsYou, problems, progressText, prText, refUrl, taskUrl, titleText, treeOrder, EMPTY_STATE, problemLine, rowCells, stripModel, stripText } = require('../../lib/rows.js')
const { callTitle } = require('../../lib/present.js')
const { Tag } = primitives
const { makeCommandBox, copyStep, copyText, COPY_LABEL } = require('./command-box.js')
const { CommandBox, useCopy } = makeCommandBox(React)
const h = React.createElement

const ID = '@romany-saad/dsh-cockpit'
const KIND = 'dsh-cockpit-board'
const POLL_MS = 2000
// Relative to the document, as dsh-client-ui-deliverables does, so a mounted app works.
const VIEW = 'api/dsh-cockpit/view'
const TOOLS = ['board_open', 'board_read', 'board_add', 'board_update']

// ---- Style: design C (Outline), refined. Host tokens only; see the batch 6 report. ----
// One stylesheet in the document head, so the rows can use classes (grid,
// hover, wrapping) and the render output stays plain.
const T = {
  surface1: 'var(--dsw-alias-bg-skeleton)', // design surface-l1*: a faint tint in both themes
  surface2: 'var(--dsw-alias-bg-module-platform)', // design surface-l2*
  surface0: 'var(--dsw-alias-bg-base)', // design surface-l0*
  border: 'var(--dsw-alias-border-l1)',
  primary: 'var(--dsw-alias-label-primary)',
  secondary: 'var(--dsw-alias-label-secondary)',
  tertiary: 'var(--dsw-alias-label-tertiary)',
  warn: 'var(--dsw-alias-state-warn-label)',
  error: 'var(--dsw-alias-state-error-primary)', // design state-error*
  success: 'var(--dsw-alias-state-success-primary)', // design state-success*
  info: 'var(--dsw-alias-state-business-primary)', // design state-info*: the Tag primitive's info tone
  mono: 'var(--dsh-font-family-code, var(--dsh-font-family-code-default, ui-monospace, monospace))', // design font-family-mono*
  title: 'var(--dsh-content-font-size-secondary, 13px)', // design font-size-primary* (13 px)
}
const CSS = [
  '[data-dsh-cockpit-board]{box-sizing:border-box;height:100%;overflow:auto;color:' + T.primary + ';font-size:' + T.title + ';line-height:20px;font-variant-numeric:tabular-nums}',
  '.dshc-mono{font-family:' + T.mono + ';font-variant-ligatures:none}',
  '.dshc-trunc{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshc-wrap{display:block;min-width:0;overflow-wrap:anywhere}',
  '[data-dsh-cockpit-board] a{color:inherit;text-decoration:none}[data-dsh-cockpit-board] a:hover{text-decoration:underline}',
  '.dshc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
  '.dshc-hd{padding:12px 12px 10px;border-bottom:1px solid ' + T.border + '}',
  '.dshc-hd1{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
  '.dshc-hdl{display:flex;align-items:baseline;gap:8px;min-width:0}',
  '.dshc-key{font-size:13px;font-weight:500;flex:none;max-width:60%}',
  '.dshc-parent{font-size:12px;color:' + T.tertiary + '}',
  '.dshc-meta{font-size:12px;color:' + T.tertiary + ';white-space:nowrap;flex:none}',
  '.dshc-drift{font-size:12px;line-height:16px;color:' + T.tertiary + ';margin-top:2px}',
  '.dshc-sec{padding:10px 12px 12px;border-bottom:1px solid ' + T.border + '}',
  '.dshc-sech{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;line-height:16px;margin-bottom:8px}',
  '.dshc-warn{color:' + T.warn + '}.dshc-err{color:' + T.error + '}',
  '.dshc-guess{text-transform:none;letter-spacing:0;font-weight:400;color:' + T.tertiary + '}',
  '.dshc-ni{display:grid;grid-template-columns:36px minmax(0,1fr) auto;column-gap:8px;row-gap:4px;background:' + T.surface1 + ';border:1px solid ' + T.border + ';border-radius:8px;padding:8px}',
  '.dshc-ni+.dshc-ni{margin-top:8px}',
  '.dshc-ni .dshc-id{color:' + T.tertiary + ';font-size:12px}',
  '.dshc-nit{font-weight:500}',
  '.dshc-ask{grid-column:2/4;font-size:12px;line-height:16px;color:' + T.secondary + ';overflow-wrap:anywhere}',
  '.dshc-ni .dshc-cmd{grid-column:1/4}',
  '.dshc-open{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:' + T.secondary + ';white-space:nowrap}',
  '.dshc-cmd{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;background:' + T.surface2 + ';border:1px solid ' + T.border + ';border-radius:6px;padding:4px 4px 4px 10px;margin-top:4px;position:relative}',
  '.dshc-cmd code{font-family:' + T.mono + ';font-size:12px;line-height:18px;padding:3px 0;color:' + T.primary + ';white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}',
  '.dshc-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:4px;border:1px solid ' + T.border + ';background:' + T.surface0 + ';color:' + T.primary + ';font:inherit;font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;flex:none}',
  '.dshc-btn[data-copy-state=failed]{color:' + T.error + '}',
  '.dshc-prob{display:grid;grid-template-columns:16px minmax(0,1fr) auto 20px;column-gap:8px;align-items:center;width:100%;height:28px;padding:0;border:0;background:none;font:inherit;font-size:12px;color:' + T.primary + ';text-align:left;cursor:pointer}',
  '.dshc-prob .dshc-ic{color:' + T.error + '}.dshc-prob .dshc-ids{color:' + T.secondary + '}.dshc-prob .dshc-go{color:' + T.tertiary + ';display:flex;justify-content:center}',
  '.dshc-tree{margin:0;padding:0;list-style:none}',
  '.dshc-li{list-style:none;border-bottom:1px solid ' + T.border + '}',
  '.dshc-li:focus{outline:2px solid ' + T.info + ';outline-offset:-2px}',
  '.dshc-row{display:grid;grid-template-columns:36px 68px minmax(0,1fr) 60px 20px;column-gap:8px;row-gap:2px;align-items:start;padding:6px 12px}',
  '.dshc-row>*{min-height:20px}',
  '.dshc-li.dshc-parentrow{background:' + T.surface1 + '}',
  '.dshc-parentrow .dshc-ct{font-weight:600}',
  '.dshc-cid{font-size:12px;color:' + T.tertiary + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshc-cst{display:flex;align-items:center;gap:6px;font-size:12px;color:' + T.secondary + '}',
  '.dshc-check{color:' + T.success + ';flex:none}',
  '.dshc-mark{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none}',
  '.dshc-dot{width:8px;height:8px;border-radius:50%;box-sizing:border-box}',
  '.dshc-dot-now{background:' + T.info + '}.dshc-dot-waiting{background:' + T.tertiary + '}',
  '.dshc-ring{width:8px;height:8px;border-radius:50%;box-sizing:border-box;border:1.5px solid ' + T.secondary + '}',
  '.dshc-ct{display:flex;align-items:flex-start;min-width:0}',
  '.dshc-indent{flex:none}',
  '.dshc-elbow{flex:none;width:8px;height:8px;border-left:1px solid ' + T.tertiary + ';border-bottom:1px solid ' + T.tertiary + ';margin:4px 6px 0 2px}',
  '.dshc-done .dshc-ct,.dshc-done .dshc-cst{color:' + T.secondary + '}',
  '.dshc-cpr{font-size:12px;color:' + T.secondary + ';text-align:right;white-space:nowrap}',
  '.dshc-chev{display:flex;align-items:center;justify-content:center;height:20px;padding:0;border:0;background:none;color:' + T.tertiary + ';cursor:pointer}',
  '.dshc-chev svg[data-open]{transform:rotate(90deg)}',
  '.dshc-cmeta{grid-column:3/5;display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:' + T.secondary + ';min-height:0}',
  '.dshc-k{color:' + T.tertiary + '}',
  '.dshc-block{display:flex;align-items:center;gap:6px;color:' + T.primary + '}.dshc-block b{font-weight:500}.dshc-block .dshc-st{color:' + T.tertiary + '}',
  '.dshc-mprob{display:flex;align-items:flex-start;gap:6px;color:' + T.error + '}.dshc-mprob svg{flex:none;margin-top:2px}',
  // Over the Tag primitive's outline tone (class + attribute), so these win: square, currentColor border.
  '.dshc-cmeta .dshc-tag[data-tone]{align-self:flex-start;background:transparent;border:1px solid currentColor;border-radius:4px;padding:0 6px;font-weight:600;line-height:16px}',
  '.dshc-cmeta .dshc-tag-warn[data-tone]{color:' + T.warn + '}.dshc-cmeta .dshc-tag-ok[data-tone]{color:' + T.success + '}.dshc-cmeta .dshc-tag-quiet[data-tone]{color:' + T.secondary + '}',
  '.dshc-detail{grid-column:2/5;margin-top:6px;padding-top:8px;border-top:1px dashed ' + T.border + ';min-height:0}',
  '.dshc-detail dl{display:grid;grid-template-columns:80px minmax(0,1fr);column-gap:8px;row-gap:4px;margin:0 0 4px;font-size:12px;line-height:16px}',
  '.dshc-detail dt{color:' + T.tertiary + '}.dshc-detail dd{margin:0;color:' + T.secondary + ';overflow-wrap:anywhere}.dshc-detail dd.dshc-mono{color:' + T.primary + '}',
  '.dshc-pbar{display:flex;gap:2px;height:4px;margin:4px 0 2px}',
  '.dshc-need{color:' + T.warn + ';font-weight:500}',
  '.dshc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 40px;gap:6px}',
  '.dshc-empty p{margin:0}.dshc-empty-t{font-weight:500}.dshc-empty-s{font-size:12px;line-height:16px;color:' + T.secondary + ';max-width:280px}',
  '.dshc-msg{padding:12px;color:' + T.secondary + '}',
].join('\n')

function useStyle() {
  React.useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('dsh-cockpit-style')) return
    const el = document.createElement('style')
    el.id = 'dsh-cockpit-style'
    el.textContent = CSS
    document.head.appendChild(el)
  }, [])
}

// ---- Icons (16 px grid, stroke) ----
const svg = (size, children, extra) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, children)
const warnIcon = (size = 12, extra) => svg(size, [h('path', { key: 1, d: 'M8 2.5l6 10.5H2z' }), h('path', { key: 2, d: 'M8 6.5v3' }), h('path', { key: 3, d: 'M8 11.6v.1' })], extra)
const checkIcon = () => svg(14, h('path', { d: 'M3.5 8.5l3 3 6-7' }), { strokeWidth: 1.8, className: 'dshc-check' })
const lockIcon = () => svg(12, [h('rect', { key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }), h('path', { key: 2, d: 'M5.5 7V5a2.5 2.5 0 015 0v2' })])
const extIcon = () => svg(12, [h('path', { key: 1, d: 'M9 3.5h3.5V7' }), h('path', { key: 2, d: 'M12.5 3.5L7 9' }), h('path', { key: 3, d: 'M11 9.5v2.5a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6.5a1 1 0 011-1H7' })], { strokeWidth: 1.5 })
const downIcon = () => svg(14, [h('path', { key: 1, d: 'M8 3.5v9' }), h('path', { key: 2, d: 'M4.5 9L8 12.5 11.5 9' })], { strokeWidth: 1.5 })
const chevIcon = (open) => svg(14, h('path', { d: 'M6 4l4 4-4 4' }), { 'data-open': open || undefined })

// ---- The view: polled every 2 s ----
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

/** The clock for relative times: it ticks once a minute, not on every refresh. */
function useMinute() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  return now
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

/** "Drift check: not run yet", "Drift check: no differences · 16:40", "Drift check: 2 differing · 16:40". */
function driftText(drift, now) {
  if (!drift) return 'Drift check: not run yet'
  const at = drift.checkedAt ? ' · ' + whenText(drift.checkedAt, now).split(' · ')[0] : ''
  if (drift.error) return 'Drift check failed' + at + ': ' + String(drift.error.message || JSON.stringify(drift.error))
  const differing = (drift.items || []).filter((i) => i.differs).length
  return 'Drift check: ' + (differing ? differing + ' differing' : 'no differences') + at
}

/** The header's right side: "rev 33 · 15:34 · 9 min ago". */
const headerMeta = (board, now) => ['rev ' + board.revision, board.updatedAt ? whenText(board.updatedAt, now) : ''].filter(Boolean).join(' · ')

// ---- Rows: show one, expand state kept by board and item across refreshes and remounts ----
const expanded = new Map()

/** Move focus to a row, centred, without animation (the problems lines and dock segments). */
function showRow(item) {
  const el = typeof document !== 'undefined' && document.querySelector('[data-dsh-cockpit-board] li[data-item="' + String(item).replace(/["\\]/g, '\\__BODY__') + '"]')
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.focus({ preventScroll: true })
}

function Header({ board, view, now }) {
  return h('header', { className: 'dshc-hd' },
    h('div', { className: 'dshc-hd1' },
      h('span', { className: 'dshc-hdl' },
        h('span', { className: 'dshc-mono dshc-key dshc-trunc', title: board.key }, board.key),
        board.parent ? h('span', { className: 'dshc-parent dshc-trunc', title: board.parent }, board.parent) : null),
      h('span', { className: 'dshc-meta' }, headerMeta(board, now))),
    showDrift(view) ? h('div', { className: 'dshc-drift' }, driftText(board.drift, now)) : null)
}

/** "Open PR #892 ↗" for a pr, "Open #884 ↗" for an issue; nothing without a link. */
function OpenLink({ task, parent }) {
  const url = taskUrl(task, parent)
  if (!url) return null
  const pr = refUrl(task.pr, 'pull', parent)
  const label = pr ? 'Open ' + prText(task.pr) : 'Open ' + (task.issue || '')
  return h('a', { className: 'dshc-open', href: url, target: '_blank', rel: 'noopener noreferrer', onClick: (e) => e.stopPropagation() }, label.trim(), extIcon())
}

function NeedsYou({ board }) {
  const { tasks, guessed } = needsYou(board.tasks)
  if (!tasks.length) return null
  return h('section', { className: 'dshc-sec', 'data-needs-you': '', 'aria-label': 'Needs you' },
    h('div', { className: 'dshc-sech dshc-warn' }, warnIcon(), 'Needs you', guessed ? h('span', { className: 'dshc-guess', title: 'No task sets waitingOn: these wait and their next step starts with "Owner"' }, ' (guessed)') : null),
    tasks.map((t) => h('div', { key: t.item, className: 'dshc-ni', 'data-item': t.item },
      h('span', { className: 'dshc-mono dshc-id' }, t.item),
      h('span', { className: 'dshc-wrap dshc-nit' }, titleText(t)),
      h(OpenLink, { task: t, parent: board.parent }) || h('span', null),
      t.nextAction ? h('span', { className: 'dshc-ask' }, String(t.nextAction).trim()) : null,
      t.readyCommand ? h(CommandBox, { command: String(t.readyCommand).trim(), label: 'Copy command for ' + titleText(t) }) : null)))
}

/** One line per problem; ↓ moves focus to its row. None: nothing. */
function Problems({ tasks }) {
  const list = problems(tasks)
  if (!list.length) return null
  return h('section', { className: 'dshc-sec', 'data-problems': '', 'aria-label': 'Problems in board data' },
    h('div', { className: 'dshc-sech dshc-err' }, 'Board data problems'),
    list.map((p, i) => {
      const line = problemLine(p, tasks)
      return h('button', { key: i, type: 'button', className: 'dshc-prob', title: line.text, onClick: () => showRow(line.item) },
        h('span', { className: 'dshc-ic' }, warnIcon(14)),
        h('span', { className: 'dshc-trunc' }, line.kind),
        h('span', { className: 'dshc-ids' }, line.refs),
        h('span', { className: 'dshc-go', 'aria-label': 'Go to row', role: 'img' }, downIcon()))
    }))
}

function Mark({ mark }) {
  if (mark === 'check') return checkIcon()
  return h('span', { className: 'dshc-mark', 'aria-hidden': true }, h('span', { className: mark === 'ring' ? 'dshc-ring' : 'dshc-dot dshc-' + mark }))
}

const tag = (key, cls, words) => h(Tag, { key, tone: 'outline', className: 'dshc-tag ' + cls }, words)

function Meta({ c, drift, segments }) {
  const lines = []
  if (segments) lines.push(h(Bar, { key: 'bar', m: segments, thin: true, onSegment: showRow }))
  if (c.progress) lines.push(h('span', { key: 'p' }, c.progress, c.progressNeedsYou ? [' · ', h('span', { key: 'n', className: 'dshc-need' }, c.progressNeedsYou)] : null))
  if (c.next) lines.push(h('span', { key: 'next', className: 'dshc-trunc', title: c.next.text }, h('span', { className: 'dshc-k' }, c.next.label + ' '), c.next.text))
  if (c.needsYou) lines.push(tag('you', 'dshc-tag-warn', 'Needs you · see top'))
  if (c.blockedBy.length) {
    lines.push(h('span', { key: 'b', className: 'dshc-block' }, lockIcon(),
      h('span', { className: 'dshc-wrap' }, h('b', null, 'Blocked by '), c.blockedBy.map((b, i) => h('span', { key: i }, i ? ', ' : '', h('b', null, b.ref), ' ', h('span', { className: 'dshc-st' }, '(' + b.status + ')'))))))
  }
  if (c.ready) lines.push(tag('ready', 'dshc-tag-ok', 'ready'))
  c.problems.forEach((p, i) => lines.push(h('span', { key: 'f' + i, className: 'dshc-mprob' }, warnIcon(12), h('span', { className: 'dshc-wrap' }, p))))
  if (drift) lines.push(tag('drift', 'dshc-tag-quiet', 'drift: ' + (drift.status || '?')))
  return lines.length ? h('div', { className: 'dshc-cmeta' }, lines) : null
}

function Detail({ c, drift }) {
  const items = c.detail.concat(drift ? [{ key: 'Drift', value: (drift.status || '?') + (drift.note ? ' (' + drift.note + ')' : ''), mono: false }] : [])
  return h('div', { className: 'dshc-detail', 'data-detail': '' },
    items.length ? h('dl', null, items.map((d) => [h('dt', { key: d.key + 't' }, d.key), h('dd', { key: d.key + 'd', className: d.mono ? 'dshc-mono' : undefined }, d.value)])) : null,
    c.command ? h(CommandBox, { command: c.command, label: 'Copy command for ' + c.title }) : null)
}

function TaskRow({ boardKey, row, flags, drift, segments }) {
  const c = rowCells(row, flags)
  const id = boardKey + '\u0000' + row.item
  const [open, setOpen] = React.useState(expanded.get(id) === true ? true : false)
  const canOpen = c.expandable || Boolean(drift)
  const toggle = () => { expanded.set(id, !open); setOpen(!open) }
  const isOpen = canOpen && open
  const titleCls = c.wrap ? 'dshc-wrap' : 'dshc-trunc'
  return h('li', { 'data-item': row.item, 'data-done': row.done || undefined, tabIndex: -1, className: 'dshc-li' + (c.parent ? ' dshc-parentrow' : '') + (row.done ? ' dshc-done' : '') },
    h('div', { className: 'dshc-row', onClick: canOpen ? (e) => { if (!e.target.closest || !e.target.closest('a,button')) toggle() } : undefined, style: canOpen ? { cursor: 'pointer' } : undefined },
      h('span', { className: 'dshc-mono dshc-cid', title: row.item }, row.item),
      h('span', { className: 'dshc-cst' }, c.mark ? h(Mark, { mark: c.mark }) : null, c.status ? h('span', null, c.status) : null),
      h('span', { className: 'dshc-ct' },
        c.indent ? h('span', { className: 'dshc-indent', style: { width: c.indent * 16 } }) : null,
        c.elbow ? h('span', { className: 'dshc-elbow', 'aria-hidden': true }) : null,
        h('span', { className: titleCls, title: c.wrap ? undefined : c.title }, c.title)),
      h('span', { className: 'dshc-cpr' }, c.pr && c.prUrl ? h('a', { href: c.prUrl, target: '_blank', rel: 'noopener noreferrer', onClick: (e) => e.stopPropagation() }, c.pr) : c.pr || null),
      canOpen
        ? h('button', { type: 'button', className: 'dshc-chev', 'aria-expanded': isOpen, 'aria-label': 'Details for ' + c.title, onClick: (e) => { e.stopPropagation(); toggle() } }, chevIcon(isOpen))
        : h('span', null),
      h(Meta, { c, drift, segments }),
      isOpen ? h(Detail, { c, drift }) : null))
}

function Empty() {
  return h('div', { className: 'dshc-empty', 'data-empty': '' }, h('p', { className: 'dshc-empty-t' }, EMPTY_STATE.title), h('p', { className: 'dshc-empty-s' }, EMPTY_STATE.line))
}

// Tab id -> the navigation revision already shown, so a remounted body does not jump back to an old click.
const scrolledTo = new Map()

/** A dock segment opens the tab with params { item }; the body shows that row once rendered, once per navigation. */
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
  useStyle()
  const { loading, view, error } = useView(sessionId)
  const now = useMinute()
  useShowRow(useTabInfo, Boolean(view && view.board))
  const wrap = (child) => h('section', { 'data-dsh-cockpit-board': '' }, child)
  if (loading) return wrap(h('p', { className: 'dshc-msg' }, 'Loading board…'))
  if (error) return wrap(h('p', { className: 'dshc-msg', role: 'alert' }, 'Board unavailable: ' + error))
  if (!view.key) return wrap(h(Empty))
  if (!view.board) return wrap(h('p', { className: 'dshc-msg', role: 'alert' }, view.key + ': ' + view.error))
  const { board } = view
  // Flags from the shared rules, so the panel and the hub's text agree.
  const flagsOf = new Map()
  for (const f of boardFlags(board.tasks)) { if (!flagsOf.has(f.item)) flagsOf.set(f.item, []); flagsOf.get(f.item).push(f) }
  const driftOf = new Map(((board.drift && board.drift.items) || []).filter((i) => i.differs).map((i) => [i.item, i]))
  const progress = dockModel(view)
  const rows = boardRows(board)
  // The thin bar sits in the board's one parent row (the root with children).
  const roots = rows.filter((r) => r.depth === 0 && r.progress)
  return wrap(h('div', null,
    h(Header, { board, view, now }),
    h(NeedsYou, { board }),
    h(Problems, { tasks: board.tasks }),
    rows.length
      ? h('ul', { className: 'dshc-tree', role: 'list' }, rows.map((row) => h(TaskRow, {
        key: row.item, boardKey: board.key, row, flags: flagsOf.get(row.item) || [], drift: driftOf.get(row.item),
        segments: roots.length === 1 && roots[0] === row ? progress : undefined,
      })))
      : h('p', { className: 'dshc-msg' }, 'No tasks yet.')))
}

// ---- The progress strip above the chat input (conversation.input.dock) ----

// Sized like the other composer docks (the goal strip): the composer's width, its panel elevation.
const DOCK = {
  boxSizing: 'border-box', margin: '0 auto',
  width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 0px) - 4 * var(--dsh-composer-dock-inset, 0px))',
}
const DOCK_BAR = {
  boxSizing: 'border-box', width: '100%', maxWidth: 'calc(var(--dsh-composer-card-max-width, 100%) - 4 * var(--dsh-composer-dock-inset, 0px))',
  margin: '0 auto', height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8,
  font: 'inherit', fontSize: 12, textAlign: 'left', border: 0, borderRadius: 'var(--dsw-radius-sm, 8px)', whiteSpace: 'nowrap',
  background: 'var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1))', boxShadow: 'var(--dsw-elevation-panel)',
  '--dsw-elevation-stroke-color': 'var(--dsw-alias-border-l1)', color: T.secondary, fontVariantNumeric: 'tabular-nums',
}
// The bar: one segment per work task, a 2 px gap between; above SEGMENT_MAX one fill.
const TRACK = { flex: 'none', height: 6, display: 'flex', gap: 2, alignItems: 'stretch' }
const SEGMENT = { flex: '1 1 0', minWidth: 3, borderRadius: 1.5, boxSizing: 'border-box' }
const FAINT = 'var(--dsw-alias-border-l4)'
// Status by fill and shape, never moving. Warn means one thing: the owner must
// act (design C), so waiting on anyone else is grey. now is half filled with
// the info accent; ready is a success outline; blocked faint.
const FILL = {
  done: { background: T.success },
  now: { background: 'linear-gradient(to right, ' + T.info + ' 50%, ' + FAINT + ' 50%)', boxShadow: 'inset 0 0 0 1px ' + T.info },
  waiting: { background: T.tertiary },
  'needs you': { background: T.warn, boxShadow: 'inset 0 0 0 1px ' + T.primary },
  ready: { background: 'transparent', boxShadow: 'inset 0 0 0 1px ' + T.success },
  blocked: { background: FAINT },
}

/**
 * The dock's model (pure; exported for tests): undefined, so nothing renders,
 * unless the session has a bound board that parsed; else the progress with its
 * segments, its phrase, the done fraction and the strip (stripModel).
 */
function dockModel(view) {
  if (!view || !view.key || !view.board) return undefined
  const p = boardProgress(view.board)
  const strip = stripModel({ ...view.board, key: view.board.key || view.key })
  return { ...p, text: boardProgressText(p), fraction: p.total ? p.done / p.total : 0, strip, line: stripText(strip) }
}

/** The bar as text, for tests and the report: "[✓][✓][◐ now][·blocked][…waiting]". */
const SEGMENT_TEXT = { done: '✓', now: '◐ now', waiting: '…waiting', 'needs you': '!!needs you', ready: '○ready', blocked: '·blocked' }
const segmentsText = (m) => (m.continuous ? '[' + '█'.repeat(Math.round(m.fraction * 10)).padEnd(10, '░') + ']' : m.segments.map((g) => '[' + SEGMENT_TEXT[g.kind] + ']').join(''))

/** The segmented bar: in the strip (6 px, fixed width) or thin in the panel's parent row (4 px, full width). */
function Bar({ m, onSegment, thin }) {
  const track = thin ? { ...TRACK, height: 4, width: '100%', margin: '4px 0 2px' } : { ...TRACK, width: Math.min(180, Math.max(72, m.segments.length * 16)) }
  const aria = { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': m.total, 'aria-valuenow': m.done, 'aria-label': 'Tasks done' }
  if (m.continuous || !m.segments.length) {
    return h('span', { ...aria, title: progressText(m), style: { ...track, borderRadius: 2, overflow: 'hidden', background: FAINT, ...(thin ? {} : { width: 72 }) } },
      h('span', { style: { display: 'block', height: '100%', width: Math.round(m.fraction * 100) + '%', background: T.success } }))
  }
  return h('span', { ...aria, style: track },
    m.segments.map((g) => h('span', {
      key: g.item, 'data-segment': g.kind, 'data-item': g.item, title: g.tooltip,
      onClick: onSegment ? (e) => { e.stopPropagation(); onSegment(g.item) } : undefined,
      style: { ...SEGMENT, ...FILL[g.kind], cursor: onSegment ? 'pointer' : 'default' },
    })))
}

const sep = (key) => h('span', { key, 'aria-hidden': true, style: { color: T.tertiary } }, '·')

function CopyCommand({ command, label }) {
  const [state, copy] = useCopy(command)
  return h('button', { type: 'button', className: 'dshc-btn', 'data-copy-state': state, 'aria-label': state === 'idle' ? label : COPY_LABEL[state], onClick: copy, style: { height: 22, color: state === 'failed' ? T.error : T.primary, background: T.surface1 } },
    state === 'idle' ? 'Copy command' : COPY_LABEL[state])
}

function BoardDock({ sessionId, openBoard }) {
  useStyle()
  const { view } = useView(sessionId)
  const m = dockModel(view)
  if (!m) return null
  const s = m.strip
  const open = openBoard ? () => openBoard() : undefined
  const go = h('button', {
    key: 'go', type: 'button', onClick: open ? (e) => { e.stopPropagation(); openBoard(s.kind === 'needs you' ? s.item : undefined) } : undefined,
    style: { font: 'inherit', fontWeight: 500, color: T.secondary, background: 'none', border: 0, padding: '0 2px', cursor: open ? 'pointer' : 'default', flex: 'none' },
  }, 'Board ›')
  const fill = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
  const parts = s.kind === 'needs you'
    ? [
      h('span', { key: 'w', style: { color: T.warn, display: 'inline-flex', flex: 'none' } }, warnIcon(12)),
      h('span', { key: 'f', style: fill, title: s.text }, h('span', { style: { color: T.warn, fontWeight: 500 } }, s.text.slice(0, s.text.indexOf(':') + 1) || s.text), s.text.indexOf(':') > 0 ? s.text.slice(s.text.indexOf(':') + 1) : null),
      s.command ? h(CopyCommand, { key: 'c', command: s.command, label: 'Copy command for ' + s.text.slice(11) }) : null,
      s.command ? sep('s2') : null,
      go,
    ]
    : [
      h('span', { key: 'k', className: 'dshc-mono', style: { color: T.tertiary, flex: 'none' } }, s.key),
      sep('s1'),
      h('span', { key: 'd', style: { color: T.primary, flex: 'none' } }, s.done),
      s.focus ? sep('s2') : null,
      h('span', { key: 'f', style: fill, title: s.focus }, s.focus || ''),
      go,
    ]
  return h('div', { 'data-dsh-cockpit-dock': '', 'data-strip': s.kind, style: DOCK },
    // A div, not a button: the segments and buttons inside take their own clicks.
    h('div', {
      role: openBoard ? 'button' : undefined, tabIndex: openBoard ? 0 : undefined, onClick: open, 'aria-label': m.line,
      onKeyDown: open ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open() } } : undefined,
      style: { ...DOCK_BAR, cursor: openBoard ? 'pointer' : 'default' },
    },
      h(Bar, { m, onSegment: openBoard }),
      parts))
}

// ---- Chat cards for the board tools (the keyed tool.call.toolview slot) ----

const muted = { color: T.tertiary }
const secondary = { color: T.secondary }
const mono = { fontFamily: T.mono }
const small = { fontSize: 'var(--dsh-content-font-size-secondary, 12px)' }

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

module.exports = { apply, inject, treeOrder, boardRows, boardProgress, needsYou, problems, taskUrl, whenText, showDrift, driftText, headerMeta, dockModel, segmentsText, toolCardModel, copyStep, copyText, TOOLS, CSS }
return module.exports;
} });
