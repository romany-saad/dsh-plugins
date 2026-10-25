import test from 'node:test'
import assert from 'node:assert/strict'
import { boardTree } from '../lib/tree.js'

const t = (item, status, what, more = {}) => ({ item, status, what, ...more })

test('roots, children in board order, after text', () => {
  const { tree, flags } = boardTree({ tasks: [
    t('1', 'done', 'DSH profile with the guard bridge'),
    t('2', 'now', 'dsh-cockpit board'),
    t('2a', 'waiting', 'Read DSH sessions in nightcost', { parent: '2', dependsOn: ['1'] }),
    t('2b', 'next', 'Bosla adopts the board', { parent: '2', dependsOn: ['2a', '9'] }),
  ] })
  assert.deepEqual(flags, [{ item: '2b', code: 'unknown_dependency', ref: '9' }])
  const lines = tree.split('\n')
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^1 +done +DSH profile/)
  assert.match(lines[2], /^ {2}2a +waiting +Read DSH sessions in nightcost +after 1$/)
  assert.match(lines[3], /after 2a, 9 +! unknown dependency 9$/)
})

test('unknown parent becomes a root with a flag', () => {
  const { tree, flags } = boardTree({ tasks: [t('1', 'next', 'a', { parent: 'x' })] })
  assert.deepEqual(flags, [{ item: '1', code: 'unknown_parent', ref: 'x' }])
  assert.match(tree, /^1 +next +a +! unknown parent x$/)
})

test('self-parent and two-task loop are roots with parent_loop', () => {
  const { tree, flags } = boardTree({ tasks: [
    t('1', 'next', 'self', { parent: '1' }),
    t('2', 'next', 'a', { parent: '3' }),
    t('3', 'next', 'b', { parent: '2' }),
    t('4', 'next', 'under 3', { parent: '3' }),
  ] })
  assert.deepEqual(flags.map((f) => [f.item, f.code]), [['1', 'parent_loop'], ['2', 'parent_loop'], ['3', 'parent_loop']])
  const lines = tree.split('\n')
  assert.equal(lines.length, 4, 'nothing is lost')
  assert.match(lines[0], /^1 /)
  assert.match(lines[1], /^2 /)
  assert.match(lines[2], /^3 /)
  assert.match(lines[3], /^ {2}4 /)
})

test('removing a parent flags its children', () => {
  const { flags } = boardTree({ tasks: [t('2', 'next', 'child', { parent: '1' })] })
  assert.equal(flags[0].code, 'unknown_parent')
})
