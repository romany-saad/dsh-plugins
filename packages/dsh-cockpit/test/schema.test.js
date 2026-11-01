import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { driftResult } from '../lib/drift.js'
import { FORMAT, VERSION } from '../lib/store.js'
import { STATUSES, TASK_FIELDS } from '../lib/task.js'
import { check } from './schema-check.mjs'
import { INBOX_FIELDS, INBOX_STATES } from '../lib/inbox.js'
import { exec, newBoard, setup, t } from './helpers.mjs'

const schema = JSON.parse(await readFile(new URL('../board.schema.json', import.meta.url), 'utf8'))
const fixtures = new URL('./fixtures/', import.meta.url)

test('every fixture board validates against board.schema.json', async () => {
  const names = (await readdir(fixtures)).filter((n) => n.endsWith('.json'))
  assert.ok(names.length >= 4)
  for (const name of names) {
    const board = JSON.parse(await readFile(new URL(name, fixtures), 'utf8'))
    assert.deepEqual(check(schema, board), [], name)
  }
})

test('a board the store writes, with a drift result, validates', async () => {
  const { store } = await setup()
  await store.change('k', () => ({ board: newBoard('k', store.now(), { parent: 'p' }), write: true }), { by: 's' })
  const { board } = await store.change('k', (c) => {
    const tasks = [t('1', 'waiting', 'x', { startWhen: 'later', updatedAt: store.now() }), t('2', 'dropped', 'y', { updatedAt: store.now() })]
    const { drift } = driftResult({ tasks }, { code: 0, stdout: JSON.stringify({ items: [{ item: '1', status: 'done', note: 'n' }] }), stderr: '' }, { now: store.now })
    return { board: { ...c, tasks, drift }, write: true }
  })
  assert.deepEqual(check(schema, board), [])
})

test('the schema agrees with the model: format, version, statuses, task fields, inbox fields and states', () => {
  assert.equal(schema.properties.format.const, FORMAT)
  assert.equal(schema.properties.version.const, VERSION)
  assert.deepEqual(schema.$defs.status.enum, STATUSES)
  assert.deepEqual(Object.keys(schema.$defs.task.properties), TASK_FIELDS)
  assert.deepEqual(Object.keys(schema.$defs.inboxItem.properties), INBOX_FIELDS)
  assert.deepEqual(schema.$defs.inboxItem.properties.state.enum, INBOX_STATES)
})

test('a board the inbox tools write validates', async () => {
  const { tools, store } = await setup()
  const { opened } = await tools.board_inbox({ action: 'add', text: 'a', note: 'n' }, exec())
  await tools.board_inbox({ action: 'add', text: 'b', source: 'panel' }, exec())
  await tools.board_add({ what: 't', refines: ['i1'], refinedWith: 'grill-me' }, exec())
  await tools.board_inbox({ action: 'drop', id: 'i2' }, exec())
  await tools.board_inbox({ action: 'clear', id: 'i2' }, exec())
  const board = await store.read(opened.key)
  assert.equal(board.inbox.length, 2)
  assert.deepEqual(check(schema, board), [])
  assert.notDeepEqual(check(schema, { ...board, inbox: [{ id: 'x', text: 'a', state: 'open' }] }), [], 'an id is i and a number')
  assert.notDeepEqual(check(schema, { ...board, inbox: [{ id: 'i1', text: 'a', state: 'later' }] }), [])
})

test('the schema refuses what the store refuses, and a bad status', () => {
  const ok = { format: FORMAT, version: 1, key: 'k', tasks: [] }
  assert.deepEqual(check(schema, ok), [])
  assert.notDeepEqual(check(schema, { ...ok, version: 2 }), [])
  assert.notDeepEqual(check(schema, { ...ok, format: 'x' }), [])
  assert.notDeepEqual(check(schema, { ...ok, tasks: {} }), [])
  assert.notDeepEqual(check(schema, { ...ok, tasks: [t('1', 'blocked', 'x')] }), [])
  assert.notDeepEqual(check(schema, { ...ok, tasks: [t('', 'next', 'x')] }), [])
  assert.notDeepEqual(check(schema, { ...ok, tasks: [{ item: '1', status: 'next' }] }), [])
})
