import test from 'node:test'
import assert from 'node:assert/strict'
import { CLOSED_STATUSES, STATUSES, TASK_FIELDS, isClosed, nextItem, orderTask } from '../lib/task.js'

test('statuses include dropped; done and dropped are closed', () => {
  assert.deepEqual(STATUSES, ['next', 'now', 'waiting', 'done', 'dropped'])
  assert.deepEqual(CLOSED_STATUSES, ['done', 'dropped'])
  assert.deepEqual(STATUSES.filter(isClosed), ['done', 'dropped'])
})

test('next integer item: the largest integer plus one, else 1', () => {
  assert.equal(nextItem([]), '1')
  assert.equal(nextItem([{ item: '3a' }, { item: 'x' }]), '1')
  assert.equal(nextItem([{ item: '2' }, { item: '10' }, { item: '3a' }]), '11')
})

test('orderTask: file order, startWhen after readyCommand, unknown fields kept after the known ones', () => {
  const task = orderTask({ zz: 'kept', updatedAt: 'u', startWhen: 'on release', status: 'next', readyCommand: 'r', what: 'w', item: '1', parent: 'p', gone: undefined })
  assert.deepEqual(Object.keys(task), ['item', 'what', 'status', 'readyCommand', 'startWhen', 'parent', 'updatedAt', 'zz'])
  assert.ok(TASK_FIELDS.includes('startWhen'))
})
