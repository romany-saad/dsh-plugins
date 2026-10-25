import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setup } from './helpers.mjs'

test('open creates, then reads the same board', async () => {
  const { tools, store, exec } = await setup()
  const a = await tools.board_open({ key: 'sim-883', parent: 'o/r#883' }, exec())
  assert.equal(a.ok, true)
  assert.equal(a.created, true)
  assert.deepEqual(a.tasks, [])
  const file = JSON.parse(await readFile(store.file('sim-883'), 'utf8'))
  assert.equal(file.version, 1)
  assert.equal(file.parent, 'o/r#883')
  const b = await tools.board_open({ key: 'sim-883' }, exec())
  assert.equal(b.created, false)
  assert.equal(b.board.revision, 1)
})

test('not_bound before board_open', async () => {
  const { tools, exec } = await setup()
  assert.equal((await tools.board_read({}, exec())).code, 'not_bound')
  assert.equal((await tools.board_add({ what: 'x' }, exec())).code, 'not_bound')
})

test('defaults, next integer item, item_exists, item_unknown', async () => {
  const { tools, exec } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const a = await tools.board_add({ what: 'first' }, exec())
  assert.equal(a.task.item, '1')
  assert.equal(a.task.status, 'next')
  await tools.board_add({ item: '3a', what: 'named' }, exec())
  assert.equal((await tools.board_add({ what: 'third' }, exec())).task.item, '2')
  assert.equal((await tools.board_add({ item: '1', what: 'dup' }, exec())).code, 'item_exists')
  assert.equal((await tools.board_update({ item: '99', set: { status: 'now' } }, exec())).code, 'item_unknown')
})

test('null clears, extra and readyCommand round-trip, remove returns null', async () => {
  const { tools, exec } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ what: 'x', pr: '#1', extra: { a: 'b' }, readyCommand: 'gh pr merge 1' }, exec())
  const u = await tools.board_update({ item: '1', set: { pr: null, status: 'waiting' } }, exec())
  assert.equal(u.task.pr, undefined)
  assert.deepEqual(u.task.extra, { a: 'b' })
  assert.equal(u.task.readyCommand, 'gh pr merge 1')
  const r = await tools.board_update({ item: '1', remove: true }, exec())
  assert.equal(r.task, null)
  assert.deepEqual((await tools.board_read({}, exec())).tasks, [])
})

test('flags come back from add, never a refusal', async () => {
  const { tools, exec } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const r = await tools.board_add({ what: 'x', parent: 'nope', dependsOn: ['9'] }, exec())
  assert.equal(r.ok, true)
  assert.deepEqual(r.flags.map((f) => f.code), ['unknown_parent', 'unknown_dependency'])
})

test('read filters by status and by subtree', async () => {
  const { tools, exec } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ item: 'root', what: 'r' }, exec())
  await tools.board_add({ item: 'a', what: 'a', parent: 'root', status: 'waiting' }, exec())
  await tools.board_add({ item: 'b', what: 'b', status: 'waiting' }, exec())
  const w = await tools.board_read({ status: ['waiting'] }, exec())
  assert.deepEqual(w.tasks.map((t) => t.item), ['a', 'b'])
  const s = await tools.board_read({ item: 'root' }, exec())
  assert.deepEqual(s.tasks.map((t) => t.item), ['root', 'a'])
})

test('a resumed session finds its binding; a fresh plugin rebuilds the same board', async () => {
  const first = await setup()
  await first.tools.board_open({ key: 'k' }, first.exec('s1'))
  await first.tools.board_add({ what: 'x', parent: '9' }, first.exec('s1'))
  const before = await first.tools.board_read({}, first.exec('s1'))
  const second = await setup({}, { home: first.home })
  const after = await second.tools.board_read({}, second.exec('s1'))
  assert.equal(after.ok, true)
  assert.deepEqual(after.tasks, before.tasks)
  assert.equal(after.tree, before.tree)
  assert.equal((await second.tools.board_read({}, second.exec('other'))).code, 'not_bound')
})

test('an aborted signal before the write leaves the file unchanged', async () => {
  const { tools, store, exec } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const before = await readFile(store.file('k'), 'utf8')
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(tools.board_add({ what: 'x' }, { agent: { session: { id: 'sess-1' } }, signal: ac.signal }))
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})
