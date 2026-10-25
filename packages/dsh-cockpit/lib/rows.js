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

/** "model · effort"; the provider only when the model does not start with it, or it is not claude. */
export function modelText(task) {
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
export const progressText = (p) => p.done + ' of ' + p.total + ' done' + (p.needsYou ? ' · ' + p.needsYou + ' needs you' : '')

/** "blocked by #884 (waiting), #885 (now)". */
export const blockedText = (blockedBy) => 'blocked by ' + blockedBy.map((b) => b.ref + ' (' + b.status + ')').join(', ')

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
export function boardProgress(board) {
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
export function boardProgressText(p) {
  const head = progressText(p)
  if (!p.focus) return head
  return head + ' · ' + (p.focus.kind === 'needs you' ? '' : p.focus.kind + ': ') + p.focus.title
}
