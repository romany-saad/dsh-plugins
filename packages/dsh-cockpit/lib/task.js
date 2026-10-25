// The task model of the design (section 3.1) plus decision 16's readyCommand.
// No DSH imports: the reader and a fallback hub use it with plain Node.

export const STATUSES = ['next', 'now', 'waiting', 'done']

/** Optional free-form string fields, in file order. */
export const STRING_FIELDS = [
  'why', 'issue', 'pr', 'branch', 'worktree', 'provider', 'model', 'effort',
  'nextAction', 'waitingOn', 'readyCommand', 'parent',
]

/** Every task field, in the order the file stores them. */
export const TASK_FIELDS = ['item', 'what', 'status', ...STRING_FIELDS, 'dependsOn', 'extra', 'updatedAt']

/**
 * The next integer item: the largest integer item plus one, else 1 (decision 15).
 * @param {{item: string}[]} tasks
 */
export function nextItem(tasks) {
  let max = 0
  for (const t of tasks) if (/^\d+$/.test(t.item)) max = Math.max(max, Number(t.item))
  return String(max + 1)
}

/** Copy a task with its fields in file order, dropping undefined ones. */
export function orderTask(task) {
  const out = {}
  for (const f of TASK_FIELDS) if (task[f] !== undefined) out[f] = task[f]
  // Unknown fields a fallback hub wrote are kept, after the known ones.
  for (const [k, v] of Object.entries(task)) if (!(k in out) && v !== undefined) out[k] = v
  return out
}
