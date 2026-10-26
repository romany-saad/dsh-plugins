// What each board row says: one model shared by the tree text (lib/tree.js),
// the reader and the Board tab (client/build.mjs inlines this file into
// client/client.js). Pure, with no imports, so it can be inlined.

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const same = (a, b) => a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase()
/** done or dropped: closed tasks block nothing (lib/task.js isClosed; repeated so this file stays import-free). */
const closed = (status) => status === 'done' || status === 'dropped'

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
 * loop, or with a parent not on the board, sits under the board's root task
 * (the one root task with children, when there is exactly one), else at the
 * top, after the real roots (misplaced lists those). A loop has no ancestor
 * outside it: every task up a looped task's parent chain is in the same loop.
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
 * @param {object[]} tasks
 * @param {object[]} [flags] boardFlags(tasks), when the caller has them
 */
export function problems(tasks, flags = boardFlags(tasks)) {
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
export const waitsOnOwner = (task) => text(task.waitingOn)?.toLowerCase() === 'owner'

/** The open tasks (not done, not dropped) whose waitingOn is the owner. Nothing else is guessed. */
export const needsYou = (tasks) => tasks.filter((t) => !closed(t.status) && waitsOnOwner(t))

/** nextAction, why and startWhen, present and each text once, in that order. */
export function notes(task) {
  const out = []
  for (const [label, value] of [['next', task.nextAction], ['why', task.why], ['start when', task.startWhen]]) {
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
export function refUrl(ref, kind, { links, parent } = {}) {
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
export function titleText(task) {
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
export function boardRows(board, options = {}) {
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
export const reportedText = (reported) => 'reported: ' + reported.status

/** "4 of 6 done · 1 dropped · 1 needs you": dropped is counted apart from done. */
export const progressText = (p) => p.done + ' of ' + p.total + ' done' +
  (p.dropped ? ' · ' + p.dropped + ' dropped' : '') +
  (p.needsYou ? ' · ' + p.needsYou + ' needs you' : '')

/** "blocked by #884 (waiting), #885 (now)". */
export const blockedText = (blockedBy) => 'blocked by ' + blockedBy.map((b) => b.ref + ' (' + b.status + ')').join(', ')

// ---- What the Board tab shows (design 6, C · Outline, refined) ----

/** The row's status mark by shape: a check, a ring, an info dot, a grey dot, a dash. */
export const STATUS_MARK = { done: 'check', next: 'ring', now: 'dot-now', waiting: 'dot-waiting', dropped: 'dash' }

/**
 * A reference as a title shows it: "#12" when "owner/repo#12" is in the
 * repository of the board's parent reference, "repo#12" when it is in
 * another; anything else as stored. The link and its tooltip keep the full one.
 * @param {string|undefined} ref
 * @param {string} [parent] the board's parent reference
 */
export function shortRef(ref, parent) {
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
export function titleParts(task, parent) {
  const what = String(task.what ?? '')
  const issue = text(task.issue)
  if (!issue) return { what }
  const leads = what === issue || (what.startsWith(issue) && /^\s/.test(what.slice(issue.length)))
  return { issue, ref: shortRef(issue, parent), what: leads ? what.slice(issue.length).trim() : what }
}

/** "PR #892" from "#892", "o/r#892" or a URL ending in "/892"; "PR" for anything else. */
export function prText(pr) {
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
export function rowCells(row, flags = []) {
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
export const SEGMENT_MAX = 24

/** A segment's kind: done, dropped, 'needs you', now, ready (next and every dependency closed), blocked (other next) or waiting. */
export const segmentKind = (r) => r.done ? 'done' : r.dropped ? 'dropped' : r.needsYou ? 'needs you' : r.status === 'now' ? 'now'
  : r.status === 'next' ? (r.ready ? 'ready' : 'blocked') : 'waiting'

/** Tasks by item, the first of a repeated item, as the rows draw it. */
export function firstByItem(board) {
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
export function boardParent(rows) {
  const roots = rows.filter((r) => r.depth === 0 && r.progress)
  return roots.length === 1 ? roots[0].item : undefined
}

/**
 * The rows the strip counts across the whole board: every
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
 * With item undefined, the segments are all whole-board work tasks, the
 * rows without children; the progress strip always uses that.
 * @param {{tasks: object[]}} board
 * @param {ReturnType<typeof boardRows>} rows the board's rows, from boardRows(board)
 * @param {string|undefined} item the parent row's item
 */
export function boardSegments(board, rows, item) {
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
export function driftState(drift, rows) {
  if (!drift || typeof drift !== 'object') return { kind: 'not run' }
  const at = typeof drift.checkedAt === 'string' ? drift.checkedAt : undefined
  if (drift.error !== undefined) return { kind: 'failed', error: typeof drift.error === 'string' ? drift.error : JSON.stringify(drift.error), at }
  const count = rows.filter((r) => r.reported).length
  return { kind: count ? 'differs' : 'matches', count, at }
}

/** "not run yet", "failed", "matches", "1 differs", "2 differ". */
export function driftWords(state) {
  if (state.kind === 'not run') return 'not run yet'
  if (state.kind === 'failed' || state.kind === 'matches') return state.kind
  return state.count + (state.count === 1 ? ' differs' : ' differ')
}

// ---- The progress strip above the chat input (design 6) ----

/**
 * The strip: whole-board leaf segments and counts, including standalone
 * top-level tasks without double-counting parent containers, and one focus.
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
export function stripModel(board, rows = boardRows(board)) {
  const byItem = firstByItem(board)
  const home = board?.parent
  const ref = (r) => shortRef(r, home) ?? r
  const bar = boardSegments(board, rows, undefined)
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
export function stripText(m) {
  if (m.kind === 'needs you') return ['⚠ ' + m.text, m.command ? 'Copy command' : '', 'Board ›'].filter(Boolean).join(' · ')
  return [m.key, m.done, m.focus, 'Board ›'].filter(Boolean).join(' · ')
}

/** The strip's tooltip: what it says in full, with the needs-you task's title. */
export function stripTitle(m) {
  if (m.kind === 'needs you') return '⚠ ' + m.text + (m.title && m.text.startsWith('Needs you:') ? ' (' + m.title + ')' : '') + ' · ' + m.done
  return [m.key, m.done, m.focus].filter(Boolean).join(' · ')
}

/** What the tab shows with no board: the design's title and one line. */
export const EMPTY_STATE = {
  title: 'No board in this session',
  line: 'A hub agent binds a board when it starts to coordinate work. The board shows here after that.',
}
