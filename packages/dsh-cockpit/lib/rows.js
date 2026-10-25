// What each board row says: one model shared by the tree text (lib/tree.js),
// the Board panel (client/src/panel.js; client/build.mjs inlines this file) and
// so the reader. Pure, no imports.

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const same = (a, b) => a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase()

/** Items whose parent chain leads back to themselves. */
export function parentLoops(tasks) {
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
export function placement(tasks) {
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
export function treeOrder(tasks, { only } = {}) {
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
export function duplicateRefs(tasks) {
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
export function boardFlags(tasks) {
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
export function flagText(f) {
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
export function problems(tasks) {
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
export const waitsOnOwner = (task) => text(task.waitingOn)?.toLowerCase() === 'owner'

/**
 * The open tasks that wait on the owner. With no waitingOn anywhere on the
 * board, a guess: waiting tasks whose nextAction starts with "Owner".
 * @returns {{ tasks: object[], guessed: boolean }}
 */
export function needsYou(tasks) {
  const open = tasks.filter((t) => t.status !== 'done')
  if (tasks.some((t) => text(t.waitingOn))) return { tasks: open.filter(waitsOnOwner), guessed: false }
  return { tasks: open.filter((t) => t.status === 'waiting' && /^owner/i.test(text(t.nextAction) ?? '')), guessed: true }
}

/** nextAction, why and extra.startCondition, present and each text once, in that order. */
export function notes(task) {
  const extra = task.extra && typeof task.extra === 'object' ? task.extra : {}
  const out = []
  for (const [label, value] of [['next', task.nextAction], ['why', task.why], ['starts when', extra.startCondition]]) {
    const t = text(value)
    if (t && !out.some((n) => same(n.text, t))) out.push({ label, text: t })
  }
  return out
}

/** "model · effort" (sep between); the provider only when the model does not start with it, or it is not claude. */
export function modelText(task, sep = ' · ') {
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
export function refUrl(ref, kind, parent) {
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
export const taskUrl = (task, parent) => refUrl(task.pr, 'pull', parent) ?? refUrl(task.issue, 'issues', parent)

/** "#884 Profile and guard": the issue first, unless what already starts with it. */
export function titleText(task) {
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
export function boardRows(board, options = {}) {
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
export const progressText = (p) => p.done + ' of ' + p.total + ' done' + (p.needsYou ? ' · ' + p.needsYou + ' needs you' : '')

/** "blocked by #884 (waiting), #885 (now)". */
export const blockedText = (blockedBy) => 'blocked by ' + blockedBy.map((b) => b.ref + ' (' + b.status + ')').join(', ')

/** Above this many work tasks the bar is one continuous fill: segments get too thin. */
export const SEGMENT_MAX = 24

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
export function boardProgress(board) {
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
export function boardProgressText(p) {
  const head = progressText(p)
  return p.focus ? head + ' · ' + p.focus.text : head
}

// ---- Batch 6: what the Board panel (design C, Outline) and the strip show ----

/** The row's status mark: a check for done, a ring for next, else a dot (now: accent, waiting: grey). */
export const STATUS_MARK = { done: 'check', next: 'ring', now: 'dot-now', waiting: 'dot-waiting' }

/** The meta line's label for each note: "Next:", "Reason:", "Start when:". */
const NOTE_LABEL = { next: 'Next:', why: 'Reason:', 'starts when': 'Start when:', 'waiting on': 'Waiting on' }
/** The detail grid's key for each note. */
const DETAIL_KEY = { next: 'Next', why: 'Reason', 'starts when': 'Start when' }

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** "PR #892" from "#892", "o/r#892" or ".../pull/892"; "PR" for anything else. */
export function prText(pr) {
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
export function rowCells(row, flags = []) {
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
export function problemLine(p, tasks = []) {
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const i = p.text.indexOf(': ')
  const refs = p.items.map((it) => (byItem.has(it) ? refOf(byItem.get(it)) : String(it))).join(', ')
  return { item: p.item, kind: i < 0 ? p.text : p.text.slice(0, i), refs, text: p.text }
}

/** What the panel shows with no board: the design's title and one line. */
export const EMPTY_STATE = {
  title: 'No board in this session',
  line: 'A hub agent binds a board when it starts to coordinate work. The board shows here after that.',
}

/**
 * The owner's ask for the strip: the task's nextAction without its "Owner:"
 * lead, first letter lower, final period dropped, "for" the task's title;
 * with no nextAction, the title alone.
 */
export function askText(task) {
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
export function stripModel(board) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const p = boardProgress(board)
  const mine = needsYou(tasks).tasks
  const base = { key: board?.key, progress: p, done: progressText({ done: p.done, total: p.total }) }
  if (mine.length === 1) return { ...base, kind: 'needs you', text: 'Needs you: ' + askText(mine[0]), command: text(mine[0].readyCommand), item: mine[0].item }
  if (mine.length > 1) return { ...base, kind: 'needs you', text: mine.length + ' need you', item: mine[0].item }
  return { ...base, kind: 'normal', focus: p.focus?.text }
}

/** The strip as one line of text: "sim-883 · 4 of 6 done · <focus> · Board ›" or "⚠ Needs you: … · Copy command · Board ›". */
export function stripText(m) {
  if (m.kind === 'needs you') return ['⚠ ' + m.text, m.command ? 'Copy command' : '', 'Board ›'].filter(Boolean).join(' · ')
  return [m.key, m.done, m.focus, 'Board ›'].filter(Boolean).join(' · ')
}