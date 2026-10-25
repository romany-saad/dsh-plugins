import test from 'node:test'
import assert from 'node:assert/strict'
import { callTitle, presentation, resultTitle } from '../lib/present.js'
import { exec, setup } from './helpers.mjs'

test('call titles say what each call does', () => {
  assert.equal(callTitle('board_open', { key: 'sim-883' }), 'open sim-883')
  assert.equal(callTitle('board_open', { key: 'k', parent: 'o/r#1' }), 'open k · parent o/r#1')
  assert.equal(callTitle('board_read', { status: ['waiting'] }), 'read board · waiting')
  assert.equal(callTitle('board_add', { item: '6b', what: 'Board rule in Bosla', status: 'waiting', dependsOn: ['5'] }), 'add 6b "Board rule in Bosla" · waiting · after 5')
  assert.equal(callTitle('board_add', { what: 'x' }), 'add next "x" · next')
  assert.equal(callTitle('board_update', { item: '2', set: { status: 'done' } }), 'update 2 → done')
  assert.equal(callTitle('board_update', { item: '3', set: { status: 'waiting', pr: '#902' } }), 'update 3 → waiting: pr #902')
  assert.equal(callTitle('board_update', { item: '1', set: { parent: '883' } }), 'update 1: parent 883')
  assert.equal(callTitle('board_update', { item: '1', set: { status: 'now', pr: null } }), 'update 1 → now: clear pr')
  assert.equal(callTitle('board_update', { item: '1', remove: true }), 'remove 1')
})

test('a list of items is named in the title', () => {
  assert.equal(callTitle('board_update', { item: ['1', '2', '3'], set: { parent: 'root' } }), 'update 1, 2, 3: parent root')
  assert.equal(callTitle('board_update', { item: ['4', '5'], remove: true }), 'remove 4, 5')
  assert.equal(callTitle('board_update', { item: ['4'], set: {} }), 'update 4 (no change)')
})

test('result titles name the board and the item it got', async () => {
  const { tools } = await setup()
  const open = await tools.board_open({ key: 'sim-883' }, exec())
  assert.equal(resultTitle('board_open', { key: 'sim-883' }, open), 'open sim-883 (new)')
  const read = await tools.board_read({ status: ['waiting'] }, exec())
  assert.equal(resultTitle('board_read', { status: ['waiting'] }, read), 'read sim-883 · waiting')
  const add = await tools.board_add({ what: 'x', dependsOn: ['5'] }, exec())
  assert.equal(resultTitle('board_add', { what: 'x', dependsOn: ['5'] }, add), 'add 1 "x" · next · after 5')
  assert.equal(resultTitle('board_read', {}, { ok: false, code: 'not_bound', message: 'm' }), undefined)
})

test('presentation wires meta into presentResult as a generic card', () => {
  const p = presentation('board_read')
  assert.deepEqual(p.presentCall({}), { card: 'generic', title: 'read board', kind: 'read' })
  const meta = p.presentationMeta({}, { ok: true, board: { key: 'k' } })
  assert.deepEqual(p.presentResult({}, { content: [], isError: false, meta }), { card: 'generic', title: 'read k' })
  assert.equal(p.presentResult({}, { content: [], isError: false }), undefined)
  assert.equal(p.presentationMeta({}, { ok: false }), null)
})
