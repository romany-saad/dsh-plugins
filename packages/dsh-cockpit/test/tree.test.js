import test from 'node:test'
import assert from 'node:assert/strict'
import { boardTree } from '../lib/tree.js'
import { t } from './helpers.mjs'

test('roots, children in board order, after text', () => {
  const { tree, flags } = boardTree({ tasks: [
    t('1', 'done', 'DSH profile with the guard bridge'),
    t('2', 'now', 'dsh-cockpit board'),
    t('2a', 'waiting', 'Read DSH sessions in nightcost', { parent: '2', dependsOn: ['1'] }),
    t('2b', 'next', 'Bosla adopts the board', { parent: '2', dependsOn: ['2a', '9'] }),
  ] })
  assert.deepEqual(flags, [{ item: '2b', code: 'unknown_dependency', ref: '9' }])
  const lines = tree.split('\n').slice(3)
  assert.equal(tree.split('\n')[1], "  Unknown dependency: '9' on 2b")
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^1 +done +DSH profile/)
  assert.match(lines[1], /^2 +now +dsh-cockpit board +0 of 2 done$/)
  assert.match(lines[2], /^├─ 2a +waiting +Read DSH sessions in nightcost +after 1$/)
  assert.match(lines[3], /^└─ 2b +next +Bosla adopts the board +blocked by 2a \(waiting\) +! blocked by '9' \(not on the board\)$/)
})

test('the live layout: guides, aligned columns, one wait phrase, PR on done rows, what blocks', () => {
  const { tree } = boardTree({ parent: 'o/r#883', tasks: [
    t('1', 'waiting', 'Profile and guard', { issue: '#884', pr: '#892', parent: '883', why: 'CI running.', nextAction: 'Owner: merge PR #892.', waitingOn: 'owner' }),
    t('2', 'done', 'Log reader', { issue: '#888', pr: '#889', parent: '883', provider: 'claude', model: 'claude-opus-5-5', nextAction: 'stale' }),
    t('5', 'next', 'Live checks and docs', { issue: '#887', parent: '883', dependsOn: ['1', '2'] }),
    t('883', 'now', '#883 effort', { issue: '#883' }),
    t('6b', 'waiting', 'Board rule in Bosla', { parent: '883', dependsOn: ['5'], startWhen: 'Starts on release.' }),
  ] })
  assert.deepEqual(tree.split('\n'), [
    '883    now      #883 effort                 1 of 4 done · 1 needs you',
    '├─ 1   waiting  #884 Profile and guard      Owner: merge PR #892.',
    '├─ 2   done     #888 Log reader             PR #889',
    '├─ 5   next     #887 Live checks and docs   blocked by #884 (waiting)',
    '└─ 6b  waiting  Board rule in Bosla         Starts on release.   blocked by #887 (next)',
  ])
})

test('dropped: shown as stored, counted apart from done, blocks nothing, no wait phrase', () => {
  const { tree } = boardTree({ tasks: [
    t('r', 'now', 'root'),
    t('1', 'done', 'a', { parent: 'r' }),
    t('2', 'dropped', 'b', { parent: 'r', nextAction: 'was going to do it', waitingOn: 'owner' }),
    t('3', 'next', 'c', { parent: 'r', dependsOn: ['2'] }),
  ] })
  assert.deepEqual(tree.split('\n'), [
    'r     now      root   1 of 3 done · 1 dropped',
    '├─ 1  done     a',
    '├─ 2  dropped  b',
    '└─ 3  next     c      after 2',
  ])
})

test('an unknown parent: drawn under the board root with the flag', () => {
  const { tree, flags, problems } = boardTree({ tasks: [t('r', 'now', 'root'), t('a', 'next', 'a', { parent: 'r' }), t('1', 'next', 'lost', { parent: 'x' })] })
  assert.deepEqual(flags, [{ item: '1', code: 'unknown_parent', ref: 'x' }])
  assert.deepEqual(problems.map((p) => p.text), ["Unknown parent: 'x' on 1"])
  const rows = tree.split('\n').slice(3)
  assert.match(rows[0], /^r +now +root +0 of 2 done$/)
  assert.match(rows[2], /^└─ 1 +next +lost +! parent x not on the board$/)
})

test('an unknown parent with no single board root: top level, after the real roots', () => {
  const { tree } = boardTree({ tasks: [t('1', 'next', 'lost', { parent: 'x' }), t('r', 'now', 'r'), t('s', 'now', 's')] })
  assert.deepEqual(tree.split('\n').slice(3).map((l) => l.split(' ')[0]), ['r', 's', '1'])
})

test('self-parent and two-task loop: under the board root, the path named, nothing lost', () => {
  const { tree, flags } = boardTree({ tasks: [
    t('r', 'now', 'root'),
    t('0', 'next', 'real child', { parent: 'r' }),
    t('1', 'next', 'self', { parent: '1' }),
    t('2', 'next', 'a', { parent: '3', issue: '#2' }),
    t('3', 'next', 'b', { parent: '2' }),
    t('4', 'next', 'under 3', { parent: '3' }),
  ] })
  assert.deepEqual(flags.map((f) => [f.item, f.code, f.path.join(' → ')]), [['1', 'parent_loop', '1 → 1'], ['2', 'parent_loop', '#2 → 3 → #2'], ['3', 'parent_loop', '3 → #2 → 3']])
  const lines = tree.split('\n')
  assert.deepEqual(lines.slice(0, 3), ['Problems:', '  Parent loop: 1 → 1', '  Parent loop: #2 ↔ 3'])
  const rows = lines.slice(4)
  assert.equal(rows.length, 6, 'nothing is lost')
  assert.deepEqual(rows.map((l) => l.split(/(?<=\S)  +/)[0]), ['r', '├─ 0', '├─ 1', '├─ 2', '└─ 3', '   └─ 4'])
  assert.match(rows[0], /0 of 4 done$/, 'the loop rows count toward the root they sit under')
})

test('a loop with no board root goes to the top level, after the real roots', () => {
  const { tree } = boardTree({ tasks: [t('a', 'next', 'a', { parent: 'b' }), t('b', 'next', 'b', { parent: 'a' }), t('r', 'now', 'r'), t('s', 'now', 's')] })
  assert.deepEqual(tree.split('\n').slice(3).map((l) => l.split(/(?<=\S)  +/)[0]), ['r', 's', 'a', 'b'])
})

test('the D2 case: #885 and #886 parent each other, drawn in place under #883, counted', () => {
  const tasks = [
    t('883', 'now', '#883 effort', { issue: '#883' }),
    t('1', 'done', 'Profile and guard', { issue: '#884', pr: '#892', parent: '883' }),
    t('3', 'done', 'Work reports', { issue: '#885', pr: '#890', parent: '4' }),
    t('4', 'done', 'Nightcost', { issue: '#886', pr: '#891', parent: '3' }),
    t('5', 'next', 'Live checks', { issue: '#887', parent: '883', dependsOn: ['1', 'release notes'] }),
  ]
  const { tree, problems } = boardTree({ parent: 'o/r#883', tasks })
  assert.deepEqual(problems.map((p) => [p.item, p.text]), [['3', 'Parent loop: #885 ↔ #886'], ['5', "Unknown dependency: 'release notes' on #887"]])
  const rows = tree.split('\n').slice(4)
  assert.match(rows[0], /^883 +now +#883 effort +3 of 4 done$/)
  assert.match(rows[2], /^├─ 3 +done +#885 Work reports +PR #890 +! parent loop: #885 → #886 → #885$/)
  assert.match(rows[3], /^├─ 4 +done +#886 Nightcost +PR #891 +! parent loop: #886 → #885 → #886$/)
  assert.match(rows[4], /^└─ 5 +next .*! blocked by 'release notes' \(not on the board\)$/)
})

test('two tasks sharing an issue or a pr are flagged, never refused', () => {
  const { tree, flags, problems } = boardTree({ tasks: [t('3', 'done', 'a', { issue: '#885' }), t('7', 'next', 'b', { issue: '#885', pr: '#9' }), t('8', 'next', 'c', { pr: '#9' })] })
  assert.deepEqual(flags.map((f) => [f.item, f.code]), [['3', 'duplicate_issue'], ['7', 'duplicate_issue'], ['7', 'duplicate_pr'], ['8', 'duplicate_pr']])
  assert.deepEqual(problems.map((p) => p.text), ['Duplicate issue: #885 (items 3, 7)', 'Duplicate pr: #9 (items 7, 8)'])
  assert.match(tree, /! duplicate issue #885 \(items 3, 7\)   ! duplicate pr #9 \(items 7, 8\)$/m)
})

test('only: draws the subset, its flags and its problems', () => {
  const tasks = [t('r', 'now', 'r'), t('a', 'next', 'a', { parent: 'r', dependsOn: ['x'] }), t('b', 'next', 'b', { parent: 'r', dependsOn: ['y'] })]
  const { tree, flags, problems } = boardTree({ tasks }, { only: new Set(['a']) })
  assert.deepEqual(flags.map((f) => f.ref), ['x'])
  assert.deepEqual(problems.map((p) => p.item), ['a'])
  assert.match(tree.split('\n').at(-1), /^a +next +a +! blocked by 'x'/)
})

test('no problems: no Problems block', () => {
  assert.ok(!boardTree({ tasks: [t('1', 'now', 'a')] }).tree.includes('Problems'))
})

test('removing a parent flags its children', () => {
  const { flags } = boardTree({ tasks: [t('2', 'next', 'child', { parent: '1' })] })
  assert.equal(flags[0].code, 'unknown_parent')
})

test('a row the last drift check reports differently ends in "reported: <status>"', () => {
  const drift = { checkedAt: 'x', checked: 2, items: [{ item: '2', status: 'done', note: '#902 merged' }] }
  const { tree } = boardTree({ drift, tasks: [t('1', 'done', 'one'), t('2', 'waiting', 'two', { pr: '#902' })] })
  assert.deepEqual(tree.split('\n'), ['1  done     one', '2  waiting  two   reported: done'])
})
