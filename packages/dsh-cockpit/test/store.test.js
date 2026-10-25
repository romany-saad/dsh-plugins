import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BoardError, boardFile, changesRecord, parseBoard, writeJsonAtomic } from '../lib/store.js'
import { newBoard, setup, t } from './helpers.mjs'

const create = (store, key, more) => store.change(key, (current) => (current ? { board: current, write: false } : { board: newBoard(key, store.now(), more), write: true }), { by: 'sess-1' })
const addTask = (store, key, task) => store.change(key, (current) => ({ board: { ...current, tasks: [...current.tasks, task] }, write: true }), { by: 'sess-1' })

test('keys stay inside boards/', async () => {
  const { dataDir } = await setup()
  for (const key of ['../x', 'a/b', 'CON', '..']) {
    const file = boardFile(dataDir, key)
    assert.equal(dirname(file), join(dataDir, 'boards'), key)
  }
})

test('a new board is revision 1; each change to tasks or parent bumps it, with updatedAt and updatedBy', async () => {
  const { store } = await setup()
  const a = await create(store, 'k', { parent: 'p' })
  assert.equal(a.board.revision, 1)
  assert.equal(a.board.updatedBy, 'sess-1')
  const b = await addTask(store, 'k', t('1', 'next', 'x'))
  assert.equal(b.board.revision, 2)
  assert.notEqual(b.board.updatedAt, a.board.updatedAt)
  const c = await store.change('k', (current) => ({ board: { ...current, parent: 'q' }, write: true }), { by: 'sess-2' })
  assert.deepEqual([c.board.revision, c.board.updatedBy], [3, 'sess-2'])
  const file = JSON.parse(await readFile(store.file('k'), 'utf8'))
  assert.deepEqual([file.revision, file.parent, file.tasks.length], [3, 'q', 1])
})

test('a write that changes no task and not the parent (a report-only drift result) keeps revision, updatedAt and updatedBy', async () => {
  const { store } = await setup()
  await create(store, 'k')
  const before = (await addTask(store, 'k', t('1', 'waiting', 'x'))).board
  const drift = { checkedAt: '2026-10-25T08:00:00.000Z', checked: 1, items: [{ item: '1', status: 'done' }] }
  const r = await store.change('k', (current) => ({ board: { ...current, drift }, write: true }), { by: 'other' })
  assert.deepEqual([r.board.revision, r.board.updatedAt, r.board.updatedBy], [before.revision, before.updatedAt, before.updatedBy])
  const file = JSON.parse(await readFile(store.file('k'), 'utf8'))
  assert.deepEqual(file.drift, drift, 'the drift result is stored')
  assert.equal(file.revision, before.revision)
})

test('changesRecord: a new board, tasks or parent', () => {
  const b = { parent: 'p', tasks: [t('1', 'next', 'x')], drift: {} }
  assert.equal(changesRecord(undefined, b), true)
  assert.equal(changesRecord(b, { ...b, drift: { checkedAt: 'x' } }), false)
  assert.equal(changesRecord(b, { ...b, tasks: [t('1', 'done', 'x')] }), true)
  assert.equal(changesRecord(b, { ...b, parent: undefined }), true)
})

test('write: false changes nothing on disk', async () => {
  const { store } = await setup()
  await create(store, 'k')
  const before = await readFile(store.file('k'), 'utf8')
  await create(store, 'k')
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})

test('changes to one key run one at a time', async () => {
  const { store } = await setup()
  await create(store, 'k')
  await Promise.all(Array.from({ length: 10 }, (_, i) => addTask(store, 'k', t(String(i), 'next', 'x'))))
  const file = JSON.parse(await readFile(store.file('k'), 'utf8'))
  assert.equal(file.tasks.length, 10)
  assert.equal(file.revision, 11)
})

test('an aborted signal before the write leaves the file unchanged', async () => {
  const { store } = await setup()
  await create(store, 'k')
  const before = await readFile(store.file('k'), 'utf8')
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(store.change('k', (c) => ({ board: { ...c, tasks: [t('1', 'next', 'x')] }, write: true }), { signal: ac.signal }))
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})

test('unparseable, foreign or unknown-version file: board_unreadable, bytes unchanged', async () => {
  const { store } = await setup()
  const cases = [
    ['bad', '{not json'],
    ['foreign', JSON.stringify({ format: 'other', version: 1, tasks: [] })],
    ['newer', JSON.stringify({ format: 'dsh-cockpit.board', version: 2, tasks: [] })],
    ['notasks', JSON.stringify({ format: 'dsh-cockpit.board', version: 1, tasks: {} })],
  ]
  for (const [key, text] of cases) {
    await mkdir(dirname(store.file(key)), { recursive: true })
    await writeFile(store.file(key), text)
    await assert.rejects(addTask(store, key, t('1', 'next', 'x')), (e) => e instanceof BoardError && e.code === 'board_unreadable', key)
    assert.equal(await readFile(store.file(key), 'utf8'), text)
  }
  assert.throws(() => parseBoard('null'), /not a dsh-cockpit.board file/)
})

test('a leftover temp file is removed on the next write; the old file survives a crash', async () => {
  const { dataDir } = await setup()
  const file = join(dataDir, 'boards', 'k.json')
  await writeJsonAtomic(file, { a: 1 })
  // Simulate a crash after the temp write, before the rename.
  await writeFile(join(dataDir, 'boards', '.k.json.999.dead.tmp'), '{"a":2')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { a: 1 })
  await writeJsonAtomic(file, { a: 3 })
  assert.deepEqual(await readdir(join(dataDir, 'boards')), ['k.json'])
})

test('a filesystem error rejects with its code and leaves the old file', async (ctx) => {
  if (process.getuid?.() === 0) return ctx.skip('root ignores permissions')
  const { store } = await setup()
  await create(store, 'k')
  const before = await readFile(store.file('k'), 'utf8')
  await chmod(dirname(store.file('k')), 0o500)
  try {
    await assert.rejects(addTask(store, 'k', t('1', 'next', 'x')), (e) => /^E[A-Z]+$/.test(e.code))
  } finally {
    await chmod(dirname(store.file('k')), 0o700)
  }
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})

test('session bindings round-trip; a missing or bad one is undefined', async () => {
  const { store } = await setup()
  assert.equal(await store.readBinding('s1'), undefined)
  await store.writeBinding('s1', 'a/b')
  assert.equal(await store.readBinding('s1'), 'a/b')
  await writeJsonAtomic(join(store.dataDir, 'sessions', 's2.json'), { version: 2, key: 'x' })
  assert.equal(await store.readBinding('s2'), undefined)
})
