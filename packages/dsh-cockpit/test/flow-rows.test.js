import test from 'node:test'
import assert from 'node:assert/strict'
import { boardRows, boardSegments, stripModel } from '../lib/rows.js'
import { t } from './helpers.mjs'

test('flow stages and ordinary children count once in local and board progress', () => {
  const flow = { revision: 2, stages: [
    { id: 'plan', title: 'Plan', status: 'done' },
    { id: 'build', title: 'Build', status: 'next' },
    { id: 'ship', title: 'Ship', status: 'next' },
    { id: 'skip', title: 'Skip', status: 'next' },
  ], skipped: { skip: 'not needed' } }
  const tasks = [t('root', 'now', 'Work', { flow }),
    t('build', 'waiting', 'Build task', { parent: 'root', stage: 'build', waitingOn: 'owner' }),
    t('extra', 'dropped', 'Extra', { parent: 'root' })]
  const board = { tasks }
  const rows = boardRows(board)
  assert.deepEqual(rows[0].progress, { done: 1, dropped: 1, total: 4, needsYou: 1 })
  const local = boardSegments(board, rows, 'root')
  const whole = boardSegments(board, rows)
  assert.deepEqual(local.segments.map((s) => s.kind), ['done', 'needs you', 'ready', 'dropped'])
  assert.deepEqual([local.done, local.dropped, local.total], [1, 1, 4])
  assert.deepEqual([whole.done, whole.dropped, whole.total], [1, 1, 4])
  assert.equal(stripModel(board).done, '1 of 4 done · 1 dropped')
  assert.equal(boardRows(board, { only: new Set(['root']) })[0].progress.total, 4)
})

test('a flow without children counts stages rather than its owner', () => {
  const tasks = [t('1', 'now', 'Work', { flow: { revision: 1, stages: [{ id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'now' }], skipped: {} } })]
  const rows = boardRows({ tasks })
  assert.deepEqual([rows[0].progress.done, rows[0].progress.total], [1, 2])
  assert.deepEqual(boardSegments({ tasks }, rows).segments.map((s) => s.kind), ['done', 'now'])
})
