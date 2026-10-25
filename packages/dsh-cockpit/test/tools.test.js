import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { exec, setup } from './helpers.mjs'

const fileOf = async (store, key) => JSON.parse(await readFile(store.file(key), 'utf8'))

test('open creates, then reads the same board; parent sets or replaces it', async () => {
  const { tools, store } = await setup()
  const a = await tools.board_open({ key: 'sim-883', parent: 'o/r#883' }, exec())
  assert.equal(a.ok, true)
  assert.equal(a.created, true)
  assert.deepEqual(a.tasks, [])
  assert.deepEqual(a.board, { key: 'sim-883', parent: 'o/r#883', revision: 1, updatedAt: a.board.updatedAt })
  const file = await fileOf(store, 'sim-883')
  assert.deepEqual([file.format, file.version, file.parent, file.updatedBy], ['dsh-cockpit.board', 1, 'o/r#883', 'sess-1'])
  const b = await tools.board_open({ key: 'sim-883' }, exec())
  assert.deepEqual([b.created, b.board.revision, b.board.parent], [false, 1, 'o/r#883'])
  const c = await tools.board_open({ key: 'sim-883', parent: 'o/r#900' }, exec())
  assert.deepEqual([c.board.revision, c.board.parent], [2, 'o/r#900'])
})

test('open and read return the board file path and its format version (A1)', async () => {
  const { tools, store } = await setup()
  const file = { path: store.file('sim-883'), format: 'dsh-cockpit.board', version: 1 }
  assert.deepEqual((await tools.board_open({ key: 'sim-883' }, exec())).file, file)
  assert.deepEqual((await tools.board_read({}, exec())).file, file)
  assert.deepEqual((await tools.board_read({ status: ['done'] }, exec())).file, file)
  assert.equal((await tools.board_add({ what: 'x' }, exec())).file, undefined)
})

test('not_bound before board_open; invalid_input for an empty key, item or list, or a non-string extra', async () => {
  const { tools } = await setup()
  assert.equal((await tools.board_read({}, exec())).code, 'not_bound')
  assert.equal((await tools.board_add({ what: 'x' }, exec())).code, 'not_bound')
  assert.equal((await tools.board_update({ item: '1', set: {} }, exec())).code, 'not_bound')
  assert.equal((await tools.board_open({ key: '' }, exec())).code, 'invalid_input')
  await tools.board_open({ key: 'k' }, exec())
  assert.equal((await tools.board_add({ item: '', what: 'x' }, exec())).code, 'invalid_input')
  assert.equal((await tools.board_update({ item: [], set: { status: 'now' } }, exec())).code, 'invalid_input')
  assert.equal((await tools.board_add({ what: 'x', extra: { n: 1 } }, exec())).code, 'invalid_input')
})

test('defaults, next integer item, item_exists, item_unknown', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const a = await tools.board_add({ what: 'first' }, exec())
  assert.deepEqual([a.task.item, a.task.status, a.revision], ['1', 'next', 2])
  await tools.board_add({ item: '3a', what: 'named' }, exec())
  assert.equal((await tools.board_add({ what: 'third' }, exec())).task.item, '2')
  assert.equal((await tools.board_add({ item: '1', what: 'dup' }, exec())).code, 'item_exists')
  assert.equal((await tools.board_update({ item: '99', set: { status: 'now' } }, exec())).code, 'item_unknown')
})

test('every field round-trips through add, in file order; startWhen and dropped are stored', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const fields = {
    what: 'x', status: 'waiting', why: 'w', issue: '#1', pr: '#2', branch: 'b', worktree: '/w', provider: 'p', model: 'm', effort: 'high',
    nextAction: 'n', waitingOn: 'owner', readyCommand: 'gh pr merge 2', startWhen: 'after #3 merges', parent: 'root', dependsOn: ['3'], extra: { a: 'b' },
  }
  const a = await tools.board_add({ item: '5', ...fields }, exec())
  assert.deepEqual(Object.keys(a.task), ['item', ...Object.keys(fields), 'updatedAt'])
  const u = await tools.board_update({ item: '5', set: { status: 'dropped', startWhen: null } }, exec())
  assert.deepEqual([u.tasks[0].status, u.tasks[0].startWhen], ['dropped', undefined])
})

test('null clears a field; an empty set changes nothing and writes nothing', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ what: 'x', pr: '#1', extra: { a: 'b' }, readyCommand: 'gh pr merge 1' }, exec())
  const u = await tools.board_update({ item: '1', set: { pr: null, status: 'waiting', waitingOn: 'CI' } }, exec())
  assert.equal(u.tasks[0].pr, undefined)
  assert.deepEqual(u.tasks[0].extra, { a: 'b' })
  assert.equal(u.tasks[0].waitingOn, 'CI')
  assert.equal(u.previous[0].pr, '#1')
  const before = await readFile(store.file('k'), 'utf8')
  const same = await tools.board_update({ item: '1', set: {} }, exec())
  assert.deepEqual(same.tasks, same.previous)
  assert.equal(same.revision, u.revision)
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})

test('board_update with a list of items: one write, the same set on each (A3)', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ item: 'root', what: 'parent' }, exec())
  for (const i of ['1', '2', '3', '4', '5']) await tools.board_add({ item: i, what: 'step ' + i }, exec())
  const before = await fileOf(store, 'k')
  const u = await tools.board_update({ item: ['1', '2', '3', '4', '5'], set: { parent: 'root' } }, exec())
  assert.equal(u.ok, true)
  assert.equal(u.revision, before.revision + 1, 'one write, one revision')
  assert.deepEqual(u.tasks.map((t) => [t.item, t.parent]), [['1', 'root'], ['2', 'root'], ['3', 'root'], ['4', 'root'], ['5', 'root']])
  assert.deepEqual(u.previous.map((t) => t.parent), [undefined, undefined, undefined, undefined, undefined])
  const after = await fileOf(store, 'k')
  assert.equal(after.revision, before.revision + 1)
  assert.deepEqual(after.tasks.map((t) => t.item), ['root', '1', '2', '3', '4', '5'], 'board order is kept')
  assert.ok(after.tasks.slice(1).every((t) => t.parent === 'root'))
})

test('board_update: one unknown item refuses the whole call, and the file is unchanged', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ what: 'a' }, exec())
  await tools.board_add({ what: 'b' }, exec())
  const before = await readFile(store.file('k'), 'utf8')
  const r = await tools.board_update({ item: ['1', 'nope', '2'], set: { status: 'done' } }, exec())
  assert.equal(r.ok, false)
  assert.equal(r.code, 'item_unknown')
  assert.match(r.message, /"nope"/)
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
  const gone = await tools.board_update({ item: ['1', 'nope'], remove: true }, exec())
  assert.equal(gone.code, 'item_unknown')
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})

test('previous: an update returns each task as it was before', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const a = (await tools.board_add({ what: 'a', status: 'now', model: 'm1' }, exec())).task
  const b = (await tools.board_add({ what: 'b', status: 'next' }, exec())).task
  const u = await tools.board_update({ item: ['2', '1'], set: { status: 'waiting', model: 'm2' } }, exec())
  assert.deepEqual(u.previous, [b, a], 'in the order the call named them')
  assert.deepEqual(u.tasks.map((t) => [t.item, t.status, t.model]), [['2', 'waiting', 'm2'], ['1', 'waiting', 'm2']])
})

test('a removal returns the removed tasks in previous; board_add from previous restores them (D5)', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ what: 'keep' }, exec())
  await tools.board_add({ item: '7', what: 'gone', status: 'waiting', waitingOn: 'owner', readyCommand: 'gh pr merge 7', dependsOn: ['1'], extra: { a: 'b' } }, exec())
  const before = (await tools.board_read({}, exec())).tasks.find((t) => t.item === '7')
  const r = await tools.board_update({ item: '7', remove: true }, exec())
  assert.equal(r.ok, true)
  assert.deepEqual(r.tasks, [])
  assert.deepEqual(r.previous, [before])
  assert.deepEqual((await tools.board_read({}, exec())).tasks.map((t) => t.item), ['1'])
  const re = await tools.board_add(r.previous[0], exec())
  assert.deepEqual({ ...re.task, updatedAt: before.updatedAt }, before, 'the re-added task deep-equals the removed one, but for updatedAt')
  assert.notEqual(re.task.updatedAt, before.updatedAt)
})

test('board_add refuses an unknown field, such as a misspelt one; updatedAt is accepted and replaced', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const before = await readFile(store.file('k'), 'utf8')
  const r = await tools.board_add({ what: 'x', waiting_on: 'owner', notes: { a: 1 } }, exec())
  assert.equal(r.code, 'invalid_input')
  assert.match(r.message, /Unknown field "waiting_on", "notes"; the fields are item, what, status, .*waitingOn.*Use extra/)
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
  const a = await tools.board_add({ what: 'x', updatedAt: '2000-01-01T00:00:00Z' }, exec())
  assert.notEqual(a.task.updatedAt, '2000-01-01T00:00:00Z')
})

test('board_update refuses set together with remove, and changes nothing', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ what: 'x' }, exec())
  const before = await readFile(store.file('k'), 'utf8')
  const r = await tools.board_update({ item: '1', set: { status: 'done' }, remove: true }, exec())
  assert.deepEqual([r.ok, r.code], [false, 'invalid_input'])
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})

test('a fallback board without revision, updatedAt or parent opens and reads; the result has no undefined values', async () => {
  const { tools, store } = await setup()
  await mkdir(dirname(store.file('f')), { recursive: true })
  await writeFile(store.file('f'), JSON.stringify({ format: 'dsh-cockpit.board', version: 1, key: 'f', tasks: [] }))
  const opened = await tools.board_open({ key: 'f' }, exec())
  assert.deepEqual(opened.board, { key: 'f' })
  const read = await tools.board_read({}, exec())
  assert.deepEqual(read.board, { key: 'f' })
  assert.deepEqual(JSON.parse(JSON.stringify(read)), read, 'lossless JSON')
})

test('a board file that cannot be read is board_unreadable, not write_failed', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  // A directory in the board file's place: reading it fails with EISDIR.
  await rm(store.file('k'))
  await mkdir(store.file('k'))
  for (const call of [() => tools.board_read({}, exec()), () => tools.board_add({ what: 'x' }, exec()), () => tools.board_open({ key: 'k' }, exec())]) {
    const r = await call()
    assert.deepEqual([r.ok, r.code], [false, 'board_unreadable'])
    assert.match(r.message, /cannot be read: EISDIR/)
  }
})

test('board_open writes the binding before the board: a failed binding leaves no board behind', async (ctx) => {
  if (process.getuid?.() === 0) return ctx.skip('root ignores permissions')
  const { tools, store, dataDir } = await setup()
  await mkdir(join(dataDir, 'sessions'), { recursive: true })
  await chmod(join(dataDir, 'sessions'), 0o500)
  try {
    const r = await tools.board_open({ key: 'k', parent: 'o/r#1' }, exec())
    assert.deepEqual([r.ok, r.code], [false, 'write_failed'])
  } finally {
    await chmod(join(dataDir, 'sessions'), 0o700)
  }
  assert.equal(await store.read('k'), undefined, 'no board was created')
  assert.equal((await tools.board_add({ what: 'x' }, exec())).code, 'not_bound')
})

test('flags come back from add and update, never a refusal', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const r = await tools.board_add({ what: 'x', parent: 'nope', dependsOn: ['9'] }, exec())
  assert.equal(r.ok, true)
  assert.deepEqual(r.flags.map((f) => f.code), ['unknown_parent', 'unknown_dependency'])
  const u = await tools.board_update({ item: '1', set: { parent: null } }, exec())
  assert.deepEqual(u.flags.map((f) => f.code), ['unknown_dependency'])
})

test('read filters by status and by subtree; an unknown item is item_unknown', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ item: 'root', what: 'r' }, exec())
  await tools.board_add({ item: 'a', what: 'a', parent: 'root', status: 'waiting' }, exec())
  await tools.board_add({ item: 'b', what: 'b', status: 'waiting' }, exec())
  const w = await tools.board_read({ status: ['waiting'] }, exec())
  assert.deepEqual(w.tasks.map((t) => t.item), ['a', 'b'])
  const s = await tools.board_read({ item: 'root' }, exec())
  assert.deepEqual(s.tasks.map((t) => t.item), ['root', 'a'])
  assert.equal((await tools.board_read({ item: 'zz' }, exec())).code, 'item_unknown')
})

test('the session binding: each session has its own board; a resumed session finds its board in sessions/<id>.json', async () => {
  const first = await setup()
  await first.tools.board_open({ key: 'one' }, exec('s1'))
  await first.tools.board_open({ key: 'two' }, exec('s2'))
  await first.tools.board_add({ what: 'in one' }, exec('s1'))
  assert.deepEqual((await first.tools.board_read({}, exec('s2'))).tasks, [])
  assert.deepEqual(JSON.parse(await readFile(join(first.dataDir, 'sessions', 's1.json'), 'utf8')), { version: 1, key: 'one' })
  const second = await setup({ home: first.home })
  const after = await second.tools.board_read({}, exec('s1'))
  assert.equal(after.board.key, 'one')
  assert.deepEqual(after.tasks.map((t) => t.what), ['in one'])
  assert.equal((await second.tools.board_read({}, exec('other'))).code, 'not_bound')
})

test('a board file removed under a bound session is board_unreadable, not a new board', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await rm(store.file('k'))
  assert.equal((await tools.board_read({}, exec())).code, 'board_unreadable')
  assert.equal((await tools.board_add({ what: 'x' }, exec())).code, 'board_unreadable')
})

test('a damaged board file is board_unreadable from every tool and left as it was', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await writeFile(store.file('k'), '{broken')
  const calls = [
    () => tools.board_open({ key: 'k' }, exec()),
    () => tools.board_read({}, exec()),
    () => tools.board_add({ what: 'x' }, exec()),
    () => tools.board_update({ item: '1', remove: true }, exec()),
  ]
  for (const call of calls) assert.equal((await call()).code, 'board_unreadable')
  assert.equal(await readFile(store.file('k'), 'utf8'), '{broken')
})

test('an aborted signal before the write leaves the file unchanged', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const before = await readFile(store.file('k'), 'utf8')
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(tools.board_add({ what: 'x' }, { agent: { session: { id: 'sess-1' } }, signal: ac.signal }))
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})

test('concurrent adds from the hub and its builders all land', async () => {
  const { tools, store } = await setup()
  const sessions = ['hub', 'b1', 'b2', 'b3']
  // Builders run in the hub's process and open the hub's board themselves.
  await Promise.all(sessions.map((s) => tools.board_open({ key: 'k' }, exec(s))))
  await Promise.all(Array.from({ length: 12 }, (_, i) => tools.board_add({ what: 'w' + i }, exec(sessions[i % 4]))))
  const file = await fileOf(store, 'k')
  assert.equal(file.tasks.length, 12)
  assert.deepEqual(file.tasks.map((t) => Number(t.item)).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 1))
})
