// Built by client/build.mjs from client/src, lib/rows.js and lib/present.js; do not edit.
window.__ModuleLoader__.load({ id: "@romany-saad/dsh-cockpit", factory: (shellRequire) => {
var module = { exports: {} }; var exports = module.exports; var __packageId = "@romany-saad/dsh-cockpit";
var __local = {
"../../lib/rows.js": (() => {
// What each board row says: one model shared by the tree text (lib/tree.js),
// the reader and the Board tab (client/build.mjs inlines this file into
// client/client.js). Pure, with no imports, so it can be inlined.

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const same = (a, b) => a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase()
/** done or dropped: closed tasks block nothing (lib/task.js isClosed; repeated so this file stays import-free). */
const closed = (status) => status === 'done' || status === 'dropped'

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
 * loop, or with a parent not on the board, sits under the board's root task
 * (the one root task with children, when there is exactly one), else at the
 * top, after the real roots (misplaced lists those). A loop has no ancestor
 * outside it: every task up a looped task's parent chain is in the same loop.
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
    parentOf.set(t.item, boardRoot)
    if (boardRoot === undefined) misplaced.add(t.item)
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
 * @param {object[]} tasks
 * @param {object[]} [flags] boardFlags(tasks), when the caller has them
 */
function problems(tasks, flags = boardFlags(tasks)) {
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const out = []
  const looped = new Set()
  for (const f of flags) {
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

/** waitingOn is "owner", ignoring case and surrounding space (decision 20, Q4). */
const waitsOnOwner = (task) => text(task.waitingOn)?.toLowerCase() === 'owner'

/** The open tasks (not done, not dropped) whose waitingOn is the owner. Nothing else is guessed. */
const needsYou = (tasks) => tasks.filter((t) => !closed(t.status) && waitsOnOwner(t))

/** nextAction, why and startWhen, present and each text once, in that order. */
function notes(task) {
  const out = []
  for (const [label, value] of [['next', task.nextAction], ['why', task.why], ['start when', task.startWhen]]) {
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
const WEB_URL = /^https?:\/\/\S+$/i

/**
 * A link for an issue or PR reference, or undefined. No tracker is built in
 * (decisions 9 and 20, Q3):
 * - a full http(s) URL links as stored;
 * - anything else links only through links[kind], a URL pattern from the
 *   profile's links config (empty by default, so nothing else links). The
 *   pattern's placeholders: {ref}, the reference as stored; {repo} and
 *   {number}, from "owner/repo#12", or from "#12" with the repo of the
 *   board's parent reference. A pattern whose placeholders cannot all be
 *   filled, or that does not give an http(s) URL, gives no link.
 * Examples: "https://github.com/{repo}/pull/{number}",
 * "https://example.atlassian.net/browse/{ref}".
 * @param {string|undefined} ref
 * @param {'issue'|'pr'} kind
 * @param {{ links?: { issue?: string, pr?: string }, parent?: string }} [options]
 */
function refUrl(ref, kind, { links, parent } = {}) {
  const r = text(ref)
  if (!r) return undefined
  if (WEB_URL.test(r)) return r
  const pattern = text(links?.[kind])
  if (!pattern) return undefined
  const full = REPO_REF.exec(r)
  const short = /^#(\d+)$/.exec(r)
  const parentRepo = REPO_REF.exec(text(parent) ?? '')
  const values = { ref: r }
  if (full) Object.assign(values, { repo: full[1], number: full[2] })
  else if (short && parentRepo) Object.assign(values, { repo: parentRepo[1], number: short[1] })
  let missing = false
  const url = pattern.replace(/\{(\w+)\}/g, (m, name) => {
    if (values[name] === undefined) { missing = true; return m }
    return name === 'ref' ? encodeURIComponent(values[name]) : values[name]
  })
  return !missing && WEB_URL.test(url) ? url : undefined
}

/** "#884 Profile and guard": the issue first, unless what already starts with it as a word. */
function titleText(task) {
  const what = String(task.what ?? '')
  const issue = text(task.issue)
  const leads = issue && (what === issue || (what.startsWith(issue) && /^\s/.test(what.slice(issue.length))))
  return issue && !leads ? issue + ' ' + what : what
}

/**
 * The board's rows in tree order, each with what it shows:
 * - closed: done or dropped; a closed row has no wait line;
 * - line: the one wait phrase of an open row (the first note); others: the rest;
 * - blockedBy: on next and waiting rows, each dependency on the board still open;
 * - ready: a next row whose dependencies are all on the board and closed;
 * - after: its dependencies on the board, by issue, else item;
 * - progress: on a row with children, { done, dropped, total, needsYou } of all
 *   its children on the board, drawn or not (only filters the rows, not the counts);
 * - issueUrl, prUrl: refUrl() of issue and pr, with options.links and the board's parent;
 * - reported: the last drift check's entry for this task ({ status, note? }),
 *   while its status still differs from the task's; drawn "reported: done".
 * @param {{tasks: object[], parent?: string, drift?: object}} board
 * @param {{only?: Set<string>, links?: {issue?: string, pr?: string}}} [options]
 */
function boardRows(board, options = {}) {
  const linkOptions = { links: options.links, parent: board?.parent }
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const mine = new Set(needsYou(tasks).map((t) => t.item))
  const childrenOf = new Map(treeOrder(tasks).map((r) => [r.task.item, r.children]))
  // A hand-written file may hold anything in drift.items: only entries with a string item count.
  const drifted = new Map((Array.isArray(board?.drift?.items) ? board.drift.items : []).filter((e) => typeof e?.item === 'string').map((e) => [e.item, e]))
  return treeOrder(tasks, { only: options.only }).map(({ task, depth, guide }) => {
    const d = drifted.get(task.item)
    const reported = d && typeof d.status === 'string' && d.status !== task.status
      ? (typeof d.note === 'string' ? { status: d.status, note: d.note } : { status: d.status })
      : undefined
    const children = childrenOf.get(task.item) ?? []
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : []
    const isClosed = closed(task.status)
    const all = notes(task)
    const open = !isClosed && all.length ? all[0] : undefined
    const blocked = task.status === 'next' || task.status === 'waiting'
    return {
      item: task.item,
      depth,
      guide,
      status: task.status,
      done: task.status === 'done',
      dropped: task.status === 'dropped',
      closed: isClosed,
      what: task.what,
      title: titleText(task),
      issue: task.issue,
      pr: task.pr,
      line: open?.text,
      lineLabel: open?.label,
      others: open ? all.slice(1) : all,
      needsYou: mine.has(task.item),
      ready: task.status === 'next' && deps.every((d) => byItem.has(d) && closed(byItem.get(d).status)),
      blockedBy: blocked ? deps.filter((d) => byItem.has(d) && !closed(byItem.get(d).status)).map((d) => ({ ref: refOf(byItem.get(d)), status: byItem.get(d).status })) : [],
      // Only dependencies on the board; an unknown one shows in its flag alone.
      after: deps.filter((d) => byItem.has(d)).map((d) => refOf(byItem.get(d))),
      progress: children.length
        ? {
            done: children.filter((c) => c.status === 'done').length,
            dropped: children.filter((c) => c.status === 'dropped').length,
            total: children.length,
            needsYou: children.filter((c) => mine.has(c.item)).length,
          }
        : undefined,
      model: modelText(task),
      issueUrl: refUrl(task.issue, 'issue', linkOptions),
      prUrl: refUrl(task.pr, 'pr', linkOptions),
      readyCommand: text(task.readyCommand),
      waitingOn: text(task.waitingOn),
      startWhen: text(task.startWhen),
      branch: text(task.branch),
      worktree: text(task.worktree),
      reported,
    }
  })
}

/** "reported: done": the tag of a row whose last drift check reported another status (E1). */
const reportedText = (reported) => 'reported: ' + reported.status

/** "4 of 6 done · 1 dropped · 1 needs you": dropped is counted apart from done. */
const progressText = (p) => p.done + ' of ' + p.total + ' done' +
  (p.dropped ? ' · ' + p.dropped + ' dropped' : '') +
  (p.needsYou ? ' · ' + p.needsYou + ' needs you' : '')

/** "blocked by #884 (waiting), #885 (now)". */
const blockedText = (blockedBy) => 'blocked by ' + blockedBy.map((b) => b.ref + ' (' + b.status + ')').join(', ')

// ---- What the Board tab shows (design 6, C · Outline, refined) ----

/** The row's status mark by shape: a check, a ring, an info dot, a grey dot, a dash. */
const STATUS_MARK = { done: 'check', next: 'ring', now: 'dot-now', waiting: 'dot-waiting', dropped: 'dash' }

/**
 * A reference as a title shows it: "#12" when "owner/repo#12" is in the
 * repository of the board's parent reference, "repo#12" when it is in
 * another; anything else as stored. The link and its tooltip keep the full one.
 * @param {string|undefined} ref
 * @param {string} [parent] the board's parent reference
 */
function shortRef(ref, parent) {
  const r = text(ref)
  if (!r) return undefined
  const full = REPO_REF.exec(r)
  if (!full) return r
  const home = REPO_REF.exec(text(parent) ?? '')
  if (home && home[1].toLowerCase() === full[1].toLowerCase()) return '#' + full[2]
  return full[1].slice(full[1].indexOf('/') + 1) + '#' + full[2]
}

/**
 * The title in two parts: the issue (full, and short for display) and the
 * rest of what. what that already leads with its issue, as a word, is not
 * repeated: { issue: '#883', ref: '#883', what: 'effort' }.
 */
function titleParts(task, parent) {
  const what = String(task.what ?? '')
  const issue = text(task.issue)
  if (!issue) return { what }
  const leads = what === issue || (what.startsWith(issue) && /^\s/.test(what.slice(issue.length)))
  return { issue, ref: shortRef(issue, parent), what: leads ? what.slice(issue.length).trim() : what }
}

/** "PR #892" from "#892", "o/r#892" or a URL ending in "/892"; "PR" for anything else. */
function prText(pr) {
  const v = text(pr)
  if (!v) return undefined
  const n = /[#/](\d+)\/?$/.exec(v)
  return n ? 'PR #' + n[1] : 'PR'
}

/** The meta line's label for a note; nextAction shows as written, with no label. */
const NOTE_LABEL = { next: '', why: 'Reason: ', 'start when': 'Start when: ' }
/** The detail grid's key for each note. */
const DETAIL_KEY = { next: 'Next', why: 'Reason', 'start when': 'Start when' }

/**
 * One row's cells in the fixed columns (id · status · title · PR · chevron),
 * from a boardRows() row and its boardFlags():
 * - parent: a top row with children, drawn as the parent row (progress, no status);
 * - mark: STATUS_MARK; wrap: open titles wrap, closed ones truncate;
 * - indent: 16 px steps in the title cell below the parent row; elbow from depth 2;
 * - pr: "PR #892", linked by prUrl when there is one;
 * - line: the one meta line of an open row not in Needs you: "Waiting on CI"
 *   on a row waiting on someone other than the owner, else its first note
 *   (nextAction as written, "Start when: …", "Reason: …");
 * - blockedBy, ready, needsYou; problems: each flag's text, in place;
 * - reported: the drift tag ("reported: done") and its note;
 * - detail: [{ key, value, mono }] (the other notes, waiting on, model, branch, worktree);
 * - command: the ready command, unless the row is in Needs you (its card has it);
 * - expandable: detail, a command or a drift note to show.
 * @param {ReturnType<typeof boardRows>[number]} row
 * @param {object[]} [flags]
 */
function rowCells(row, flags = []) {
  const parent = Boolean(row.progress) && row.depth === 0
  const other = row.waitingOn && row.waitingOn.toLowerCase() !== 'owner' ? row.waitingOn : undefined
  const waitsOn = row.status === 'waiting' && other ? other : undefined
  const open = !row.closed && !row.needsYou
  const line = open && waitsOn ? 'Waiting on ' + waitsOn
    : open && row.line ? NOTE_LABEL[row.lineLabel] + row.line : undefined
  const notesLeft = row.line && (!line || waitsOn) ? [{ label: row.lineLabel, text: row.line }, ...row.others] : row.others
  const detail = notesLeft.map((n) => ({ key: DETAIL_KEY[n.label] ?? n.label, value: n.text, mono: false }))
  if (other && !waitsOn) detail.push({ key: 'Waiting on', value: other, mono: false })
  if (row.model) detail.push({ key: 'Model', value: row.model, mono: true })
  if (row.branch) detail.push({ key: 'Branch', value: row.branch, mono: true })
  if (row.worktree) detail.push({ key: 'Worktree', value: row.worktree, mono: true })
  if (row.reported?.note) detail.push({ key: 'Reported', value: row.reported.status + ': ' + row.reported.note, mono: false })
  const command = row.needsYou ? undefined : row.readyCommand
  return {
    item: row.item,
    parent,
    status: parent ? undefined : row.status,
    mark: parent ? undefined : STATUS_MARK[row.status] ?? 'dot-waiting',
    wrap: !row.closed,
    indent: parent ? 0 : Math.max(0, row.depth - 1),
    elbow: !parent && row.depth >= 2,
    pr: prText(row.pr),
    prUrl: row.prUrl,
    progress: parent ? row.progress : undefined,
    line,
    needsYou: row.needsYou,
    blockedBy: row.blockedBy,
    ready: row.ready,
    problems: flags.map((f) => { const t = flagText(f); return t.charAt(0).toUpperCase() + t.slice(1) }),
    reported: row.reported ? { text: reportedText(row.reported), note: row.reported.note } : undefined,
    detail,
    command,
    expandable: detail.length > 0 || Boolean(command),
  }
}

/** Above this many work tasks the bar is one continuous fill: segments get too thin. */
const SEGMENT_MAX = 24

/** A segment's kind: done, dropped, 'needs you', now, ready (next and every dependency closed), blocked (other next) or waiting. */
const segmentKind = (r) => r.done ? 'done' : r.dropped ? 'dropped' : r.needsYou ? 'needs you' : r.status === 'now' ? 'now'
  : r.status === 'next' ? (r.ready ? 'ready' : 'blocked') : 'waiting'

/** Tasks by item, the first of a repeated item, as the rows draw it. */
function firstByItem(board) {
  const byItem = new Map()
  for (const t of Array.isArray(board?.tasks) ? board.tasks : []) if (!byItem.has(t.item)) byItem.set(t.item, t)
  return byItem
}

/**
 * What blocks a next or waiting row: each open dependency on the board with
 * its status, then each dependency not on the board. ref formats a reference.
 * ["#886 (waiting)", "'release notes' (not on the board)"]
 */
function blockerTexts(row, task, byItem, ref = (r) => r) {
  const deps = Array.isArray(task?.dependsOn) ? task.dependsOn : []
  const waits = row.status === 'next' || row.status === 'waiting'
  const unknown = waits ? deps.filter((d) => !byItem.has(d)).map((d) => "'" + d + "' (not on the board)") : []
  return row.blockedBy.map((b) => ref(b.ref) + ' (' + b.status + ')').concat(unknown)
}

/** The board's one parent row (a top row with children, when there is exactly one), else undefined. */
function boardParent(rows) {
  const roots = rows.filter((r) => r.depth === 0 && r.progress)
  return roots.length === 1 ? roots[0].item : undefined
}

/**
 * The rows the strip counts when the board has no one parent row: every
 * row without children (its work tasks), so two epics of five tasks read
 * "0 of 10 done", never "0 of 2".
 */
const workRows = (rows) => rows.filter((r) => !r.progress)

/**
 * The parent row's thin bar: one segment per child of that row, in tree
 * order, the same tasks its progress text counts, so the bar and "2 of 8
 * done" always agree. Each is { item, kind, tooltip }; kind is segmentKind()
 * of the child's own status (a child with children of its own is drawn by
 * its status). The tooltip is the title and what the kind means: "#887 Live
 * checks · blocked by #886 (waiting)", "… · now · opus high", "… · waiting ·
 * on CI". continuous: more than SEGMENT_MAX children.
 * With item undefined (a board with no one parent row), the segments are the
 * work tasks, the rows without children; the progress strip uses that.
 * @param {{tasks: object[]}} board
 * @param {ReturnType<typeof boardRows>} rows the board's rows, from boardRows(board)
 * @param {string|undefined} item the parent row's item
 */
function boardSegments(board, rows, item) {
  const byItem = firstByItem(board)
  const children = []
  if (item === undefined) children.push(...workRows(rows))
  else {
    const at = rows.findIndex((r) => r.item === item)
    if (at >= 0) {
      for (let i = at + 1; i < rows.length && rows[i].depth > rows[at].depth; i++) if (rows[i].depth === rows[at].depth + 1) children.push(rows[i])
    }
  }
  const segments = children.map((r) => {
    const kind = segmentKind(r)
    let said = [kind]
    if (kind === 'now') said = ['now', modelText(byItem.get(r.item) ?? {}, ' ')]
    else if (kind === 'waiting') said = ['waiting', r.waitingOn ? 'on ' + r.waitingOn : '']
    else if (kind === 'blocked') {
      const blockers = blockerTexts(r, byItem.get(r.item), byItem)
      said = [blockers.length ? 'blocked by ' + blockers.join(', ') : 'blocked']
    }
    return { item: r.item, kind, tooltip: [r.title, ...said].filter(Boolean).join(' · ') }
  })
  return {
    segments,
    continuous: children.length > SEGMENT_MAX,
    done: children.filter((r) => r.done).length,
    dropped: children.filter((r) => r.dropped).length,
    total: children.length,
  }
}

/**
 * The header's drift line, from the board's last drift check and its rows:
 * { kind: 'not run' } | { kind: 'failed', error, at } | { kind: 'matches'|'differs', count, at }.
 * count is the rows still tagged "reported: …".
 */
function driftState(drift, rows) {
  if (!drift || typeof drift !== 'object') return { kind: 'not run' }
  const at = typeof drift.checkedAt === 'string' ? drift.checkedAt : undefined
  if (drift.error !== undefined) return { kind: 'failed', error: typeof drift.error === 'string' ? drift.error : JSON.stringify(drift.error), at }
  const count = rows.filter((r) => r.reported).length
  return { kind: count ? 'differs' : 'matches', count, at }
}

/** "not run yet", "failed", "matches", "1 differs", "2 differ". */
function driftWords(state) {
  if (state.kind === 'not run') return 'not run yet'
  if (state.kind === 'failed' || state.kind === 'matches') return state.kind
  return state.count + (state.count === 1 ? ' differs' : ' differ')
}

// ---- The progress strip above the chat input (design 6) ----

/**
 * The strip: the parent bar's segments and counts (boardSegments over
 * boardParent, so the strip and the parent row always agree), and one focus.
 * - 'needs you' when an open task waits on the owner: text "Needs you: <its
 *   nextAction as written, else its title>", its readyCommand for Copy and
 *   its item; with two or more, "2 need you", no command, the first item.
 * - else 'normal', with focus, in tree order, the first present of: a task
 *   that is blocked, naming each blocker and its status ("#887 blocked by
 *   #886 (waiting)"); the tasks in progress ("in progress: #885 Work
 *   reports", "2 in progress: #885, #886"); else none. A parent row (a
 *   top row with children) is not a candidate: its tasks are.
 * References show short, as the titles do (shortRef).
 * @param {{key?: string, tasks: object[], parent?: string}} board
 * @param {ReturnType<typeof boardRows>} [rows] boardRows(board), when the caller has them
 */
function stripModel(board, rows = boardRows(board)) {
  const byItem = firstByItem(board)
  const home = board?.parent
  const ref = (r) => shortRef(r, home) ?? r
  const parent = boardParent(rows)
  const bar = boardSegments(board, rows, parent)
  const base = { key: text(board?.key), bar, done: progressText({ done: bar.done, dropped: bar.dropped, total: bar.total }) }
  const mine = rows.filter((r) => r.needsYou)
  if (mine.length) {
    const first = mine[0]
    const ask = text(byItem.get(first.item)?.nextAction) ?? first.title
    return mine.length === 1
      ? { ...base, kind: 'needs you', item: first.item, title: first.title, text: 'Needs you: ' + ask, command: first.readyCommand }
      : { ...base, kind: 'needs you', item: first.item, title: first.title, text: mine.length + ' need you' }
  }
  // The parent rows (top rows with children) are not candidates: their tasks are.
  const open = rows.filter((r) => !r.closed && !(r.depth === 0 && r.progress))
  for (const r of open) {
    const blockers = blockerTexts(r, byItem.get(r.item), byItem, ref)
    if (blockers.length) return { ...base, kind: 'normal', item: r.item, focus: ref(refOf(byItem.get(r.item))) + ' blocked by ' + blockers.join(', ') }
  }
  const now = open.filter((r) => r.status === 'now')
  if (now.length === 1) return { ...base, kind: 'normal', item: now[0].item, focus: 'in progress: ' + shortTitle(byItem.get(now[0].item), home) }
  if (now.length) return { ...base, kind: 'normal', item: now[0].item, focus: now.length + ' in progress: ' + now.map((r) => ref(refOf(byItem.get(r.item)))).join(', ') }
  return { ...base, kind: 'normal' }
}

/** "#885 Work reports": the title with its issue short (titleParts). */
const shortTitle = (task, parent) => { const p = titleParts(task ?? {}, parent); return [p.ref, p.what].filter(Boolean).join(' ') }

/**
 * The strip as one line, its accessible name and the shape the design gives:
 * "sim-883 · 4 of 6 done · #887 blocked by #886 (waiting) · Board ›", or
 * "⚠ Needs you: merge PR #902 · Copy command · Board ›".
 */
function stripText(m) {
  if (m.kind === 'needs you') return ['⚠ ' + m.text, m.command ? 'Copy command' : '', 'Board ›'].filter(Boolean).join(' · ')
  return [m.key, m.done, m.focus, 'Board ›'].filter(Boolean).join(' · ')
}

/** The strip's tooltip: what it says in full, with the needs-you task's title. */
function stripTitle(m) {
  if (m.kind === 'needs you') return '⚠ ' + m.text + (m.title && m.text.startsWith('Needs you:') ? ' (' + m.title + ')' : '') + ' · ' + m.done
  return [m.key, m.done, m.focus].filter(Boolean).join(' · ')
}

/** What the tab shows with no board: the design's title and one line. */
const EMPTY_STATE = {
  title: 'No board in this session',
  line: 'A hub agent binds a board when it starts to coordinate work. The board shows here after that.',
}

return { parentLoops, placement, treeOrder, duplicateRefs, boardFlags, flagText, problems, waitsOnOwner, needsYou, notes, modelText, refUrl, titleText, boardRows, reportedText, progressText, blockedText, STATUS_MARK, shortRef, titleParts, prText, rowCells, SEGMENT_MAX, segmentKind, firstByItem, boardParent, boardSegments, driftState, driftWords, stripModel, stripText, stripTitle, EMPTY_STATE }
})(),
"../../lib/present.js": (() => {
// Tool-card titles: one short line per call saying what it did. Pure, with
// no imports: they depend only on the call's args and, for the result, on the
// value's own presentationMeta projection. DSH's web client ignores
// presentCall/presentResult and picks its renderer through tool.call.toolview
// (dsh-tools README, "Host presentation descriptors"), so client/build.mjs
// inlines this file and the chat cards use callTitle and the recorded meta title.

const MAX = 48
const clip = (s) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > MAX ? t.slice(0, MAX - 1) + '…' : t }
const quote = (s) => '"' + clip(s) + '"'
// board_open may create a board, set its parent and write the session binding.
const KIND = { board_open: 'edit', board_read: 'read', board_add: 'edit', board_update: 'edit' }

const itemsText = (item) => (Array.isArray(item) ? item.join(', ') : String(item))

function readFilters(args = {}) {
  const parts = []
  if (args.item !== undefined) parts.push('item ' + args.item)
  if (Array.isArray(args.status) && args.status.length) parts.push(args.status.join(', '))
  if (args.checkDrift === true) parts.push('drift check')
  return parts
}

function addTitle(item, args) {
  const parts = ['add ' + (item ?? 'next') + ' ' + quote(args.what ?? '')]
  parts.push(args.status ?? 'next')
  if (Array.isArray(args.dependsOn) && args.dependsOn.length) parts.push('after ' + args.dependsOn.join(', '))
  return parts.join(' · ')
}

function updateTitle(args) {
  const items = itemsText(args.item)
  if (args.remove) return 'remove ' + items
  const set = args.set && typeof args.set === 'object' ? args.set : {}
  const entries = Object.entries(set)
  if (!entries.length) return 'update ' + items + ' (no change)'
  let head = 'update ' + items
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
 * The hook and components, built on the caller's React.
 * useCopy(text) -> [state, copy]; copy(event) copies text and stops the click.
 * CopyButton({ text, label, words, icon }) is the button with its live region,
 * announcing Copied or Copy failed without moving focus; words is its idle text.
 * CommandBox({ command, label }) draws the box; label names the button for
 * screen readers ("Copy command for #886").
 */
function makeCommandBox(React) {
  const h = React.createElement
  function useCopy(text) {
    const [state, setState] = React.useState('idle')
    const timer = React.useRef(undefined)
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
  function CopyButton({ text, label, words = COPY_LABEL.idle, icon = true }) {
    const [state, copy] = useCopy(text)
    return h('span', { className: 'dshc-copy' },
      h('button', { type: 'button', className: 'dshc-btn', 'aria-label': state === 'idle' ? label || 'Copy command' : COPY_LABEL[state], 'data-copy-state': state, onClick: copy },
        icon ? copyIcon(h) : null, state === 'idle' ? words : COPY_LABEL[state]),
      // Announce the result without moving focus.
      h('span', { role: 'status', className: 'dshc-sr' }, state === 'idle' ? '' : COPY_LABEL[state]))
  }
  function CommandBox({ command, label }) {
    return h('div', { className: 'dshc-cmd', 'data-command-box': '' },
      h('code', null, command),
      h(CopyButton, { text: command, label }))
  }
  return { CommandBox, CopyButton, useCopy }
}

return { COPY_RESET_MS, COPY_LABEL, copyStep, copyText, copyIcon, makeCommandBox }
})()
};
var require = (name) => (Object.prototype.hasOwnProperty.call(__local, name) ? __local[name] : shellRequire(name));
// dsh-cockpit's browser half (design section 6, C · Outline, refined, with
// the owner's changes): the read-only Board tab in the right sidebar, the
// progress strip above the chat input, and the chat cards of the four board
// tools. A plain CommonJS body: client/build.mjs wraps it in the module-loader
// factory and inlines lib/rows.js, lib/present.js and client/src/command-box.js,
// so the tab, the strip, the cards and the hub's tree text share their rules.
// Its shell require is react; the chat cards also take the host's tool row
// from ui-primitives when the shell has it (see cardPrimitives).
// Board text is rendered only as text (React escapes it); only http(s) URLs
// become links, in a new tab with rel="noopener noreferrer". Nothing here
// writes to the board or runs a command.
const React = require('react')
const { EMPTY_STATE, boardFlags, boardParent, boardRows, boardSegments, driftState, driftWords, firstByItem, needsYou, problems, progressText, prText, refUrl, rowCells, shortRef, stripModel, stripText, stripTitle, titleParts } = require('../../lib/rows.js')
const { callTitle } = require('../../lib/present.js')
const { makeCommandBox, copyStep, copyText } = require('./command-box.js')
const { CommandBox, CopyButton } = makeCommandBox(React)
const h = React.createElement

// The package name, which client/build.mjs defines from package.json.
const ID = __packageId
const KIND = 'dsh-cockpit-board'
const POLL_MS = 2000
// With no board bound, a failed answer or a 404 (route.enabled: false), the next poll waits longer.
const IDLE_MS = 10000
// Relative to the document, as dsh-client-ui-deliverables does, so a mounted app works.
const VIEW = 'api/dsh-cockpit/view'
// The board tools whose chat cards this bundle draws (tool.call.toolview keys).
const TOOLS = ['board_open', 'board_read', 'board_add', 'board_update']

// ---- Style: host tokens only (dsh-client-ui-theme), one stylesheet in the head ----
// The panel's own colour names, set per theme on its root. Where a host token
// misses the spec's contrast rule in the light theme (text 4.5:1, marks 3:1),
// the light value mixes it toward label-primary; the PR body has the table.
const TOKENS = [
  '[data-dsh-cockpit-board],[data-dsh-cockpit-dock]{',
  '--dshc-l0:var(--dsw-alias-bg-base);--dshc-l1:var(--dsw-alias-bg-skeleton);--dshc-l2:var(--dsw-alias-bg-module-platform);',
  '--dshc-border:var(--dsw-alias-border-l1);--dshc-p:var(--dsw-alias-label-primary);--dshc-s:var(--dsw-alias-label-secondary);',
  '--dshc-mark:var(--dsw-alias-label-tertiary);--dshc-info:var(--dsw-alias-state-business-primary);',
  // Light: label-tertiary text is 3.7:1 on white, so tertiary text uses label-secondary.
  '--dshc-t:var(--dsw-alias-label-secondary);',
  '--dshc-warn:color-mix(in srgb,var(--dsw-alias-state-warn-label) 65%,var(--dsw-alias-label-primary));',
  '--dshc-warn-mark:var(--dsw-alias-state-warn-primary);',
  '--dshc-ok:color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,var(--dsw-alias-label-primary));',
  '--dshc-ok-mark:color-mix(in srgb,var(--dsw-alias-state-success-primary) 80%,var(--dsw-alias-label-primary));',
  '--dshc-err:color-mix(in srgb,var(--dsw-alias-state-error-primary) 80%,var(--dsw-alias-label-primary))}',
  'body[data-ds-dark-theme] [data-dsh-cockpit-board],body[data-ds-dark-theme] [data-dsh-cockpit-dock]{--dshc-t:var(--dsw-alias-label-tertiary);--dshc-warn:var(--dsw-alias-state-warn-label);',
  '--dshc-ok:var(--dsw-alias-state-success-primary);--dshc-ok-mark:var(--dsw-alias-state-success-primary);--dshc-err:var(--dsw-alias-state-error-primary)}',
].join('')
const MONO = 'var(--ds-font-family-code,ui-monospace,monospace)'
const CSS = [
  TOKENS,
  '[data-dsh-cockpit-board]{box-sizing:border-box;height:100%;overflow:auto;color:var(--dshc-p);font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}',
  '[data-dsh-cockpit-board] *{box-sizing:border-box}',
  '.dshc-mono{font-family:' + MONO + ';font-variant-ligatures:none}',
  '.dshc-trunc{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshc-wrap{display:block;min-width:0;overflow-wrap:anywhere}',
  '[data-dsh-cockpit-board] a{color:inherit;text-decoration:none}[data-dsh-cockpit-board] a:hover{text-decoration:underline}',
  '.dshc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
  '.dshc-hd{padding:12px 12px 10px;border-bottom:1px solid var(--dshc-border)}',
  '.dshc-hd1{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
  '.dshc-hdl{display:flex;align-items:baseline;gap:8px;min-width:0}',
  '.dshc-key{font-size:13px;font-weight:500;flex:none;max-width:60%}',
  '.dshc-parent{font-size:12px;color:var(--dshc-t)}',
  '.dshc-meta{font-size:12px;color:var(--dshc-t);white-space:nowrap;flex:none}',
  '.dshc-drift{font-size:12px;line-height:16px;color:var(--dshc-t);margin-top:2px}',
  '.dshc-sec{padding:10px 12px 12px;border-bottom:1px solid var(--dshc-border)}',
  '.dshc-sech{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;line-height:16px;margin-bottom:8px}',
  '.dshc-warn{color:var(--dshc-warn)}.dshc-err{color:var(--dshc-err)}',
  '.dshc-ni{display:grid;grid-template-columns:36px minmax(0,1fr) auto;column-gap:8px;row-gap:4px;background:var(--dshc-l1);border:1px solid var(--dshc-border);border-radius:8px;padding:8px}',
  '.dshc-ni+.dshc-ni{margin-top:8px}',
  '.dshc-ni .dshc-id{color:var(--dshc-t);font-size:12px}',
  '.dshc-nit{font-weight:500}',
  '.dshc-ask{grid-column:2/4;font-size:12px;line-height:16px;color:var(--dshc-s);overflow-wrap:anywhere}',
  '.dshc-ni .dshc-cmd{grid-column:1/4}',
  '.dshc-open{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dshc-s);white-space:nowrap}',
  '.dshc-cmd{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;background:var(--dshc-l2);border:1px solid var(--dshc-border);border-radius:6px;padding:4px 4px 4px 10px;margin-top:4px;position:relative}',
  '.dshc-cmd code{font-family:' + MONO + ';font-size:12px;line-height:18px;padding:3px 0;color:var(--dshc-p);white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}',
  '.dshc-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:4px;border:1px solid var(--dshc-border);background:var(--dshc-l0);color:var(--dshc-p);font:inherit;font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;flex:none}',
  '.dshc-btn[data-copy-state=failed]{color:var(--dshc-err)}',
  '.dshc-prob{display:grid;grid-template-columns:16px minmax(0,1fr) 20px;column-gap:8px;align-items:start;width:100%;min-height:28px;padding:4px 0;border:0;background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dshc-p);text-align:left;cursor:pointer}',
  '.dshc-prob .dshc-ic{color:var(--dshc-err);display:flex;padding-top:2px}.dshc-prob .dshc-go{color:var(--dshc-t);display:flex;justify-content:center;padding-top:2px}',
  '.dshc-tree{margin:0;padding:0;list-style:none}',
  '.dshc-li{list-style:none;border-bottom:1px solid var(--dshc-border)}',
  '.dshc-li:focus{outline:2px solid var(--dshc-info);outline-offset:-2px}',
  '.dshc-row{display:grid;grid-template-columns:36px 68px minmax(0,1fr) 60px 20px;column-gap:8px;row-gap:2px;align-items:start;padding:6px 12px}',
  '.dshc-row>*{min-height:20px}',
  '.dshc-li.dshc-parentrow{background:var(--dshc-l1)}',
  '.dshc-parentrow .dshc-ct{font-weight:600}',
  '.dshc-cid{font-size:12px;color:var(--dshc-t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshc-cst{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dshc-s)}',
  '.dshc-check{color:var(--dshc-ok-mark);flex:none}',
  '.dshc-mark{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none}',
  '.dshc-dot{width:8px;height:8px;border-radius:50%}',
  '.dshc-dot-now{background:var(--dshc-info)}.dshc-dot-waiting{background:var(--dshc-mark)}',
  '.dshc-ring{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--dshc-s)}',
  '.dshc-dash{width:8px;height:0;border-top:1.5px solid var(--dshc-mark)}',
  '.dshc-ct{display:flex;align-items:flex-start;min-width:0}',
  '.dshc-indent{flex:none}',
  '.dshc-elbow{flex:none;width:8px;height:8px;border-left:1px solid var(--dshc-mark);border-bottom:1px solid var(--dshc-mark);margin:4px 6px 0 2px}',
  '.dshc-closed .dshc-ct,.dshc-closed .dshc-cst{color:var(--dshc-s)}',
  '.dshc-dropped .dshc-tt{text-decoration:line-through}',
  '.dshc-cpr{font-size:12px;color:var(--dshc-s);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dshc-chev{display:flex;align-items:center;justify-content:center;height:20px;padding:0;border:0;background:none;color:var(--dshc-t);cursor:pointer}',
  '.dshc-chev svg[data-open]{transform:rotate(90deg)}',
  '.dshc-cmeta{grid-column:3/5;display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:var(--dshc-s);min-height:0}',
  '.dshc-block{display:flex;align-items:flex-start;gap:6px;color:var(--dshc-p)}.dshc-block svg{flex:none;margin-top:2px}.dshc-block b{font-weight:500}.dshc-block .dshc-st{color:var(--dshc-t)}',
  '.dshc-mprob{display:flex;align-items:flex-start;gap:6px;color:var(--dshc-err)}.dshc-mprob svg{flex:none;margin-top:2px}',
  '.dshc-tag{align-self:flex-start;border:1px solid currentColor;border-radius:4px;padding:0 6px;font-size:11px;font-weight:600;line-height:16px}',
  '.dshc-tag-warn{color:var(--dshc-warn)}.dshc-tag-ok{color:var(--dshc-ok)}.dshc-tag-quiet{color:var(--dshc-s)}',
  '.dshc-detail{grid-column:2/5;margin-top:6px;padding-top:8px;border-top:1px dashed var(--dshc-border);min-height:0}',
  '.dshc-detail dl{display:grid;grid-template-columns:80px minmax(0,1fr);column-gap:8px;row-gap:4px;margin:0 0 4px;font-size:12px;line-height:16px}',
  '.dshc-detail dt{color:var(--dshc-t)}.dshc-detail dd{margin:0;color:var(--dshc-s);overflow-wrap:anywhere}.dshc-detail dd.dshc-mono{color:var(--dshc-p)}',
  '.dshc-pp{color:var(--dshc-s);font-weight:400}',
  '.dshc-need{color:var(--dshc-warn);font-weight:500}',
  // The thin bar: segments by shape, never moving.
  '.dshc-bar{display:flex;gap:2px;height:6px;width:100%;margin:4px 0 2px}',
  '.dshc-seg{flex:1 1 0;min-width:3px;border-radius:1.5px;cursor:pointer}',
  '.dshc-seg[data-segment=done]{background:var(--dshc-ok-mark)}',
  '.dshc-seg[data-segment=now]{background:linear-gradient(to right,var(--dshc-info) 50%,transparent 50%);box-shadow:inset 0 0 0 1px var(--dshc-info)}',
  '.dshc-seg[data-segment=waiting]{background:var(--dshc-mark)}',
  '.dshc-seg[data-segment="needs you"]{background:var(--dshc-warn-mark);box-shadow:inset 0 0 0 1px var(--dshc-warn)}',
  '.dshc-seg[data-segment=ready]{box-shadow:inset 0 0 0 1px var(--dshc-ok-mark)}',
  '.dshc-seg[data-segment=blocked]{border:1px dashed var(--dshc-mark)}',
  '.dshc-seg[data-segment=dropped]{background:linear-gradient(var(--dshc-mark),var(--dshc-mark)) center/100% 1px no-repeat}',
  '.dshc-fill{display:block;height:6px;width:100%;border-radius:2px;overflow:hidden;background:var(--dshc-border);margin:4px 0 2px}.dshc-fill>span{display:block;height:100%;background:var(--dshc-ok-mark)}',
  '.dshc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 40px;gap:6px}',
  '.dshc-empty p{margin:0}.dshc-empty-t{font-weight:500}.dshc-empty-s{font-size:12px;line-height:16px;color:var(--dshc-s);max-width:280px}',
  '.dshc-msg{padding:12px;color:var(--dshc-s);overflow-wrap:anywhere}',
  // The progress strip: one 28 px line, sized like the composer's other docks (the goal strip).
  '[data-dsh-cockpit-dock]{box-sizing:border-box;margin:0 auto;width:calc(100% - 2 * var(--dsh-composer-side-clearance,0px) - 4 * var(--dsh-composer-dock-inset,0px))}',
  '[data-dsh-cockpit-dock] *{box-sizing:border-box}',
  '.dshc-stripbox{container-type:inline-size;container-name:dshc-strip}',
  '.dshc-strip{width:100%;max-width:calc(var(--dsh-composer-card-max-width,100%) - 4 * var(--dsh-composer-dock-inset,0px));margin:0 auto;height:28px;padding:0 4px 0 10px;display:flex;align-items:center;gap:5px;overflow:hidden;font-size:12px;line-height:16px;white-space:nowrap;color:var(--dshc-s);font-variant-numeric:tabular-nums;border-radius:var(--dsw-radius-sm,8px);background:var(--dshc-l0);border:1px solid var(--dshc-border);cursor:pointer}',
  // The space, in order of priority: the needs-you action or the focus, the count,
  // the segments, the key. The key drops below 600 px of strip. Below 460 px the
  // segments become the 32 px continuous fill and the count drops "· 1 dropped";
  // a needs-you strip drops the bar there. Below 380 px no bar shows. The focus
  // takes the rest and ellipsizes only at its end. Count, Copy command and
  // Board › never shrink. The strip's tooltip has the full text.
  '.dshc-strip .dshc-bar{flex:0 1000 auto;margin:0;height:6px}',
  '.dshc-strip .dshc-bar .dshc-seg{min-width:3px}',
  '.dshc-strip .dshc-fill{flex:0 1000 72px;min-width:32px;margin:0}',
  '.dshc-strip .dshc-alt{display:none}',
  '@container dshc-strip (max-width:460px){.dshc-strip .dshc-bar,.dshc-strip .dshc-more,.dshc-strip[data-kind="needs you"] .dshc-fill{display:none}.dshc-strip .dshc-alt{display:block}}',
  '.dshc-strip .dshc-key{color:var(--dshc-t);font-size:12px;font-weight:400;flex:0 0 auto;max-width:120px}',
  '@container dshc-strip (max-width:600px){.dshc-strip .dshc-key,.dshc-strip .dshc-key+.dshc-sep{display:none}}',
  '@container dshc-strip (max-width:380px){.dshc-strip .dshc-fill{display:none}}',
  '.dshc-strip .dshc-sep{color:var(--dshc-t);flex:none}',
  '.dshc-strip .dshc-done,.dshc-strip .dshc-go,.dshc-strip .dshc-copy,.dshc-strip .dshc-ic{flex:none}',
  '.dshc-strip .dshc-done{color:var(--dshc-p)}',
  '.dshc-strip .dshc-focus{flex:1 1 auto;min-width:0}',
  '.dshc-strip .dshc-ic{color:var(--dshc-warn);display:inline-flex}',
  '.dshc-strip .dshc-btn{height:22px;padding:0 6px}',
  '.dshc-strip .dshc-go{height:22px;padding:0 4px;border:0;border-radius:4px;background:none;font:inherit;font-size:12px;font-weight:500;color:var(--dshc-s);cursor:pointer}',
  '.dshc-strip .dshc-go:hover,.dshc-strip .dshc-btn:hover{color:var(--dshc-p)}',
  // The chat cards: the host's tool row, with the result's tree text below it.
  '.dshc-card-sum{margin-left:8px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-secondary)}',
  '.dshc-card-sum[data-state=error]{color:var(--dsw-alias-state-error-primary)}.dshc-card-sum[data-state=stopped]{color:var(--dsw-alias-state-warn-label)}',
  '.dshc-card-out{margin:4px 0 4px 4px;max-height:260px;overflow:auto;white-space:pre;font-family:' + MONO + ';font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
].join('\n')

function useStyle() {
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    let el = document.getElementById('dsh-cockpit-style')
    if (!el) {
      el = document.createElement('style')
      el.id = 'dsh-cockpit-style'
      document.head.appendChild(el)
    }
    // A reloaded bundle replaces the rules of the one before it.
    if (el.textContent !== CSS) el.textContent = CSS
  }, [])
}

// ---- Icons (16 px grid, stroke) ----
const svg = (size, children, extra) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, children)
const warnIcon = (size = 12) => svg(size, [h('path', { key: 1, d: 'M8 2.5l6 10.5H2z' }), h('path', { key: 2, d: 'M8 6.5v3' }), h('path', { key: 3, d: 'M8 11.6v.1' })])
const checkIcon = () => svg(14, h('path', { d: 'M3.5 8.5l3 3 6-7' }), { strokeWidth: 1.8, className: 'dshc-check' })
const lockIcon = () => svg(12, [h('rect', { key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }), h('path', { key: 2, d: 'M5.5 7V5a2.5 2.5 0 015 0v2' })])
const extIcon = () => svg(12, [h('path', { key: 1, d: 'M9 3.5h3.5V7' }), h('path', { key: 2, d: 'M12.5 3.5L7 9' }), h('path', { key: 3, d: 'M11 9.5v2.5a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6.5a1 1 0 011-1H7' })], { strokeWidth: 1.5 })
const downIcon = () => svg(14, [h('path', { key: 1, d: 'M8 3.5v9' }), h('path', { key: 2, d: 'M4.5 9L8 12.5 11.5 9' })], { strokeWidth: 1.5 })
const chevIcon = (open) => svg(14, h('path', { d: 'M6 4l4 4-4 4' }), { 'data-open': open || undefined })

/** An http(s) URL, or undefined: nothing else ever becomes an href. */
const safeUrl = (url) => (typeof url === 'string' && /^https?:\/\/\S+$/i.test(url) ? url : undefined)
const stop = (e) => e.stopPropagation()
/** A link that opens in a new tab, or the plain text without a safe URL. */
function Link({ url, title, className, children }) {
  const href = safeUrl(url)
  if (!href) return h('span', { className, title }, children)
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', title, className, onClick: stop }, children)
}

// ---- The view: polled every 2 s, one poller per session ----
// The tab and the strip share one poller per session, which runs while either
// is mounted. One request at a time: the next poll starts POLL_MS after the
// last answer, so an older answer never overwrites a newer one. The state is
// kept per session, so another session's board never shows while its first
// poll runs.
const pollers = new Map()

function poller(sessionId) {
  let p = pollers.get(sessionId)
  if (p) return p
  p = { state: { loading: true }, subs: new Set(), timer: undefined, controller: undefined, stopped: false }
  const load = async () => {
    // A hidden page does not poll; it loads again when shown.
    if (typeof document !== 'undefined' && document.hidden) { p.waiting = true; return }
    const controller = (p.controller = new AbortController())
    let next
    try {
      const res = await fetch(VIEW + '?sessionId=' + encodeURIComponent(sessionId), { signal: controller.signal, cache: 'no-store' })
      const body = res.headers.get('content-type')?.includes('json') ? await res.json() : { error: await res.text() }
      // A failed answer keeps the last view, so a blip neither hides the strip nor blanks the tab.
      next = res.ok ? { view: body } : { view: p.state.view, error: body.error || 'HTTP ' + res.status }
    } catch (error) {
      if (p.stopped || error.name === 'AbortError') return
      next = { view: p.state.view, error: String(error.message || error) }
    }
    if (p.stopped) return
    p.state = next
    for (const fn of p.subs) fn(next)
    p.timer = setTimeout(load, next.error || !next.view?.key ? IDLE_MS : POLL_MS)
  }
  const onShow = () => { if (p.waiting && !document.hidden) { p.waiting = false; clearTimeout(p.timer); load() } }
  p.start = () => { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow); load() }
  p.stop = () => {
    p.stopped = true; clearTimeout(p.timer); if (p.controller) p.controller.abort()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow)
    if (pollers.get(sessionId) === p) pollers.delete(sessionId)
  }
  pollers.set(sessionId, p)
  return p
}

function useView(sessionId) {
  const [state, setState] = React.useState(() => ({ sessionId, ...(pollers.get(sessionId)?.state ?? { loading: true }) }))
  React.useEffect(() => {
    const p = poller(sessionId)
    const fn = (next) => setState({ sessionId, ...next })
    p.subs.add(fn)
    if (p.subs.size === 1) p.start()
    else fn(p.state)
    return () => { p.subs.delete(fn); if (!p.subs.size) p.stop() }
  }, [sessionId])
  return state.sessionId === sessionId ? state : { loading: true }
}

/** The clock for relative times: it ticks once a minute, not on every refresh. */
function useMinute() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  return now
}

const pad2 = (n) => String(n).padStart(2, '0')
/** "15:22" in local time, with the date when it is not today. */
function clockText(iso, now = Date.now()) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return iso ? String(iso) : ''
  const today = new Date(now)
  const clock = pad2(at.getHours()) + ':' + pad2(at.getMinutes())
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  return sameDay ? clock : at.getFullYear() + '-' + pad2(at.getMonth() + 1) + '-' + pad2(at.getDate()) + ' ' + clock
}
/**
 * "15:22 · 2 min ago". now is the minute clock, so a board changed since its
 * last tick (up to a minute "ahead") is "just now"; only a time more than a
 * minute ahead, such as another machine's clock, is "in the future".
 */
function whenText(iso, now = Date.now()) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return iso ? String(iso) : ''
  const s = Math.round((now - at.getTime()) / 1000)
  const ago = s < -60 ? 'in the future' : s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago'
    : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'
  return clockText(iso, now) + ' · ' + ago
}

/** The header's right side: "rev 33 · 15:34 · 9 min ago". */
// A fallback hub's file may have no revision or updatedAt: each is shown only when present.
const headerMeta = (board, now) => [Number.isInteger(board.revision) ? 'rev ' + board.revision : '', typeof board.updatedAt === 'string' ? whenText(board.updatedAt, now) : ''].filter(Boolean).join(' · ')

/** "Drift: 1 differs · 16:40", "Drift: matches · 16:40", "Drift: not run yet". */
function driftLine(state, now) {
  const at = state.at ? ' · ' + clockText(state.at, now) : ''
  return 'Drift: ' + driftWords(state) + at
}

/** The drift line shows when a drift command is configured or the file holds a result. */
const showDrift = (view) => Boolean(view.driftConfigured || view.board?.drift)

// ---- Rows: expand state kept by board and item across refreshes and remounts ----
const expanded = new Map()

/** The Board body an event happened in, so a row is looked up in that board only. */
const boardOf = (e) => (e && e.currentTarget && typeof e.currentTarget.closest === 'function' ? e.currentTarget.closest('[data-dsh-cockpit-board]') : null)

/** Move focus to a row of this board (root), centred, without animation. */
function showRow(item, root) {
  const el = root && typeof root.querySelector === 'function' && root.querySelector('li[data-item="' + String(item).replace(/["\\]/g, '\\$&') + '"]')
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.focus({ preventScroll: true })
}

function Header({ board, view, rows, now }) {
  const drift = driftState(board.drift, rows)
  return h('header', { className: 'dshc-hd' },
    h('div', { className: 'dshc-hd1' },
      h('span', { className: 'dshc-hdl' },
        h('span', { className: 'dshc-mono dshc-key dshc-trunc', title: board.key }, board.key),
        board.parent ? h('span', { className: 'dshc-parent dshc-trunc', title: board.parent }, board.parent) : null),
      h('span', { className: 'dshc-meta' }, headerMeta(board, now))),
    showDrift(view) ? h('div', { className: 'dshc-drift', 'data-drift': drift.kind, title: drift.error }, driftLine(drift, now)) : null)
}

/** The title cell's text: the issue (short, linked, full in the tooltip), then what. */
function Title({ task, parent, url, className, plainTitle }) {
  const p = titleParts(task, parent)
  return h('span', { className: 'dshc-tt ' + className, title: plainTitle },
    p.issue ? h(Link, { url, title: p.issue }, p.ref) : null,
    p.issue && p.what ? ' ' : null,
    p.what)
}

/** "Open PR #892 ↗" for a linked pr, else "Open #884 ↗" for a linked issue; nothing without a link. */
function OpenLink({ row, parent }) {
  const pr = safeUrl(row.prUrl)
  const url = pr || safeUrl(row.issueUrl)
  if (!url) return null
  const label = pr ? 'Open ' + prText(row.pr) : 'Open ' + shortRef(row.issue, parent)
  return h('a', { className: 'dshc-open', href: url, target: '_blank', rel: 'noopener noreferrer', title: pr ? row.pr : row.issue, onClick: stop }, label, extIcon())
}

function NeedsYou({ board, rows, byItem }) {
  const mine = needsYou(board.tasks)
  if (!mine.length) return null
  const rowOf = new Map(rows.map((r) => [r.item, r]))
  return h('section', { className: 'dshc-sec', 'data-needs-you': '', 'aria-label': 'Needs you' },
    h('div', { className: 'dshc-sech dshc-warn' }, warnIcon(), 'Needs you'),
    mine.map((t) => {
      const r = rowOf.get(t.item)
      const ask = typeof t.nextAction === 'string' && t.nextAction.trim() ? t.nextAction.trim() : undefined
      const command = typeof t.readyCommand === 'string' && t.readyCommand.trim() ? t.readyCommand.trim() : undefined
      return h('div', { key: t.item, className: 'dshc-ni', 'data-item': t.item },
        h('span', { className: 'dshc-mono dshc-id' }, t.item),
        h(Title, { task: byItem.get(t.item), parent: board.parent, url: r && r.issueUrl, className: 'dshc-wrap dshc-nit' }),
        r ? h(OpenLink, { row: r, parent: board.parent }) || h('span', null) : h('span', null),
        ask ? h('span', { className: 'dshc-ask' }, ask) : null,
        command ? h(CommandBox, { command, label: 'Copy command for ' + (r ? r.title : t.item) }) : null)
    }))
}

/** One line per problem, naming its reference; ↓ moves focus to its row. None: nothing. */
function Problems({ list }) {
  if (!list.length) return null
  return h('section', { className: 'dshc-sec', 'data-problems': '', 'aria-label': 'Board data problems' },
    h('div', { className: 'dshc-sech dshc-err' }, 'Board data problems'),
    list.map((p, i) => h('button', { key: i, type: 'button', className: 'dshc-prob', 'data-item': p.item, onClick: (e) => showRow(p.item, boardOf(e)) },
      h('span', { className: 'dshc-ic' }, warnIcon(14)),
      h('span', { className: 'dshc-wrap' }, p.text),
      h('span', { className: 'dshc-go', 'aria-label': 'Go to row', role: 'img' }, downIcon()))))
}

function Mark({ mark }) {
  if (mark === 'check') return checkIcon()
  const cls = mark === 'ring' ? 'dshc-ring' : mark === 'dash' ? 'dshc-dash' : 'dshc-dot dshc-' + mark
  return h('span', { className: 'dshc-mark', 'aria-hidden': true }, h('span', { className: cls }))
}

const tag = (key, cls, words, title) => h('span', { key, className: 'dshc-tag ' + cls, title }, words)

/**
 * The segmented bar, one segment per counted task, by shape; above 24 one
 * fill. The parent row draws it full width; the strip at a fixed width
 * (width). A segment's click goes to onSegment(item), else focuses its row.
 */
function Bar({ bar, onSegment = (item, e) => showRow(item, boardOf(e)), width }) {
  const aria = { role: 'img', 'aria-label': progressText({ done: bar.done, dropped: bar.dropped, total: bar.total }) + ' (work tasks)' }
  if (bar.continuous) return h(Fill, { bar })
  return h('span', { ...aria, className: 'dshc-bar', style: width ? { width } : undefined },
    bar.segments.map((g) => h('span', { key: g.item, className: 'dshc-seg', 'data-segment': g.kind, 'data-item': g.item, title: g.tooltip, onClick: (e) => { e.stopPropagation(); onSegment(g.item, e) } })))
}

function Meta({ c, bar, parent }) {
  const lines = []
  if (bar) lines.push(h(Bar, { key: 'bar', bar }))
  if (c.progress) {
    lines.push(h('span', { key: 'p', className: 'dshc-pp' }, progressText({ ...c.progress, needsYou: 0 }),
      c.progress.needsYou ? [' · ', h('span', { key: 'n', className: 'dshc-need' }, c.progress.needsYou + ' needs you')] : null))
  }
  if (c.line) lines.push(h('span', { key: 'line', className: 'dshc-wrap', 'data-line': '' }, c.line))
  if (c.needsYou) lines.push(tag('you', 'dshc-tag-warn', 'Needs you · see top'))
  if (c.blockedBy.length) {
    lines.push(h('span', { key: 'b', className: 'dshc-block' }, lockIcon(),
      h('span', { className: 'dshc-wrap' }, h('b', null, 'Blocked by '), c.blockedBy.map((b, i) => h('span', { key: i }, i ? ', ' : '', h('b', { title: b.ref }, shortRef(b.ref, parent)), ' ', h('span', { className: 'dshc-st' }, '(' + b.status + ')'))))))
  }
  if (c.ready) lines.push(tag('ready', 'dshc-tag-ok', 'ready'))
  c.problems.forEach((p, i) => lines.push(h('span', { key: 'f' + i, className: 'dshc-mprob' }, warnIcon(12), h('span', { className: 'dshc-wrap' }, p))))
  if (c.reported) lines.push(tag('drift', 'dshc-tag-quiet', c.reported.text, c.reported.note))
  return lines.length ? h('div', { className: 'dshc-cmeta' }, lines) : null
}

function Detail({ c, title }) {
  return h('div', { className: 'dshc-detail', 'data-detail': '' },
    c.detail.length ? h('dl', null, c.detail.map((d) => [h('dt', { key: d.key + 't' }, d.key), h('dd', { key: d.key + 'd', className: d.mono ? 'dshc-mono' : undefined }, d.value)])) : null,
    c.command ? h(CommandBox, { command: c.command, label: 'Copy command for ' + title }) : null)
}

function TaskRow({ boardKey, parent, row, task, flags, bar }) {
  const c = rowCells(row, flags)
  const id = boardKey + '\u0000' + row.item
  const [open, setOpen] = React.useState(expanded.get(id) === true)
  const toggle = () => { expanded.set(id, !open); setOpen(!open) }
  const isOpen = c.expandable && open
  const cls = 'dshc-li' + (c.parent ? ' dshc-parentrow' : '') + (row.closed ? ' dshc-closed' : '') + (row.dropped ? ' dshc-dropped' : '')
  return h('li', { 'data-item': row.item, 'data-status': row.status, tabIndex: -1, className: cls },
    h('div', { className: 'dshc-row', onClick: c.expandable ? (e) => { if (!e.target.closest || !e.target.closest('a,button,[data-segment],[data-detail]')) toggle() } : undefined, style: c.expandable ? { cursor: 'pointer' } : undefined },
      h('span', { className: 'dshc-mono dshc-cid', title: row.item }, row.item),
      h('span', { className: 'dshc-cst' }, c.mark ? h(Mark, { mark: c.mark }) : null, c.status ? h('span', null, c.status) : null),
      h('span', { className: 'dshc-ct' },
        c.indent ? h('span', { className: 'dshc-indent', style: { width: c.indent * 16 } }) : null,
        c.elbow ? h('span', { className: 'dshc-elbow', 'aria-hidden': true }) : null,
        h(Title, { task, parent, url: row.issueUrl, className: c.wrap ? 'dshc-wrap' : 'dshc-trunc', plainTitle: c.wrap ? undefined : row.title })),
      h('span', { className: 'dshc-cpr' }, c.pr ? h(Link, { url: c.prUrl, title: row.pr }, c.pr) : null),
      c.expandable
        ? h('button', { type: 'button', className: 'dshc-chev', 'aria-expanded': isOpen, 'aria-label': 'Details for ' + row.title, onClick: (e) => { e.stopPropagation(); toggle() } }, chevIcon(isOpen))
        : h('span', null),
      h(Meta, { c, bar, parent }),
      isOpen ? h(Detail, { c, title: row.title }) : null))
}

function Empty() {
  return h('div', { className: 'dshc-empty', 'data-empty': '' }, h('p', { className: 'dshc-empty-t' }, EMPTY_STATE.title), h('p', { className: 'dshc-empty-s' }, EMPTY_STATE.line))
}

/** The tab's body for one view answer (pure render; exported for tests). */
function BoardView({ view, now }) {
  if (!view.key) return h(Empty)
  if (!view.board) return h('p', { className: 'dshc-msg', role: 'alert' }, view.key + ': ' + view.error)
  const { board } = view
  const tasks = Array.isArray(board.tasks) ? board.tasks : []
  const links = view.links && typeof view.links === 'object' ? view.links : {}
  const rows = boardRows(board, { links })
  // The first task of an item, as the rows draw it, should a hand-edited file repeat one.
  const byItem = firstByItem(board)
  // The route's flags and problems, drawn by the same rules as the hub's text; computed here only without them.
  const flags = Array.isArray(view.flags) ? view.flags : boardFlags(tasks)
  const list = Array.isArray(view.problems) ? view.problems : problems(tasks, flags)
  const flagsOf = new Map()
  for (const f of flags) { if (!flagsOf.has(f.item)) flagsOf.set(f.item, []); flagsOf.get(f.item).push(f) }
  // The thin bar sits in the board's one parent row (the root with children)
  // and counts that row's children, as its progress text does.
  const parentItem = boardParent(rows)
  const bar = parentItem !== undefined ? boardSegments(board, rows, parentItem) : undefined
  return h('div', null,
    h(Header, { board, view, rows, now }),
    h(NeedsYou, { board, rows, byItem }),
    h(Problems, { list }),
    rows.length
      ? h('ul', { className: 'dshc-tree', role: 'list' }, rows.map((row) => h(TaskRow, {
        key: String(board.key) + '\u0000' + row.item, boardKey: board.key, parent: board.parent, row, task: byItem.get(row.item), flags: flagsOf.get(row.item) || [],
        bar: bar && row.item === parentItem ? bar : undefined,
      })))
      : h('p', { className: 'dshc-msg' }, 'No tasks yet.'))
}

// Tab id -> the navigation revision already shown, so a remounted body does not jump back to an old click.
const scrolledTo = new Map()

/**
 * The strip opens the tab with params { item }; the body shows that row once
 * it is drawn, once per navigation. useTabInfo is the framework's tab reader.
 */
function useShowRow(useTabInfo, ready, root) {
  const tab = typeof useTabInfo === 'function' ? useTabInfo()?.tab : undefined
  const nav = tab && tab.navigation
  const item = nav && nav.params && nav.params.item
  const revision = nav && nav.revision
  React.useEffect(() => {
    if (!ready || item === undefined || scrolledTo.get(tab.id) === revision) return
    scrolledTo.set(tab.id, revision)
    showRow(item, root.current)
  }, [ready, item, revision])
}

function BoardBody({ sessionId, useTabInfo }) {
  useStyle()
  const { loading, view, error } = useView(sessionId)
  const now = useMinute()
  const root = React.useRef(null)
  useShowRow(useTabInfo, Boolean(view && view.board), root)
  const wrap = (child) => h('section', { 'data-dsh-cockpit-board': '', ref: root }, child)
  if (loading) return wrap(h('p', { className: 'dshc-msg' }, 'Loading board…'))
  // A failed poll keeps the last view; only with none is the error shown.
  if (!view) return wrap(h('p', { className: 'dshc-msg', role: 'alert' }, 'Board unavailable: ' + error))
  return wrap(h(BoardView, { view, now }))
}

// ---- The progress strip above the chat input (conversation.input.dock) ----

/** The strip's model for one view answer (pure; exported for tests): undefined, so nothing shows, without a bound board that parsed. */
function dockModel(view) {
  if (!view || !view.key || !view.board || !Array.isArray(view.board.tasks)) return undefined
  const board = { ...view.board, key: view.board.key || view.key }
  const m = stripModel(board, boardRows(board, { links: view.links }))
  // The count, and what a narrow strip may leave out of it (" · 1 dropped").
  const count = m.bar.done + ' of ' + m.bar.total + ' done'
  return { ...m, count, more: m.done.slice(count.length) || undefined, line: stripText(m), tooltip: stripTitle(m) }
}

/** The bar's width in the strip at its widest: 10 px a segment, between 48 and 120 px; it shrinks to 3 px a segment. */
const stripBarWidth = (bar) => Math.min(120, Math.max(48, bar.segments.length * 10))

/** The continuous fill: done of the open (not dropped) tasks. */
function Fill({ bar, className }) {
  const label = progressText({ done: bar.done, dropped: bar.dropped, total: bar.total }) + ' (work tasks)'
  const open = bar.total - bar.dropped
  const fill = open > 0 ? Math.round((bar.done / open) * 100) : 100
  return h('span', { role: 'img', 'aria-label': label, className: 'dshc-fill' + (className ? ' ' + className : ''), title: label }, h('span', { style: { width: fill + '%' } }))
}

const sep = (key) => h('span', { key, className: 'dshc-sep', 'aria-hidden': true }, '·')

/** The strip (pure render; exported for tests). openBoard(item?) opens the Board tab at that row. */
function StripView({ m, openBoard }) {
  const open = (item) => (e) => { if (e && e.stopPropagation) e.stopPropagation(); if (openBoard) openBoard(item) }
  const go = h('button', { key: 'go', type: 'button', className: 'dshc-go', onClick: open(m.item) }, 'Board ›')
  const parts = m.kind === 'needs you'
    ? [
      h('span', { key: 'w', className: 'dshc-ic' }, warnIcon(12)),
      h('span', { key: 'f', className: 'dshc-focus dshc-trunc' },
        h('span', { className: 'dshc-need' }, m.text.startsWith('Needs you:') ? 'Needs you:' : m.text),
        m.text.startsWith('Needs you:') ? m.text.slice('Needs you:'.length) : null),
      m.command ? h(CopyButton, { key: 'c', text: m.command, label: 'Copy command for ' + (m.title || m.item), words: 'Copy command', icon: false }) : null,
      m.command ? sep('s2') : null,
      go,
    ]
    : [
      m.key ? h('span', { key: 'k', className: 'dshc-mono dshc-key dshc-trunc', title: m.key }, m.key) : null,
      m.key ? sep('s1') : null,
      h('span', { key: 'd', className: 'dshc-done' }, m.count, m.more ? h('span', { className: 'dshc-more' }, m.more) : null),
      m.focus ? sep('s2') : null,
      h('span', { key: 'f', className: 'dshc-focus dshc-trunc' }, m.focus || ''),
      go,
    ]
  return h('div', { 'data-dsh-cockpit-dock': '', 'data-strip': m.kind, className: 'dshc-stripbox' },
    // A div, not a button: the segments and buttons inside take their own clicks.
    // The tooltip carries the full text, whatever the width cuts.
    h('div', {
      className: 'dshc-strip', role: 'button', tabIndex: 0, 'aria-label': m.line, title: m.tooltip, 'data-kind': m.kind, onClick: open(m.item),
      onKeyDown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(m.item)() } },
    },
      h(Bar, { bar: m.bar, onSegment: (item) => open(item)(), width: stripBarWidth(m.bar) }),
      // The narrow strip's bar, shown by the container query instead of the segments.
      m.bar.continuous ? null : h(Fill, { bar: m.bar, className: 'dshc-alt' }),
      parts))
}

function BoardDock({ sessionId, openBoard }) {
  useStyle()
  const { view } = useView(sessionId)
  const m = dockModel(view)
  return m ? h(StripView, { m, openBoard }) : null
}

// ---- Chat cards for the board tools (the keyed tool.call.toolview slot) ----

const parseArgs = (raw) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
const CARD_FIELDS = ['key', 'parent', 'item', 'what', 'status', 'dependsOn', 'set', 'remove', 'checkDrift']
/**
 * A settled call's arguments: its call head's argsRaw, else (the call has
 * left the loaded window) the node's own lazy argument view, else {}.
 */
function settledArgs(block) {
  if (typeof block.call?.argsRaw === 'string') return parseArgs(block.call.argsRaw)
  const view = block.args
  if (!view || typeof view.value !== 'function') return {}
  const out = {}
  for (const k of CARD_FIELDS) { try { const v = view.value(k); if (v !== undefined) out[k] = v } catch {} }
  return out
}

/**
 * A card's state, title and summary (pure; exported for tests). The summary
 * is the result meta's title when the host recorded one, else lib/present.js's
 * call title from the arguments. A result { ok: false } is an error that
 * names its code. output: the result text, shown when the card is opened.
 */
function toolCardModel(props) {
  const block = props.block || {}
  const name = props.toolName || block.name
  if (props.phase === 'preparing') return { state: 'running', title: 'Board', summary: name, output: null }
  const settled = props.phase === 'result'
  const args = settled ? settledArgs(block) : parseArgs(block.argsRaw ?? '')
  if (!settled) return { state: 'running', title: 'Board', summary: callTitle(name, args), output: null }
  const output = (block.content || []).map((c) => (c && c.type === 'text' ? c.text : JSON.stringify(c))).join('\n') || null
  let value
  try { value = output ? JSON.parse(output) : undefined } catch {}
  if (value && value.ok === false) return { state: 'error', title: 'Board', summary: callTitle(name, args) + ' · ' + String(value.code), output, value }
  const metaTitle = block.meta && typeof block.meta.title === 'string' ? block.meta.title : undefined
  const state = block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
  const summary = (state === 'ok' && metaTitle ? metaTitle : callTitle(name, args)) + (state === 'error' ? ' · failed' : state === 'stopped' ? ' · stopped' : '')
  return { state, title: 'Board', summary, output, value }
}

/** The opened card's text: the result's tree text when it has one, else the result as indented JSON. */
function cardBody(m) {
  if (!m.output) return ''
  if (m.value && typeof m.value === 'object') return typeof m.value.tree === 'string' ? m.value.tree : JSON.stringify(m.value, null, 2)
  return m.output
}

/**
 * The host's DisclosureRow and checklist icon, so a card looks like the
 * other tool rows; required on first use, and a plain row without them.
 */
let primitivesCache
function cardPrimitives() {
  if (primitivesCache === undefined) {
    try { primitivesCache = require('@deepseek-ai/dsh-client-ui-primitives') || null } catch { primitivesCache = null }
  }
  return primitivesCache
}

function BoardToolRow(props) {
  useStyle()
  const primitives = cardPrimitives()
  // The result is parsed once per block, not on every render.
  const m = React.useMemo(() => toolCardModel(props), [props.phase, props.block, props.toolName])
  const disclosure = typeof props.useDisclosure === 'function' ? props.useDisclosure() : null
  const [localOpen, setLocalOpen] = React.useState(false)
  const open = disclosure ? disclosure.expanded : localOpen
  const toggle = disclosure ? disclosure.toggle : () => setLocalOpen(!localOpen)
  const expandable = Boolean(m.output)
  const Icon = primitives && primitives.IconChecklistOutlineRegular
  const icon = Icon ? h(Icon, { size: 14 }) : null
  const summary = h('span', { className: 'dshc-card-sum', 'data-state': m.state, title: m.summary }, m.summary)
  const body = open && expandable ? h('pre', { className: 'dshc-card-out' }, cardBody(m)) : null
  const Row = primitives && primitives.DisclosureRow
  if (Row) {
    return h('div', { 'data-tool': props.toolName, 'data-state': m.state },
      h(Row, { icon, title: m.title, open: open && expandable, expandable, onToggle: toggle, running: m.state === 'running', expandOnRowClick: true, collapsedContent: summary, keepContentWhenOpen: true }, body))
  }
  return h('div', { 'data-tool': props.toolName, 'data-state': m.state },
    h('div', {
      role: expandable ? 'button' : undefined, tabIndex: expandable ? 0 : undefined, 'aria-expanded': expandable ? open : undefined, onClick: expandable ? toggle : undefined,
      onKeyDown: expandable ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle() } } : undefined,
      style: { display: 'flex', alignItems: 'center', cursor: expandable ? 'pointer' : 'default' } }, icon, h('span', null, m.title), summary),
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
  // One card per board tool, keyed by its wire name.
  for (const key of TOOLS) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key }, BoardToolRow))
  }
  // Above the input box, after the Todo, Goal and Queue docks (orders 0, 10, 20).
  // openTab acts on the on-screen session, the dock's; with an item the tab
  // scrolls to its row (navigation params, see useShowRow).
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-cockpit-progress',
    order: 30,
    inject: (sessionId) => ({ sessionId, openBoard: (item) => ctx.sidebarRight.openTab(KIND, item === undefined ? undefined : { params: { item } }) }),
  }, BoardDock))
}

module.exports = { apply, inject, BoardView, StripView, dockModel, toolCardModel, cardBody, whenText, clockText, headerMeta, driftLine, showDrift, safeUrl, copyStep, copyText, refUrl, CSS, ID, KIND, TOOLS }

return module.exports;
} });
