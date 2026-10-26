// Drift (design section 5): the user's own command that reports the real
// state of linked work, and what its output becomes in the board file. The
// command comes only from the profile config and runs only on
// board_read({ checkDrift: true }). No DSH imports.
import { spawn } from 'node:child_process'
import { STATUSES } from './task.js'

const tail = (text, n = 400) => (text.length > n ? '…' + text.slice(-n) : text).trim()
// More than tail() keeps, so tail() still marks a cut with "…".
const STDERR_KEPT = 4096

/**
 * Run the drift command through the system shell, with env and the board's
 * JSON on stdin. It runs in its own process group, so an abort stops the
 * shell and what it started (on Windows, only the shell); the promise then
 * rejects with the abort reason. A command that cannot start resolves with
 * error set. Only the end of stderr is kept, as driftResult stores no more.
 * @returns {Promise<{ code: number|null, signal: string|null, stdout: string, stderr: string, error?: string }>}
 */
export function runDriftCommand({ command, cwd, env, input, signal }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(command, { shell: true, cwd: cwd || undefined, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const onAbort = () => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
      reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d })
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr = (stderr + d).slice(-STDERR_KEPT) })
    child.stdin.on('error', () => {}) // the command need not read stdin
    child.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: null, signal: null, stdout, stderr, error: error.message })
    })
    child.on('close', (code, sig) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ code, signal: sig, stdout, stderr })
    })
    child.stdin.end(input)
  })
}

/**
 * Turn one run of the drift command ({ code, signal, stdout, stderr, error? }) into
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
  if (run.error !== undefined) return fail(`could not start: ${run.error}`)
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
