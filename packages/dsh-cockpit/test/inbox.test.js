// The Inbox (#51): board_inbox, refines on board_add and board_update, and
// what board_read and the tree text show.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { defaultBoardKey, inboxCount, inboxText, nextInboxId } from '../lib/inbox.js'
import { exec, setup } from './helpers.mjs'

const fileOf = async (store, key) => JSON.parse(await readFile(store.file(key), 'utf8'))

test('the first item opens a board for the session, named after it, and binds it', async () => {
  const { tools, store } = await setup()
  const e = exec('session-7fceced5-68fb-4e8b')
  const r = await tools.board_inbox({ action: 'add', text: '  dark mode for the strip  ' }, e)
  assert.equal(r.ok, true)
  assert.deepEqual(r.opened, { key: 'session-7fceced5', created: true })
  assert.deepEqual(r.items.map((i) => [i.id, i.text, i.state, i.source]), [['i1', 'dark mode for the strip', 'open', 'chat']])
  assert.equal((await tools.board_read({}, e)).board.key, 'session-7fceced5', 'the session is bound to it')
  const second = await tools.board_inbox({ action: 'add', text: 'export as markdown', source: 'panel', note: 'from standup' }, e)
  assert.equal(second.opened, undefined, 'only the first opens a board')
  assert.deepEqual([second.items[0].id, second.items[0].source, second.items[0].note], ['i2', 'panel', 'from standup'])
  const file = await fileOf(store, 'session-7fceced5')
  assert.deepEqual(file.tasks, [], 'items are not tasks')
  assert.deepEqual(file.inbox.map((i) => i.id), ['i1', 'i2'])
})

test('with a bound board, add uses it; other actions need a board', async () => {
  const { tools } = await setup()
  assert.equal((await tools.board_inbox({ action: 'drop', id: 'i1' }, exec())).code, 'not_bound')
  await tools.board_open({ key: 'k' }, exec())
  const r = await tools.board_inbox({ action: 'add', text: 'x' }, exec())
  assert.equal(r.board.key, 'k')
  assert.equal(r.opened, undefined)
})

test('an inbox change bumps the revision; a change that changes nothing does not', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const a = await tools.board_inbox({ action: 'add', text: 'x' }, exec())
  await tools.board_inbox({ action: 'drop', id: 'i1' }, exec())
  const c = await tools.board_inbox({ action: 'clear', id: 'i1' }, exec())
  assert.equal(c.revision, a.revision + 2)
  const again = await tools.board_inbox({ action: 'clear', id: 'i1' }, exec())
  assert.equal(again.revision, c.revision)
})

test('update, drop, reopen, clear and delete; refusals change nothing', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  for (const text of ['a', 'b', 'c']) await tools.board_inbox({ action: 'add', text }, exec())
  const before = await fileOf(store, 'k')
  for (const args of [
    { action: 'frob' }, { action: 'add' }, { action: 'add', text: ' ' }, { action: 'add', text: 'x', id: 'i1' },
    { action: 'update', id: 'i1' }, { action: 'update', id: ['i1', 'i2'], text: 'x' }, { action: 'update', id: 'i1', text: '' },
    { action: 'drop' }, { action: 'clear', id: 'i1', text: 'x' }, { action: 'delete', id: 'i1', source: 'chat' }, { action: 'add', text: 'x', color: 'red' },
  ]) assert.equal((await tools.board_inbox(args, exec())).code, 'invalid_input', JSON.stringify(args))
  assert.equal((await tools.board_inbox({ action: 'drop', id: ['i1', 'i9'] }, exec())).code, 'item_unknown')
  assert.equal((await tools.board_inbox({ action: 'clear', id: 'i1' }, exec())).code, 'invalid_input', 'an open item is refined or dropped before it is cleared')
  assert.deepEqual(await fileOf(store, 'k'), before, 'nothing changed')

  const u = await tools.board_inbox({ action: 'update', id: 'i1', text: 'a, sharper', note: 'n' }, exec())
  assert.deepEqual([u.items[0].text, u.items[0].note, u.previous[0].text], ['a, sharper', 'n', 'a'])
  assert.equal((await tools.board_inbox({ action: 'update', id: 'i1', note: null }, exec())).items[0].note, undefined)
  const d = await tools.board_inbox({ action: 'drop', id: ['i1', 'i2'], note: 'not needed' }, exec())
  assert.deepEqual(d.items.map((i) => [i.state, i.note]), [['dropped', 'not needed'], ['dropped', 'not needed']])
  const c = await tools.board_inbox({ action: 'clear', id: 'i1' }, exec())
  assert.deepEqual(c.inbox.map((i) => i.id), ['i2', 'i3'], 'a cleared item leaves the shown inbox')
  assert.equal(typeof c.items[0].clearedAt, 'string')
  const o = await tools.board_inbox({ action: 'reopen', id: 'i1' }, exec())
  assert.deepEqual([o.items[0].state, o.items[0].clearedAt], ['open', undefined], 'reopen shows it again')
  const del = await tools.board_inbox({ action: 'delete', id: 'i3' }, exec())
  assert.deepEqual([del.items, del.previous.map((i) => i.text)], [[], ['c']])
  assert.equal((await tools.board_inbox({ action: 'add', text: 'd' }, exec())).items[0].id, 'i4', 'a deleted id is not given again')
})

test('refines on board_add marks the items refined and links them, in the same write', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_inbox({ action: 'add', text: 'dark strip' }, exec())
  await tools.board_inbox({ action: 'add', text: 'dark tab' }, exec())
  const a = await tools.board_add({ item: 'dark', what: 'Dark mode', refines: ['i1', 'i2'], refinedWith: 'grill-me' }, exec())
  assert.deepEqual(a.refined.map((i) => [i.id, i.state, i.refinedInto, i.refinedWith]), [['i1', 'refined', ['dark'], 'grill-me'], ['i2', 'refined', ['dark'], 'grill-me']])
  assert.equal(a.task.refines, undefined, 'refines is not stored on the task')
  const b = await tools.board_add({ what: 'Strip colours', parent: 'dark', refines: ['i1'] }, exec())
  assert.deepEqual(b.refined[0].refinedInto, ['dark', '1'], 'one item may become several tasks')
  const file = await fileOf(store, 'k')
  assert.equal(file.revision, b.revision)
  assert.deepEqual(file.inbox.map((i) => i.refinedInto), [['dark', '1'], ['dark']])
})

test('refines refuses an unknown or dropped item, and the task is not added', async () => {
  const { tools, store } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_inbox({ action: 'add', text: 'x' }, exec())
  await tools.board_inbox({ action: 'add', text: 'y' }, exec())
  await tools.board_inbox({ action: 'drop', id: 'i2' }, exec())
  const before = await fileOf(store, 'k')
  assert.equal((await tools.board_add({ what: 't', refines: ['i9'] }, exec())).code, 'unknown_reference')
  assert.equal((await tools.board_add({ what: 't', refines: ['i2'] }, exec())).code, 'invalid_input')
  assert.equal((await tools.board_add({ what: 't', refines: 'i1' }, exec())).code, 'invalid_input')
  assert.equal((await tools.board_add({ what: 't', refinedWith: 'x' }, exec())).code, 'invalid_input')
  assert.deepEqual(await fileOf(store, 'k'), before)
})

test('refines on board_update links items to existing tasks; linking again changes nothing', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  await tools.board_add({ what: 'a' }, exec())
  await tools.board_add({ what: 'b' }, exec())
  await tools.board_inbox({ action: 'add', text: 'x' }, exec())
  const u = await tools.board_update({ item: ['1', '2'], refines: ['i1'] }, exec())
  assert.deepEqual(u.refined[0].refinedInto, ['1', '2'])
  assert.deepEqual(u.tasks.map((t) => t.item), ['1', '2'], 'no set: the tasks as they are')
  const again = await tools.board_update({ item: '1', refines: ['i1'] }, exec())
  assert.equal(again.revision, u.revision)
  assert.equal(again.refined, undefined)
  const withSet = await tools.board_update({ item: '1', set: { status: 'now' }, refines: ['i1'], refinedWith: 'spec' }, exec())
  assert.equal(withSet.refined[0].refinedWith, 'spec')
  assert.equal((await tools.board_update({ item: '1', remove: true, refines: ['i1'] }, exec())).code, 'invalid_input')
})

test('board_read and board_open return the inbox; the tree text lists it after the tasks', async () => {
  const { tools } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  assert.equal((await tools.board_read({}, exec())).inbox, undefined, 'none without items')
  await tools.board_add({ what: 'task' }, exec())
  await tools.board_inbox({ action: 'add', text: 'later', note: 'n' }, exec())
  await tools.board_inbox({ action: 'add', text: 'gone' }, exec())
  await tools.board_inbox({ action: 'drop', id: 'i2' }, exec())
  await tools.board_inbox({ action: 'clear', id: 'i2' }, exec())
  const r = await tools.board_read({}, exec())
  assert.deepEqual(r.inbox.map((i) => i.id), ['i1'])
  assert.equal(r.tree, '1  next  task\n\nInbox (1 open):\n  i1  open     later   note: n')
  const all = await tools.board_read({ inbox: 'all' }, exec())
  assert.deepEqual(all.inbox.map((i) => i.id), ['i1', 'i2'])
  assert.match(all.tree, /i2 {2}dropped {2}gone {3}\(cleared\)/)
  assert.equal((await tools.board_read({ item: '1' }, exec())).inbox, undefined, 'a filtered read is about tasks')
  assert.deepEqual((await tools.board_open({ key: 'k' }, exec())).inbox.map((i) => i.id), ['i1'])
  assert.equal((await tools.board_read({ inbox: 'some' }, exec())).code, 'invalid_input')
})

test('pure helpers: ids, the default key, the count and the text', () => {
  assert.equal(nextInboxId([]), 'i1')
  assert.equal(nextInboxId([{ id: 'i2' }, { id: 'x' }]), 'i3')
  assert.equal(nextInboxId([{ id: 'i2' }], 7), 'i8')
  assert.equal(defaultBoardKey('session-7fceced5-68fb'), 'session-7fceced5')
  assert.equal(defaultBoardKey(''), 'inbox')
  assert.equal(inboxCount([{ id: 'i1', state: 'open' }, { id: 'i2', state: 'refined' }]), '1 in inbox')
  assert.equal(inboxCount([]), '')
  assert.equal(inboxText([]), '')
})
