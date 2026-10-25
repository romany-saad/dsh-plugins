import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { driftResult, runDriftCommand } from '../lib/drift.js'
import { exec, setup, t } from './helpers.mjs'

const board = { tasks: [t('1', 'done', 'one'), t('2a', 'waiting', 'two'), t('3', 'next', 'three')] }
const now = () => '2026-10-25T08:00:00.000Z'
const run = (items, more = {}) => ({ code: 0, signal: null, stdout: JSON.stringify({ items }), stderr: '', ...more })

test('only differing entries are kept; checked counts every entry', () => {
  const r = driftResult(board, run([
    { item: '2a', status: 'done', note: '#902 merged' },
    { item: '1', status: 'done', note: 'still merged' },
    { item: '3', note: 'no status' },
    { item: 'ghost', status: 'done' },
    { item: '3', status: 'merged' },
  ]), { mode: 'report', now })
  assert.deepEqual(r.drift, { checkedAt: now(), checked: 5, items: [{ item: '2a', status: 'done', note: '#902 merged' }] })
  assert.equal(r.changed, false)
  assert.equal(r.tasks, board.tasks, 'report changes no task')
})

test('everything matches: an empty items list', () => {
  const r = driftResult(board, run([{ item: '1', status: 'done' }]), { now })
  assert.deepEqual(r.drift, { checkedAt: now(), checked: 1, items: [] })
})

test('apply sets each differing status and reports the change', () => {
  const r = driftResult(board, run([{ item: '2a', status: 'done' }, { item: '3', status: 'dropped' }, { item: '1', status: 'done' }]), { mode: 'apply', now })
  assert.equal(r.changed, true)
  assert.deepEqual(r.tasks.map((x) => x.status), ['done', 'done', 'dropped'])
  assert.equal(r.tasks[1].updatedAt, now())
  assert.equal(r.tasks[0], board.tasks[0], 'a matching task is untouched')
  assert.equal(driftResult(board, run([{ item: '1', status: 'done' }]), { mode: 'apply', now }).changed, false)
})

test('a failed run stores error and leaves the tasks', () => {
  for (const r of [
    driftResult(board, { code: 3, signal: null, stdout: '', stderr: 'boom' }, { now }),
    driftResult(board, run([], { stdout: 'not json' }), { now }),
    driftResult(board, run([], { stdout: '{"nope":1}' }), { now }),
  ]) {
    assert.equal(typeof r.drift.error, 'string')
    assert.equal(r.drift.items, undefined)
    assert.equal(r.tasks, board.tasks)
    assert.equal(r.changed, false)
  }
  assert.match(driftResult(board, { code: 3, stdout: '', stderr: 'boom' }, { now }).drift.error, /^exit 3: boom$/)
})

test('a command that cannot start stores error', () => {
  const r = driftResult(board, { code: null, signal: null, stdout: '', stderr: '', error: 'spawn ENOENT' }, { now })
  assert.equal(r.drift.error, 'could not start: spawn ENOENT')
  assert.equal(r.tasks, board.tasks)
})

// The runner and board_read({ checkDrift }), with a node script as the drift command.

const node = (file) => `"${process.execPath}" "${file}"`

async function withCommand(script, { mode = 'report', cwd = '' } = {}) {
  const s = await setup()
  const file = join(s.home, 'drift.mjs')
  await writeFile(file, script)
  const d = await setup({ home: s.home, config: { drift: { command: node(file), cwd, mode } } })
  await d.tools.board_open({ key: 'k' }, exec())
  await d.tools.board_add({ item: '1', what: 'one', status: 'done', pr: '#901' }, exec())
  await d.tools.board_add({ item: '2a', what: 'two', status: 'waiting', pr: '#902' }, exec())
  return d
}

const REPORT = `let s = ''
process.stdin.on('data', (d) => { s += d }).on('end', () => {
  const b = JSON.parse(s)
  process.stdout.write(JSON.stringify({ items: b.tasks.map((t) => ({ item: t.item, status: 'done', note: t.pr + ' merged' })) }))
})`

const fileOf = async (d) => JSON.parse(await readFile(d.store.file('k'), 'utf8'))

test('runDriftCommand: the shell runs the command with stdin, env and cwd', async () => {
  const s = await setup()
  const run = await runDriftCommand({ command: 'cat; printf " %s %s" "$X" "$(pwd)"', cwd: s.home, env: { ...process.env, X: 'x' }, input: 'in' })
  assert.deepEqual(run, { code: 0, signal: null, stdout: `in x ${s.home}`, stderr: '' })
  const failed = await runDriftCommand({ command: 'echo boom >&2; exit 3', env: process.env, input: '' })
  assert.deepEqual([failed.code, failed.stderr], [3, 'boom\n'])
  const missing = await runDriftCommand({ command: 'true', cwd: join(s.home, 'nope'), env: process.env, input: '' })
  assert.match(missing.error, /ENOENT/)
})

test('no command configured: checkDrift runs nothing and says not_configured', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const r = await tools.board_read({ checkDrift: true }, exec())
  assert.equal(r.ok, true)
  assert.equal(r.driftCheck, 'not_configured')
  assert.equal(r.drift, undefined)
  assert.equal((await tools.board_read({}, exec())).driftCheck, undefined)
})

test('the command runs only on checkDrift: true', async () => {
  const d = await withCommand(`import { writeFileSync } from 'node:fs'
writeFileSync(process.env.DSH_COCKPIT_FILE + '.ran', '')
console.log('{"items":[]}')`)
  const r = await d.tools.board_read({}, exec())
  assert.equal(r.driftCheck, undefined)
  assert.equal(r.drift, undefined)
  await assert.rejects(readFile(d.store.file('k') + '.ran'), { code: 'ENOENT' })
  await d.tools.board_read({ checkDrift: true }, exec())
  await readFile(d.store.file('k') + '.ran')
})

test('report: only the differences are kept, with checked; no task changes and revision stays', async () => {
  const d = await withCommand(REPORT)
  const before = await fileOf(d)
  const r = await d.tools.board_read({ checkDrift: true }, exec())
  assert.equal(r.driftCheck, 'ran')
  assert.deepEqual(r.drift, { checkedAt: r.drift.checkedAt, checked: 2, items: [{ item: '2a', status: 'done', note: '#902 merged' }] })
  assert.deepEqual(r.tasks, before.tasks)
  assert.equal(r.board.revision, before.revision)
  const after = await fileOf(d)
  assert.deepEqual(after.drift, r.drift, 'the file holds the result')
  assert.deepEqual([after.revision, after.updatedAt, after.tasks], [before.revision, before.updatedAt, before.tasks])
})

test('apply: each differing task gets the reported status, and revision bumps', async () => {
  const d = await withCommand(REPORT, { mode: 'apply' })
  const before = await fileOf(d)
  const r = await d.tools.board_read({ checkDrift: true }, exec())
  assert.equal(r.tasks.find((x) => x.item === '2a').status, 'done')
  assert.deepEqual(r.tasks.find((x) => x.item === '1'), before.tasks[0], 'a matching task is untouched')
  assert.equal(r.board.revision, before.revision + 1)
  const after = await fileOf(d)
  assert.equal(after.revision, before.revision + 1)
  assert.equal(after.tasks.find((x) => x.item === '2a').status, 'done')
  assert.deepEqual(after.drift.items, [{ item: '2a', status: 'done', note: '#902 merged' }])
  // Nothing differs any more: the next check keeps revision.
  const again = await d.tools.board_read({ checkDrift: true }, exec())
  assert.deepEqual([again.board.revision, again.drift.items], [after.revision, []])
})

test('the command gets the board on stdin, DSH_HOME, DSH_COCKPIT_KEY, DSH_COCKPIT_FILE, and runs in drift.cwd', async () => {
  const s = await setup()
  const script = `let s = ''
process.stdin.on('data', (d) => { s += d }).on('end', () => {
  const b = JSON.parse(s)
  const note = JSON.stringify([b.key, b.tasks.length, process.env.DSH_HOME, process.env.DSH_COCKPIT_KEY, process.env.DSH_COCKPIT_FILE, process.cwd()])
  process.stdout.write(JSON.stringify({ items: [{ item: '2a', status: 'now', note }] }))
})`
  const d = await withCommand(script, { cwd: s.home })
  const r = await d.tools.board_read({ checkDrift: true }, exec())
  assert.deepEqual(JSON.parse(r.drift.items[0].note), ['k', 2, d.home, 'k', d.store.file('k'), s.home])
})

test('a failed run gives driftCheck failed, drift.error, the tasks unchanged and revision kept', async () => {
  for (const script of ['console.error("boom"); process.exit(3)', 'console.log("not json")']) {
    const d = await withCommand(script, { mode: 'apply' })
    const before = await fileOf(d)
    const r = await d.tools.board_read({ checkDrift: true }, exec())
    assert.equal(r.ok, true)
    assert.equal(r.driftCheck, 'failed')
    assert.equal(typeof r.drift.error, 'string')
    assert.deepEqual(r.tasks, before.tasks)
    const after = await fileOf(d)
    assert.deepEqual([after.revision, after.drift.error], [before.revision, r.drift.error])
  }
})

test('filters narrow the result after the check; the stored drift is the whole board\'s', async () => {
  const d = await withCommand(REPORT)
  const r = await d.tools.board_read({ checkDrift: true, status: ['done'] }, exec())
  assert.deepEqual(r.tasks.map((x) => x.item), ['1'])
  assert.equal(r.drift.items[0].item, '2a')
})

test('an aborted call stops the command and the process it started', async () => {
  const d = await withCommand(`import { spawn } from 'node:child_process'
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
const { writeFileSync } = await import('node:fs')
writeFileSync(process.env.DSH_COCKPIT_FILE + '.pid', String(child.pid))
setTimeout(() => {}, 60000)`)
  const ac = new AbortController()
  const pidFile = d.store.file('k') + '.pid'
  const call = d.tools.board_read({ checkDrift: true }, { agent: { session: { id: 'sess-1' } }, signal: ac.signal })
  let pid
  for (let i = 0; i < 200 && !pid; i++) {
    await new Promise((r) => setTimeout(r, 25))
    pid = Number(await readFile(pidFile, 'utf8').catch(() => '')) || undefined
  }
  assert.ok(pid, 'the command started its child')
  ac.abort()
  await assert.rejects(call, { name: 'AbortError' })
  let alive = true
  for (let i = 0; i < 200 && alive; i++) {
    try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 25)) } catch { alive = false }
  }
  assert.equal(alive, false, 'the grandchild is stopped')
  assert.equal((await fileOf(d)).drift, undefined, 'nothing is stored')
})
