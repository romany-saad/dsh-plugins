import test from 'node:test'
import assert from 'node:assert/strict'
import { boardProgress, boardProgressText, boardRows, blockedText, modelText, needsYou, notes, progressText, refUrl, taskUrl, titleText } from '../lib/rows.js'

const t = (item, status, what, more = {}) => ({ item, status, what, ...more })

test('needsYou: waitingOn owner, any case and spacing, open tasks only', () => {
  const tasks = [
    t('1', 'waiting', 'a', { waitingOn: ' Owner ' }),
    t('2', 'waiting', 'b', { waitingOn: 'CI', nextAction: 'Owner: merge.' }),
    t('3', 'done', 'c', { waitingOn: 'owner' }),
    t('4', 'now', 'd', { waitingOn: 'OWNER' }),
  ]
  const r = needsYou(tasks)
  assert.equal(r.guessed, false)
  assert.deepEqual(r.tasks.map((x) => x.item), ['1', '4'])
})

test('needsYou guesses only when no task sets waitingOn', () => {
  const tasks = [
    t('1', 'waiting', 'a', { nextAction: 'Owner: once CI is green, merge.' }),
    t('2', 'next', 'b', { nextAction: 'Owner: decide.' }),
    t('3', 'waiting', 'c', { nextAction: 'Hub: start later.' }),
  ]
  assert.deepEqual(needsYou(tasks), { tasks: [tasks[0]], guessed: true })
  assert.deepEqual(needsYou([...tasks, t('4', 'waiting', 'd', { waitingOn: 'release' })]), { tasks: [], guessed: false })
})

test('notes: nextAction, why, startCondition, each text once', () => {
  assert.deepEqual(notes({ why: 'W', nextAction: 'N', extra: { startCondition: 'S' } }), [
    { label: 'next', text: 'N' }, { label: 'why', text: 'W' }, { label: 'starts when', text: 'S' }])
  assert.deepEqual(notes({ why: 'Starts on release.', extra: { startCondition: ' starts on  release. ' } }), [{ label: 'why', text: 'Starts on release.' }])
  assert.deepEqual(notes({ extra: { startCondition: 'S' }, nextAction: ' ' }), [{ label: 'starts when', text: 'S' }])
})

test('one wait line per open row, the rest in others; done rows have no line', () => {
  const rows = boardRows({ tasks: [
    t('1', 'waiting', 'a', { why: 'W', nextAction: 'N' }),
    t('2', 'next', 'b', { why: 'W' }),
    t('3', 'done', 'c', { nextAction: 'stale', pr: '#9' }),
  ] })
  assert.equal(rows[0].line, 'N')
  assert.deepEqual(rows[0].others, [{ label: 'why', text: 'W' }])
  assert.equal(rows[1].line, 'W')
  assert.deepEqual(rows[1].others, [])
  assert.equal(rows[2].line, undefined)
  assert.equal(rows[2].done, true)
  assert.deepEqual(rows[2].others, [{ label: 'next', text: 'stale' }])
})

test('blockedBy lists unmet dependencies by issue with status; ready when all are done', () => {
  const rows = Object.fromEntries(boardRows({ tasks: [
    t('1', 'waiting', 'a', { issue: '#884' }),
    t('2', 'done', 'b', { issue: '#888' }),
    t('3', 'now', 'c'),
    t('5', 'next', 'd', { dependsOn: ['1', '2', '3', 'ghost'] }),
    t('6', 'waiting', 'e', { dependsOn: ['5'] }),
    t('7', 'next', 'f', { dependsOn: ['2'] }),
    t('8', 'now', 'g', { dependsOn: ['1'] }),
  ] }).map((r) => [r.item, r]))
  assert.equal(blockedText(rows['5'].blockedBy), 'blocked by #884 (waiting), 3 (now)')
  assert.equal(rows['5'].ready, false)
  assert.equal(blockedText(rows['6'].blockedBy), 'blocked by 5 (next)')
  assert.deepEqual(rows['7'].blockedBy, [])
  assert.equal(rows['7'].ready, true)
  assert.deepEqual(rows['8'].blockedBy, [], 'now rows are not marked blocked')
})

test('a parent shows its children\'s progress, needs-you by the same rule', () => {
  const rows = boardRows({ tasks: [
    t('883', 'now', 'effort'),
    t('1', 'waiting', 'a', { parent: '883', waitingOn: 'owner' }),
    t('2', 'done', 'b', { parent: '883' }),
    t('3', 'done', 'c', { parent: '883' }),
    t('4', 'next', 'd', { parent: '2' }),
  ] })
  assert.equal(progressText(rows[0].progress), '2 of 3 done · 1 needs you')
  assert.equal(progressText(rows.find((r) => r.item === '2').progress), '0 of 1 done')
  assert.equal(rows.find((r) => r.item === '1').progress, undefined)
})

test('after lists only dependencies on the board, by issue; notes stay as stored', () => {
  const why = "Still blocked by 'release notes' (not on the board)."
  const [, , row] = boardRows({ tasks: [
    t('1', 'done', 'a', { issue: '#884' }),
    t('2', 'done', 'b'),
    t('5', 'next', 'c', { dependsOn: ['1', '2', 'release notes'], why }),
  ] })
  assert.deepEqual(row.after, ['#884', '2'])
  assert.equal(row.line, why)
})

test('board progress: work tasks only, needs you, then the first of needs you, blocked, now', () => {
  const tasks = [
    t('883', 'now', '#883 effort', { issue: '#883' }),
    t('1', 'done', 'a', { parent: '883' }),
    t('2', 'now', 'Write', { parent: '883', issue: '#2' }),
    t('3', 'next', 'Check', { parent: '883', dependsOn: ['2'] }),
    t('4', 'waiting', 'Merge', { parent: '883', issue: '#4', waitingOn: 'owner' }),
  ]
  const p = boardProgress({ tasks })
  assert.deepEqual([p.done, p.total, p.needsYou], [1, 4, 1])
  assert.equal(boardProgressText(p), '1 of 4 done · 1 needs you · #4 Merge')
  const noOwner = tasks.map((x) => (x.item === '4' ? { ...x, waitingOn: 'CI' } : x))
  assert.equal(boardProgressText(boardProgress({ tasks: noOwner })), '1 of 4 done · blocked: Check')
  const unknown = [t('1', 'now', 'a'), t('2', 'next', 'b', { dependsOn: ['ghost'] })]
  assert.equal(boardProgressText(boardProgress({ tasks: unknown })), '0 of 2 done · blocked: b')
  assert.equal(boardProgressText(boardProgress({ tasks: [t('1', 'now', 'a'), t('2', 'next', 'b')] })), '0 of 2 done · now: a')
  assert.equal(boardProgressText(boardProgress({ tasks: [t('1', 'done', 'a')] })), '1 of 1 done')
  assert.equal(boardProgressText(boardProgress({ tasks: [] })), '0 of 0 done')
})

test('tree guides per depth, last child closes', () => {
  const rows = boardRows({ tasks: [t('r', 'now', 'r'), t('a', 'next', 'a', { parent: 'r' }), t('a1', 'next', 'a1', { parent: 'a' }), t('b', 'next', 'b', { parent: 'r' }), t('b1', 'next', 'b1', { parent: 'b' })] })
  assert.deepEqual(rows.map((r) => r.guide + r.item), ['r', '├─ a', '│  └─ a1', '└─ b', '   └─ b1'])
})

test('model text hides a provider the model name already carries', () => {
  assert.equal(modelText({ provider: 'claude', model: 'claude-opus-5-5', effort: 'high' }), 'claude-opus-5-5 · high')
  assert.equal(modelText({ provider: 'claude', model: 'opus', effort: 'high' }), 'claude · opus · high')
  assert.equal(modelText({ provider: 'codex', model: 'codex-mini' }), 'codex · codex-mini')
  assert.equal(modelText({ provider: 'codex' }), 'codex')
  assert.equal(modelText({}), '')
})

test('refUrl: https as stored, owner/repo#n, #n with the parent repo, else nothing', () => {
  const parent = 'Romany-Saad/resturants-app#883'
  assert.equal(refUrl('https://jira.example/PROJ-1', 'issues', parent), 'https://jira.example/PROJ-1')
  assert.equal(refUrl('o/r#12', 'pull'), 'https://github.com/o/r/pull/12')
  assert.equal(refUrl('#892', 'pull', parent), 'https://github.com/Romany-Saad/resturants-app/pull/892')
  assert.equal(refUrl('#892', 'pull'), undefined)
  assert.equal(refUrl('#892', 'pull', 'PROJ-883'), undefined)
  assert.equal(refUrl('PROJ-12', 'issues', parent), undefined)
  assert.equal(refUrl('http://x', 'issues', parent), undefined)
  assert.equal(refUrl(undefined, 'issues', parent), undefined)
  assert.equal(taskUrl({ issue: '#884', pr: '#892' }, parent), 'https://github.com/Romany-Saad/resturants-app/pull/892')
  assert.equal(taskUrl({ issue: '#884', pr: 'PR-1' }, parent), 'https://github.com/Romany-Saad/resturants-app/issues/884')
})

test('the title leads with the issue unless what already does', () => {
  assert.equal(titleText({ what: 'Log reader', issue: '#888' }), '#888 Log reader')
  assert.equal(titleText({ what: '#883 effort', issue: '#883' }), '#883 effort')
  assert.equal(titleText({ what: 'x' }), 'x')
})
