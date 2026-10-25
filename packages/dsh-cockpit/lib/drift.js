// The optional drift command (design 5): the user's own check of the linked
// work's real state. Runs only on board_read({ checkDrift: true }).
import { spawn } from 'node:child_process'
import { STATUSES } from './task.js'

const tail = (text, n = 400) => (text.length > n ? '…' + text.slice(-n) : text).trim()

/** Run the command through the system shell with the board JSON on stdin. */
export function runDriftCommand({ command, cwd, env, input, signal }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    // Its own process group, so cancelling stops the shell and what it started.
    const child = spawn(command, { shell: true, cwd: cwd || undefined, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const onAbort = () => {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
      reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('close', () => signal?.removeEventListener('abort', onAbort))
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d })
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d })
    child.stdin.on('error', () => {}) // the command may not read stdin
    child.on('error', reject)
    child.on('close', (code, sig) => resolve({ code, signal: sig, stdout, stderr }))
    child.stdin.end(input)
  })
}

/**
 * Turn a run into the stored drift record and, in apply mode, the new tasks.
 * @returns {{ drift: object, tasks: object[], changed: boolean }}
 */
export function driftResult(board, run, { mode, now }) {
  const checkedAt = now()
  const fail = (error) => ({ drift: { checkedAt, items: [], error }, tasks: board.tasks, changed: false })
  if (run.code !== 0) return fail(`exit ${run.code ?? run.signal}: ${tail(run.stderr)}`)
  let out
  try {
    out = JSON.parse(run.stdout)
  } catch (error) {
    return fail(`output is not JSON: ${error.message}; stderr: ${tail(run.stderr)}`)
  }
  if (!out || !Array.isArray(out.items)) return fail('output has no items array')
  const byItem = new Map(board.tasks.map((t) => [t.item, t]))
  const items = out.items
    .filter((e) => e && typeof e.item === 'string')
    .map((e) => {
      const entry = { item: e.item }
      if (typeof e.status === 'string') entry.status = e.status
      if (typeof e.note === 'string') entry.note = e.note
      const task = byItem.get(e.item)
      entry.differs = !!task && STATUSES.includes(entry.status) && task.status !== entry.status
      return entry
    })
  let changed = false
  let tasks = board.tasks
  if (mode === 'apply') {
    const target = new Map(items.filter((e) => e.differs).map((e) => [e.item, e.status]))
    tasks = board.tasks.map((t) => (target.has(t.item) ? { ...t, status: target.get(t.item), updatedAt: checkedAt } : t))
    changed = target.size > 0
  }
  return { drift: { checkedAt, items }, tasks, changed }
}
