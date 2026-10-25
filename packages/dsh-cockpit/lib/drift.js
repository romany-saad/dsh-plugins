// The drift record (design section 5), as model and format: what a drift
// command's output becomes in the board file. Running the command is a later
// step; this file has no I/O. No DSH imports.
import { STATUSES } from './task.js'

const tail = (text, n = 400) => (text.length > n ? '…' + text.slice(-n) : text).trim()

/**
 * Turn one run of the drift command ({ code, signal, stdout, stderr }) into
 * the stored drift record and, in apply mode, the new tasks.
 *
 * The record is { checkedAt, checked, items } or, on failure,
 * { checkedAt, error } with the tasks unchanged. checked counts every entry
 * the command reported; items keeps only the entries whose status differs
 * from their task's ({ item, status, note? }), so a matching entry is not
 * stored (finding E2).
 *
 * mode 'report' changes no task. mode 'apply' sets each differing task's
 * status, and changed is true when one did.
 * @returns {{ drift: object, tasks: object[], changed: boolean }}
 */
export function driftResult(board, run, { mode = 'report', now = () => new Date().toISOString() } = {}) {
  const checkedAt = now()
  const fail = (error) => ({ drift: { checkedAt, error }, tasks: board.tasks, changed: false })
  if (run.code !== 0) return fail(`exit ${run.code ?? run.signal}: ${tail(run.stderr ?? '')}`)
  let out
  try {
    out = JSON.parse(run.stdout)
  } catch (error) {
    return fail(`output is not JSON: ${error.message}; stderr: ${tail(run.stderr ?? '')}`)
  }
  if (!out || !Array.isArray(out.items)) return fail('output has no items array')
  const byItem = new Map(board.tasks.map((t) => [t.item, t]))
  const entries = out.items.filter((e) => e && typeof e.item === 'string')
  const items = []
  for (const e of entries) {
    const task = byItem.get(e.item)
    if (!task || !STATUSES.includes(e.status) || task.status === e.status) continue
    const entry = { item: e.item, status: e.status }
    if (typeof e.note === 'string') entry.note = e.note
    items.push(entry)
  }
  let tasks = board.tasks
  let changed = false
  if (mode === 'apply' && items.length) {
    const target = new Map(items.map((e) => [e.item, e.status]))
    tasks = board.tasks.map((t) => (target.has(t.item) ? { ...t, status: target.get(t.item), updatedAt: checkedAt } : t))
    changed = true
  }
  return { drift: { checkedAt, checked: entries.length, items }, tasks, changed }
}
