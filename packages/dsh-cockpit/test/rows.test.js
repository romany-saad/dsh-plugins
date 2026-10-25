import test from 'node:test'
import assert from 'node:assert/strict'
import { askText, boardFlags, boardProgress, boardProgressText, boardRows, blockedText, EMPTY_STATE, modelText, needsYou, notes, prText, problemLine, problems, progressText, refUrl, rowCells, stripModel, stripText, taskUrl, titleText } from '../lib/rows.js'

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
  assert.equal(boardProgressText(boardProgress({ tasks: noOwner })), '1 of 4 done · 3 blocked by #2 (now)')
  const unknown = [t('1', 'now', 'a'), t('2', 'next', 'b', { dependsOn: ['ghost'] })]
  assert.equal(boardProgressText(boardProgress({ tasks: unknown })), "0 of 2 done · 2 blocked by 'ghost' (not on the board)")
  assert.equal(boardProgressText(boardProgress({ tasks: [t('1', 'now', 'a', { issue: '#1' }), t('2', 'next', 'b')] })), '0 of 2 done · in progress: #1 a')
  const two = [t('3', 'now', 'Work reports', { issue: '#885' }), t('4', 'now', 'Nightcost', { issue: '#886' }), t('5', 'next', 'c')]
  assert.equal(boardProgressText(boardProgress({ tasks: two })), '0 of 3 done · 2 in progress: #885, #886')
  assert.equal(boardProgressText(boardProgress({ tasks: [t('1', 'done', 'a')] })), '1 of 1 done')
  assert.equal(boardProgressText(boardProgress({ tasks: [] })), '0 of 0 done')
})

// The live sim-883 board as of batch 5.
const sim = [
  t('1', 'done', 'Profile and guard', { parent: '883', issue: '#884' }),
  t('2', 'done', 'Log reader', { parent: '883', issue: '#888' }),
  t('3', 'done', 'Work reports', { parent: '883', issue: '#885', dependsOn: ['2'] }),
  t('4', 'done', 'Nightcost', { parent: '883', issue: '#886', dependsOn: ['2'] }),
  t('5', 'next', 'Live checks and docs', { parent: '883', issue: '#887', dependsOn: ['1', '3', 'release notes'] }),
  t('883', 'now', '#883 effort', { issue: '#883' }),
  t('6b', 'waiting', 'Board rule in Bosla', { parent: '883', dependsOn: ['5'] }),
]
const kinds = (p) => p.segments.map((s) => s.item + ':' + s.kind)

test('segments: one per work task, in tree order, with status and tooltip; the phrase names the blocker', () => {
  const p = boardProgress({ tasks: sim })
  assert.deepEqual(kinds(p), ['1:done', '2:done', '3:done', '4:done', '5:blocked', '6b:waiting'])
  assert.equal(p.continuous, false)
  assert.equal(p.segments[4].tooltip, "#887 Live checks and docs · next · blocked by 'release notes' (not on the board)")
  assert.equal(p.segments[5].tooltip, 'Board rule in Bosla · waiting · blocked by #887')
  assert.equal(boardProgressText(p), "4 of 6 done · #887 blocked by 'release notes' (not on the board)")
  // Tree order, not board order: a child listed before its parent's sibling.
  const order = boardProgress({ tasks: [t('r', 'now', 'r'), t('b', 'next', 'b', { parent: 'r' }), t('a1', 'done', 'a1', { parent: 'a' }), t('a', 'now', 'a', { parent: 'r' })] })
  assert.deepEqual(kinds(order), ['b:ready', 'a1:done'])
})

test('segments: every status; a now segment names who runs it', () => {
  const tasks = [
    t('r', 'now', 'root'),
    t('d', 'done', 'd', { parent: 'r', issue: '#1' }),
    t('n', 'now', 'Work reports', { parent: 'r', issue: '#885', provider: 'claude', model: 'claude-opus-5-5', effort: 'high' }),
    t('w', 'waiting', 'w', { parent: 'r', waitingOn: 'CI' }),
    t('o', 'waiting', 'o', { parent: 'r', waitingOn: 'owner' }),
    t('x', 'next', 'x', { parent: 'r', dependsOn: ['d'] }),
    t('y', 'next', 'y', { parent: 'r', dependsOn: ['n'] }),
  ]
  const p = boardProgress({ tasks })
  assert.deepEqual(kinds(p), ['d:done', 'n:now', 'w:waiting', 'o:needs you', 'x:ready', 'y:blocked'])
  assert.equal(p.segments[1].tooltip, '#885 Work reports · now · claude-opus-5-5 high')
  assert.equal(p.segments[3].tooltip, 'o · waiting · needs you')
  assert.equal(p.segments[4].tooltip, 'x · next · ready')
  assert.equal(p.segments[5].tooltip, 'y · next · blocked by #885')
  // The live board with item 5 now: 6b is still blocked by it, so blocked wins.
  const now5 = boardProgress({ tasks: sim.map((x) => (x.item === '5' ? { ...x, status: 'now' } : x)) })
  assert.deepEqual(kinds(now5), ['1:done', '2:done', '3:done', '4:done', '5:now', '6b:waiting'])
  assert.equal(boardProgressText(now5), '4 of 6 done · 6b blocked by #887 (now)')
  // Nothing needs you or is blocked: what is in progress.
  const free = boardProgress({ tasks: sim.filter((x) => x.item !== '6b').map((x) => (x.item === '5' ? { ...x, status: 'now', dependsOn: [] } : x)) })
  assert.equal(boardProgressText(free), '4 of 5 done · in progress: #887 Live checks and docs')
})

test('segments: above 24 work tasks the bar is continuous; at 24 it is segmented', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => t(String(i), 'next', 'w' + i))
  assert.equal(boardProgress({ tasks: many(24) }).continuous, false)
  assert.equal(boardProgress({ tasks: many(25) }).continuous, true)
  assert.equal(boardProgress({ tasks: many(25) }).segments.length, 25, 'the model keeps them; the bar draws one fill')
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

test('focus phrase: a blocker is named with its status; one not on the board says so', () => {
  const p = boardProgress({ tasks: [t('1', 'waiting', 'Publish', { issue: '#886', waitingOn: 'release' }), t('2', 'next', 'Docs', { issue: '#887', dependsOn: ['1'] })] })
  assert.equal(p.focus.text, '#887 blocked by #886 (waiting)')
  assert.equal(boardProgress({ tasks: sim }).focus.text, "#887 blocked by 'release notes' (not on the board)")
})

test('rowCells: the columns and lines of a row, from the shared row model', () => {
  const board = { parent: 'o/r#883', tasks: [
    t('883', 'now', '#883 effort', { issue: '#883' }),
    t('1', 'done', 'Profile', { parent: '883', issue: '#884', pr: '#892', branch: 'b1', model: 'opus', provider: 'claude', effort: 'high' }),
    t('5', 'next', 'Docs', { parent: '883', issue: '#887', nextAction: 'start later', why: 'W', dependsOn: ['6', 'ghost'], readyCommand: 'git worktree add x' }),
    t('6', 'waiting', 'Publish', { parent: '883', issue: '#886', waitingOn: 'owner', nextAction: 'Merge it.' }),
    t('7', 'waiting', 'Nested', { parent: '5', waitingOn: 'CI', nextAction: 'N' }),
  ] }
  const flags = boardFlags(board.tasks)
  const cells = Object.fromEntries(boardRows(board).map((r) => [r.item, rowCells(r, flags.filter((f) => f.item === r.item))]))
  assert.equal(cells['883'].parent, true)
  assert.equal(cells['883'].progress, '1 of 3 done')
  assert.equal(cells['883'].progressNeedsYou, '1 needs you')
  assert.equal(cells['883'].mark, undefined)
  assert.deepEqual([cells['1'].mark, cells['1'].wrap, cells['1'].pr, cells['1'].prUrl], ['check', false, 'PR #892', 'https://github.com/o/r/pull/892'])
  assert.equal(cells['1'].next, undefined, 'done rows have no meta line')
  assert.deepEqual(cells['1'].detail.map((d) => d.key), ['Model', 'Branch'])
  assert.deepEqual([cells['5'].mark, cells['5'].wrap, cells['5'].next], ['ring', true, { label: 'Next:', text: 'start later' }])
  assert.deepEqual(cells['5'].blockedBy, [{ ref: '#886', status: 'waiting' }])
  assert.deepEqual(cells['5'].problems, ["Blocked by 'ghost' (not on the board)"])
  assert.deepEqual(cells['5'].detail, [{ key: 'Reason', value: 'W', mono: false }])
  assert.equal(cells['5'].command, 'git worktree add x')
  assert.deepEqual([cells['6'].needsYou, cells['6'].next, cells['6'].mark], [true, undefined, 'dot-waiting'], 'the ask lives in Needs you')
  assert.deepEqual(cells['6'].detail, [{ key: 'Next', value: 'Merge it.', mono: false }])
  assert.deepEqual([cells['7'].indent, cells['7'].elbow, cells['7'].next], [1, true, { label: 'Waiting on', text: 'CI' }])
  assert.deepEqual(cells['7'].detail, [{ key: 'Next', value: 'N', mono: false }])
  assert.equal(rowCells(boardRows({ tasks: [t('1', 'next', 'a')] })[0]).expandable, false)
})

test('prText fits the 60 px column: "PR #892"', () => {
  assert.equal(prText('#892'), 'PR #892')
  assert.equal(prText('o/r#12'), 'PR #12')
  assert.equal(prText('https://github.com/o/r/pull/7'), 'PR #7')
  assert.equal(prText('PR-1'), 'PR')
  assert.equal(prText(' '), undefined)
})

test('problemLine: the kind, the rows involved by issue, the full text', () => {
  const tasks = [t('r', 'now', 'r'), t('3', 'done', 'a', { issue: '#885', parent: '4' }), t('4', 'done', 'b', { issue: '#886', parent: '3' }), t('5', 'next', 'c', { issue: '#887', dependsOn: ['x'] })]
  assert.deepEqual(problems(tasks).map((p) => problemLine(p, tasks)), [
    { item: '3', kind: 'Parent loop', refs: '#885, #886', text: 'Parent loop: #885 ↔ #886' },
    { item: '5', kind: 'Unknown dependency', refs: '#887', text: "Unknown dependency: 'x' on #887" },
  ])
})

test('the empty state is the design\'s', () => {
  assert.deepEqual(EMPTY_STATE, { title: 'No board in this session', line: 'A hub agent binds a board when it starts to coordinate work. The board shows here after that.' })
})

test('the strip: normal, one ask with its command, two asks without', () => {
  const normal = stripModel({ key: 'sim-883', tasks: sim })
  assert.equal(stripText(normal), "sim-883 · 4 of 6 done · #887 blocked by 'release notes' (not on the board) · Board ›")
  assert.equal(normal.progress.segments.length, 6)
  const one = [...sim.slice(0, 4), t('6', 'waiting', 'Publish to npm', { issue: '#886', parent: '883', waitingOn: 'owner', nextAction: 'Owner: Merge PR #892.', readyCommand: 'gh pr merge 892' }), t('883', 'now', 'e')]
  const m = stripModel({ key: 'sim-883', tasks: one })
  assert.deepEqual([m.kind, m.text, m.command, m.item], ['needs you', 'Needs you: merge PR #892 for #886 Publish to npm', 'gh pr merge 892', '6'])
  assert.equal(stripText(m), '⚠ Needs you: merge PR #892 for #886 Publish to npm · Copy command · Board ›')
  const two = [...one, t('7', 'next', 'x', { parent: '883', waitingOn: 'owner' })]
  assert.equal(stripText(stripModel({ key: 'k', tasks: two })), '⚠ 2 need you · Board ›')
  assert.equal(askText(t('1', 'next', 'Docs', { issue: '#887' })), '#887 Docs')
})
