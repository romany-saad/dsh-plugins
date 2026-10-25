import test from 'node:test'
import assert from 'node:assert/strict'
import { driftResult } from '../lib/drift.js'
import { t } from './helpers.mjs'

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
