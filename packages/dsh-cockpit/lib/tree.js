// Draw a board's tasks as a tree (design 3.4). No DSH imports.

const STATUS_WIDTH = 9 // 'waiting' + 2

/**
 * @param {{tasks: object[]}} board
 * @param {{only?: Set<string>}} [options] draw only these items (filters); a
 *   task whose parent is not drawn becomes a root, without a flag.
 * @returns {{tree: string, flags: {item: string, code: string, ref: string}[]}}
 */
export function boardTree(board, options = {}) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : []
  const only = options.only
  const byItem = new Map(tasks.map((t) => [t.item, t]))

  // A task is in a parent loop when following parents leads back to it.
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

  const flags = []
  const flagsOf = new Map()
  const flag = (item, code, ref) => {
    const f = { item, code, ref }
    flags.push(f)
    if (!flagsOf.has(item)) flagsOf.set(item, [])
    flagsOf.get(item).push(f)
  }
  for (const t of tasks) {
    if (t.parent !== undefined && !byItem.has(t.parent)) flag(t.item, 'unknown_parent', t.parent)
    if (inLoop.has(t.item)) flag(t.item, 'parent_loop', t.parent)
    for (const d of Array.isArray(t.dependsOn) ? t.dependsOn : []) if (!byItem.has(d)) flag(t.item, 'unknown_dependency', d)
  }

  const drawn = tasks.filter((t) => !only || only.has(t.item))
  const isRoot = (t) => t.parent === undefined || !byItem.has(t.parent) || inLoop.has(t.item) || (only && !only.has(t.parent))
  const children = new Map()
  for (const t of drawn) {
    if (isRoot(t)) continue
    if (!children.has(t.parent)) children.set(t.parent, [])
    children.get(t.parent).push(t)
  }

  const rows = []
  const visited = new Set()
  const walk = (t, depth) => {
    if (visited.has(t.item)) return
    visited.add(t.item)
    rows.push({ t, depth })
    for (const c of children.get(t.item) ?? []) walk(c, depth + 1)
  }
  for (const t of drawn) if (isRoot(t)) walk(t, 0)

  const itemWidth = Math.max(0, ...rows.map((r) => String(r.t.item).length)) + 1
  const lines = rows.map(({ t, depth }) => {
    const prefix = '  '.repeat(depth) + String(t.item).padEnd(itemWidth) + String(t.status).padEnd(STATUS_WIDTH) + String(t.what ?? '')
    const suffix = []
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : []
    if (deps.length) suffix.push('after ' + deps.join(', '))
    for (const f of flagsOf.get(t.item) ?? []) {
      suffix.push(f.code === 'parent_loop' ? '! parent loop' : `! ${f.code.replace('_', ' ')} ${f.ref}`)
    }
    return { prefix, suffix: suffix.join('   ') }
  })
  const width = Math.max(0, ...lines.filter((l) => l.suffix).map((l) => l.prefix.length))
  const tree = lines.map((l) => (l.suffix ? l.prefix.padEnd(width) + '   ' + l.suffix : l.prefix)).join('\n')
  return { tree, flags: only ? flags.filter((f) => only.has(f.item)) : flags }
}
