// Draw a board's tasks as a tree (design 3.4). No DSH imports. The row text
// comes from lib/rows.js, the model the Board panel shows too.
import { blockedText, boardRows, parentLoops, progressText } from './rows.js'

/**
 * @param {{tasks: object[], parent?: string}} board
 * @param {{only?: Set<string>}} [options] draw only these items (filters); a
 *   task whose parent is not drawn becomes a root, without a flag.
 * @returns {{tree: string, flags: {item: string, code: string, ref: string}[]}}
 */
export function boardTree(board, options = {}) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const only = options.only
  const flags = boardFlags(tasks)
  const flagsOf = new Map()
  for (const f of flags) {
    if (!flagsOf.has(f.item)) flagsOf.set(f.item, [])
    flagsOf.get(f.item).push(f)
  }

  const rows = boardRows(board, only ? { only } : {})
  const head = (r) => r.guide + r.item
  const idWidth = Math.max(0, ...rows.map((r) => head(r).length)) + 2
  const statusWidth = Math.max(0, ...rows.map((r) => r.status.length)) + 2
  const lines = rows.map((r) => {
    const prefix = head(r).padEnd(idWidth) + String(r.status).padEnd(statusWidth) + r.title
    const suffix = []
    if (r.progress) suffix.push(progressText(r.progress))
    if (r.line) suffix.push(r.line)
    if (r.done && r.pr) suffix.push('PR ' + r.pr)
    if (r.blockedBy.length) suffix.push(blockedText(r.blockedBy))
    else if (r.after.length) suffix.push('after ' + r.after.join(', '))
    for (const f of flagsOf.get(r.item) ?? []) suffix.push(flagText(f))
    return { prefix, suffix: suffix.join('   ') }
  })
  const width = Math.max(0, ...lines.filter((l) => l.suffix).map((l) => l.prefix.length))
  const tree = lines.map((l) => (l.suffix ? l.prefix.padEnd(width) + '   ' + l.suffix : l.prefix)).join('\n')
  return { tree, flags: only ? flags.filter((f) => only.has(f.item)) : flags }
}

/** "! unknown dependency 9", "! parent loop". */
export const flagText = (f) => (f.code === 'parent_loop' ? '! parent loop' : '! ' + f.code.replace('_', ' ') + ' ' + f.ref)

/** unknown_parent, parent_loop and unknown_dependency, in board order. */
export function boardFlags(tasks) {
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  const inLoop = parentLoops(tasks)
  const flags = []
  for (const t of tasks) {
    if (t.parent !== undefined && !byItem.has(t.parent)) flags.push({ item: t.item, code: 'unknown_parent', ref: t.parent })
    if (inLoop.has(t.item)) flags.push({ item: t.item, code: 'parent_loop', ref: t.parent })
    for (const d of Array.isArray(t.dependsOn) ? t.dependsOn : []) if (!byItem.has(d)) flags.push({ item: t.item, code: 'unknown_dependency', ref: d })
  }
  return flags
}
