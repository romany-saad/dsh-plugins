// Draw a board's tasks as a tree (design section 3). No DSH imports. The row
// text, the flags and the problems come from lib/rows.js.
import { blockedText, boardFlags, boardRows, flagText, problems, progressText, reportedText } from './rows.js'

export { boardFlags, flagText, problems }

/**
 * @param {{tasks: object[], parent?: string}} board
 * @param {{only?: Set<string>}} [options] draw only these items (filters); a
 *   task whose parent is not drawn becomes a root, without a flag.
 * @returns {{tree: string, flags: object[], problems: {item: string, items: string[], text: string}[]}}
 *   tree: a "Problems:" block first when there are any, then the rows.
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
  const statusWidth = Math.max(0, ...rows.map((r) => String(r.status).length)) + 2
  const lines = rows.map((r) => {
    const prefix = head(r).padEnd(idWidth) + String(r.status).padEnd(statusWidth) + r.title
    const suffix = []
    if (r.progress) suffix.push(progressText(r.progress))
    if (r.line) suffix.push(r.line)
    if (r.done && r.pr) suffix.push('PR ' + r.pr)
    if (r.blockedBy.length) suffix.push(blockedText(r.blockedBy))
    else if (r.after.length) suffix.push('after ' + r.after.join(', '))
    if (r.reported) suffix.push(reportedText(r.reported))
    for (const f of flagsOf.get(r.item) ?? []) suffix.push('! ' + flagText(f))
    return { prefix, suffix: suffix.join('   ') }
  })
  const width = Math.max(0, ...lines.filter((l) => l.suffix).map((l) => l.prefix.length))
  const body = lines.map((l) => (l.suffix ? l.prefix.padEnd(width) + '   ' + l.suffix : l.prefix)).join('\n')
  const all = problems(tasks, flags)
  const shown = only ? all.filter((p) => p.items.some((i) => only.has(i))) : all
  const top = shown.length ? 'Problems:\n' + shown.map((p) => '  ' + p.text).join('\n') + '\n\n' : ''
  return { tree: top + body, flags: only ? flags.filter((f) => only.has(f.item)) : flags, problems: shown }
}
