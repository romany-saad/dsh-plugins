import test from 'node:test'
import assert from 'node:assert/strict'
import { SEGMENT_MAX, blockedText, boardFlags, boardRows, boardSegments, driftState, driftWords, modelText, needsYou, notes, prText, progressText, refUrl, reportedText, rowCells, shortRef, titleParts, titleText } from '../lib/rows.js'
import { t } from './helpers.mjs'

test('needsYou: waitingOn owner, any case and spacing, open tasks only', () => {
  const tasks = [
    t('1', 'waiting', 'a', { waitingOn: ' Owner ' }),
    t('2', 'waiting', 'b', { waitingOn: 'CI', nextAction: 'Owner: merge.' }),
    t('3', 'done', 'c', { waitingOn: 'owner' }),
    t('4', 'now', 'd', { waitingOn: 'OWNER' }),
    t('5', 'dropped', 'e', { waitingOn: 'owner' }),
  ]
  assert.deepEqual(needsYou(tasks).map((x) => x.item), ['1', '4'])
})

test('needsYou ignores nextAction: no guess when no task sets waitingOn', () => {
  const tasks = [
    t('1', 'waiting', 'a', { nextAction: 'Owner: once CI is green, merge.' }),
    t('2', 'next', 'b', { nextAction: 'Owner: decide.' }),
  ]
  assert.deepEqual(needsYou(tasks), [])
  assert.equal(boardRows({ tasks }).some((r) => r.needsYou), false)
})

test('notes: nextAction, why, startWhen, each text once', () => {
  assert.deepEqual(notes({ why: 'W', nextAction: 'N', startWhen: 'S' }), [
    { label: 'next', text: 'N' }, { label: 'why', text: 'W' }, { label: 'start when', text: 'S' }])
  assert.deepEqual(notes({ why: 'Starts on release.', startWhen: ' starts on  release. ' }), [{ label: 'why', text: 'Starts on release.' }])
  assert.deepEqual(notes({ startWhen: 'S', nextAction: ' ' }), [{ label: 'start when', text: 'S' }])
  assert.deepEqual(notes({ extra: { startCondition: 'S' } }), [], 'extra.startCondition is not read: startWhen replaces it')
})

test('startWhen shows on the row and as its wait phrase', () => {
  const [row] = boardRows({ tasks: [t('1', 'waiting', 'a', { startWhen: ' after the release ' })] })
  assert.equal(row.startWhen, 'after the release')
  assert.deepEqual([row.line, row.lineLabel], ['after the release', 'start when'])
})

test('one wait line per open row, the rest in others; closed rows have no line', () => {
  const rows = boardRows({ tasks: [
    t('1', 'waiting', 'a', { why: 'W', nextAction: 'N' }),
    t('2', 'next', 'b', { why: 'W' }),
    t('3', 'done', 'c', { nextAction: 'stale', pr: '#9' }),
    t('4', 'dropped', 'd', { nextAction: 'stale' }),
  ] })
  assert.equal(rows[0].line, 'N')
  assert.deepEqual(rows[0].others, [{ label: 'why', text: 'W' }])
  assert.equal(rows[1].line, 'W')
  assert.deepEqual(rows[1].others, [])
  assert.equal(rows[2].line, undefined)
  assert.deepEqual([rows[2].done, rows[2].closed, rows[2].dropped], [true, true, false])
  assert.deepEqual(rows[2].others, [{ label: 'next', text: 'stale' }])
  assert.deepEqual([rows[3].line, rows[3].done, rows[3].closed, rows[3].dropped], [undefined, false, true, true])
})

test('blockedBy lists open dependencies by issue with status; ready when all are closed', () => {
  const rows = Object.fromEntries(boardRows({ tasks: [
    t('1', 'waiting', 'a', { issue: '#884' }),
    t('2', 'done', 'b', { issue: '#888' }),
    t('3', 'now', 'c'),
    t('5', 'next', 'd', { dependsOn: ['1', '2', '3', 'ghost'] }),
    t('6', 'waiting', 'e', { dependsOn: ['5'] }),
    t('7', 'next', 'f', { dependsOn: ['2'] }),
    t('8', 'now', 'g', { dependsOn: ['1'] }),
    t('9', 'next', 'h', { dependsOn: ['ghost'] }),
  ] }).map((r) => [r.item, r]))
  assert.equal(blockedText(rows['5'].blockedBy), 'blocked by #884 (waiting), 3 (now)')
  assert.equal(rows['5'].ready, false)
  assert.equal(blockedText(rows['6'].blockedBy), 'blocked by 5 (next)')
  assert.deepEqual(rows['7'].blockedBy, [])
  assert.equal(rows['7'].ready, true)
  assert.deepEqual(rows['8'].blockedBy, [], 'now rows are not marked blocked')
  assert.equal(rows['9'].ready, false, 'a dependency not on the board is not met')
})

test('dropped blocks nothing and is never ready', () => {
  const rows = Object.fromEntries(boardRows({ tasks: [
    t('1', 'dropped', 'a'),
    t('2', 'next', 'b', { dependsOn: ['1'] }),
    t('3', 'waiting', 'c', { dependsOn: ['1'] }),
    t('4', 'dropped', 'd', { dependsOn: ['9'] }),
  ] }).map((r) => [r.item, r]))
  assert.deepEqual(rows['2'].blockedBy, [])
  assert.equal(rows['2'].ready, true)
  assert.deepEqual(rows['3'].blockedBy, [])
  assert.equal(rows['1'].ready, false)
  assert.equal(rows['4'].ready, false)
})

test('a parent shows its children\'s progress, dropped apart, needs-you by the same rule', () => {
  const rows = boardRows({ tasks: [
    t('883', 'now', 'effort'),
    t('1', 'waiting', 'a', { parent: '883', waitingOn: 'owner' }),
    t('2', 'done', 'b', { parent: '883' }),
    t('3', 'done', 'c', { parent: '883' }),
    t('4', 'next', 'd', { parent: '2' }),
    t('5', 'dropped', 'e', { parent: '883', waitingOn: 'owner' }),
  ] })
  assert.deepEqual(rows[0].progress, { done: 2, dropped: 1, total: 4, needsYou: 1 })
  assert.equal(progressText(rows[0].progress), '2 of 4 done · 1 dropped · 1 needs you')
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

test('the title leads with the issue unless what already does, as a word', () => {
  assert.equal(titleText({ what: 'Log reader', issue: '#888' }), '#888 Log reader')
  assert.equal(titleText({ what: '#883 effort', issue: '#883' }), '#883 effort')
  assert.equal(titleText({ what: '#883', issue: '#883' }), '#883')
  assert.equal(titleText({ what: '#884 thing', issue: '#88' }), '#88 #884 thing')
  assert.equal(titleText({ what: 'x' }), 'x')
})

test('progress counts every child on the board, also those a filter hides', () => {
  const tasks = [t('r', 'now', 'r'), t('a', 'done', 'a', { parent: 'r' }), t('b', 'next', 'b', { parent: 'r' })]
  const [root] = boardRows({ tasks }, { only: new Set(['r', 'b']) })
  assert.equal(progressText(root.progress), '1 of 2 done')
})

test('a dependency is named as in flags: its trimmed issue, else its item', () => {
  const [, row] = boardRows({ tasks: [t('1', 'now', 'a', { issue: '  ' }), t('2', 'next', 'b', { dependsOn: ['1'] })] })
  assert.equal(blockedText(row.blockedBy), 'blocked by 1 (now)')
  assert.deepEqual(row.after, ['1'])
})

test('refUrl with no links config: only full http(s) URLs link; no tracker is built in', () => {
  const parent = 'Romany-Saad/resturants-app#883'
  assert.equal(refUrl('https://jira.example/browse/PROJ-1', 'issue', { parent }), 'https://jira.example/browse/PROJ-1')
  assert.equal(refUrl(' http://ci.local/run/1 ', 'pr'), 'http://ci.local/run/1')
  assert.equal(refUrl('o/r#12', 'pr', { parent }), undefined)
  assert.equal(refUrl('#892', 'pr', { parent }), undefined)
  assert.equal(refUrl('PROJ-12', 'issue', { parent }), undefined)
  assert.equal(refUrl('javascript:alert(1)', 'issue'), undefined)
  assert.equal(refUrl(undefined, 'issue'), undefined)
  assert.equal(refUrl('#1', 'issue', { links: { issue: '' } }), undefined)
})

test('refUrl with links patterns: {repo} and {number} from the reference or the parent, {ref} as stored', () => {
  const links = { issue: 'https://github.com/{repo}/issues/{number}', pr: 'https://github.com/{repo}/pull/{number}' }
  const parent = 'romany-saad/dsh-plugins#1'
  assert.equal(refUrl('o/r#12', 'pr', { links, parent }), 'https://github.com/o/r/pull/12')
  assert.equal(refUrl('#892', 'pr', { links, parent }), 'https://github.com/romany-saad/dsh-plugins/pull/892')
  assert.equal(refUrl('#892', 'pr', { links }), undefined, 'no parent repo: {repo} cannot be filled')
  assert.equal(refUrl('#892', 'pr', { links, parent: 'PROJ-883' }), undefined)
  assert.equal(refUrl('PROJ-12', 'issue', { links, parent }), undefined)
  assert.equal(refUrl('https://x.example/1', 'issue', { links, parent }), 'https://x.example/1', 'a full URL links as stored')
  const jira = { issue: 'https://example.atlassian.net/browse/{ref}' }
  assert.equal(refUrl('PROJ-12', 'issue', { links: jira }), 'https://example.atlassian.net/browse/PROJ-12')
  assert.equal(refUrl('a b', 'issue', { links: jira }), 'https://example.atlassian.net/browse/a%20b')
  assert.equal(refUrl('PROJ-12', 'pr', { links: jira }), undefined, 'each kind has its own pattern')
  assert.equal(refUrl('PROJ-12', 'issue', { links: { issue: 'javascript:{ref}' } }), undefined, 'only http(s) results link')
})

test('rows carry issueUrl and prUrl from the links option and the board parent', () => {
  const board = { parent: 'o/r#1', tasks: [t('1', 'now', 'a', { issue: '#2', pr: '#3' })] }
  const [plain] = boardRows(board)
  assert.deepEqual([plain.issueUrl, plain.prUrl], [undefined, undefined])
  const [linked] = boardRows(board, { links: { issue: 'https://t.example/{repo}/i/{number}', pr: 'https://t.example/{repo}/p/{number}' } })
  assert.deepEqual([linked.issueUrl, linked.prUrl], ['https://t.example/o/r/i/2', 'https://t.example/o/r/p/3'])
})

test('reported: the last drift entry of a row whose status still differs, tagged "reported: done"', () => {
  const drift = { checkedAt: 'x', checked: 3, items: [{ item: '1', status: 'done', note: '#902 merged' }, { item: '2', status: 'done' }, { item: '9', status: 'done' }] }
  const rows = boardRows({ drift, tasks: [t('1', 'waiting', 'a'), t('2', 'done', 'b'), t('3', 'next', 'c')] })
  assert.deepEqual(rows.map((r) => r.reported), [{ status: 'done', note: '#902 merged' }, undefined, undefined], 'a task since set to the reported status has no tag')
  assert.equal(reportedText(rows[0].reported), 'reported: done')
  assert.deepEqual(boardRows({ drift: { checkedAt: 'x', error: 'exit 3' }, tasks: [t('1', 'now', 'a')] })[0].reported, undefined)
  const bad = { drift: { checkedAt: 'x', items: [null, 3, 'x', { item: 1, status: 'done' }, { item: '1', status: 'done' }] }, tasks: [t('1', 'now', 'a')] }
  assert.deepEqual(boardRows(bad)[0].reported, { status: 'done' }, 'a hand-written entry that is not an object with a string item is skipped')
})

// ---- The Board tab's model (design 6) ----

test('shortRef: #n in the parent repository, repo#n in another, anything else as stored', () => {
  const parent = 'Romany-Saad/resturants-app#883'
  assert.equal(shortRef('Romany-Saad/resturants-app#884', parent), '#884')
  assert.equal(shortRef('romany-saad/RESTURANTS-APP#884', parent), '#884', 'GitHub names ignore case')
  assert.equal(shortRef('romany-saad/dsh-plugins#1', parent), 'dsh-plugins#1')
  assert.equal(shortRef('romany-saad/dsh-plugins#1'), 'dsh-plugins#1')
  for (const r of ['#884', 'PROJ-12', 'https://x.example/1']) assert.equal(shortRef(r, parent), r)
  assert.equal(shortRef('  '), undefined)
})

test('titleParts: the issue apart from what, without repeating a leading issue', () => {
  const parent = 'o/r#1'
  assert.deepEqual(titleParts({ what: 'Log reader', issue: 'x/dsh-plugins#9' }, parent), { issue: 'x/dsh-plugins#9', ref: 'dsh-plugins#9', what: 'Log reader' })
  assert.deepEqual(titleParts({ what: '#883 effort', issue: '#883' }), { issue: '#883', ref: '#883', what: 'effort' })
  assert.deepEqual(titleParts({ what: 'x' }), { what: 'x' })
})

test('prText: "PR #n" from a short, full or URL reference; "PR" otherwise', () => {
  assert.equal(prText('#892'), 'PR #892')
  assert.equal(prText('o/r#892'), 'PR #892')
  assert.equal(prText('https://github.com/o/r/pull/892'), 'PR #892')
  assert.equal(prText('https://gitlab.example/g/p/-/merge_requests/7/'), 'PR #7')
  assert.equal(prText('feature-branch'), 'PR')
  assert.equal(prText(''), undefined)
})

test('rowCells: nextAction shows as written with no "Next:" label; others are labelled once', () => {
  const rows = boardRows({ tasks: [
    t('1', 'next', 'a', { nextAction: 'Owner: merge #892.', why: 'W' }),
    t('2', 'waiting', 'b', { waitingOn: 'CI', nextAction: 'N' }),
    t('3', 'waiting', 'c', { startWhen: 'after 0.1 ships' }),
    t('4', 'next', 'd', { why: 'Because.' }),
    t('5', 'waiting', 'e', { waitingOn: 'owner', nextAction: 'merge it', readyCommand: 'gh pr merge 5' }),
  ] })
  const c = rows.map((r) => rowCells(r))
  assert.equal(c[0].line, 'Owner: merge #892.')
  assert.ok(!c.some((x) => /Next:/.test(x.line ?? '')))
  assert.deepEqual(c[0].detail, [{ key: 'Reason', value: 'W', mono: false }])
  assert.equal(c[1].line, 'Waiting on CI')
  assert.deepEqual(c[1].detail.map((d) => d.key), ['Next'])
  assert.equal(c[2].line, 'Start when: after 0.1 ships')
  assert.equal(c[3].line, 'Reason: Because.')
  assert.equal(c[4].line, undefined, 'a Needs you row keeps its ask in the card')
  assert.equal(c[4].needsYou, true)
  assert.equal(c[4].command, undefined, 'the card holds the command')
})

test('rowCells: marks by shape, dropped and done closed; reported tag and its note', () => {
  const drift = { checkedAt: 'x', items: [{ item: '2', status: 'done', note: '#902 merged' }] }
  const rows = boardRows({ drift, tasks: [t('1', 'done', 'a'), t('2', 'waiting', 'b'), t('3', 'next', 'c'), t('4', 'now', 'd'), t('5', 'dropped', 'e', { nextAction: 'stale' })] })
  const c = rows.map((r) => rowCells(r))
  assert.deepEqual(c.map((x) => x.mark), ['check', 'dot-waiting', 'ring', 'dot-now', 'dash'])
  assert.deepEqual(c.map((x) => x.wrap), [false, true, true, true, false])
  assert.equal(c[4].line, undefined)
  assert.deepEqual(c[1].reported, { text: 'reported: done', note: '#902 merged' })
  assert.ok(c[1].detail.some((d) => d.key === 'Reported' && d.value === 'done: #902 merged'))
})

test('rowCells: the parent row has progress and no status; a problem names its reference', () => {
  const tasks = [t('r', 'now', 'root'), t('a', 'next', 'a', { parent: 'r', dependsOn: ['release notes'] }), t('b', 'next', 'b', { parent: 'a' })]
  const rows = boardRows({ tasks })
  const flags = boardFlags(tasks)
  const c = rows.map((r) => rowCells(r, flags.filter((f) => f.item === r.item)))
  assert.equal(c[0].parent, true)
  assert.equal(c[0].status, undefined)
  assert.deepEqual(c[0].progress, { done: 0, dropped: 0, total: 1, needsYou: 0 })
  assert.deepEqual(c[1].problems, ["Blocked by 'release notes' (not on the board)"])
  assert.deepEqual([c[1].indent, c[1].elbow, c[2].indent, c[2].elbow], [0, false, 1, true])
})

test('boardSegments: one per child of the parent row, a kind per shape, tooltips that say why', () => {
  const tasks = [
    t('r', 'now', 'root'),
    t('1', 'done', 'a', { parent: 'r' }),
    t('2', 'now', 'b', { parent: 'r', model: 'opus', effort: 'high' }),
    t('3', 'waiting', 'c', { parent: 'r', waitingOn: 'CI' }),
    t('4', 'waiting', 'd', { parent: 'r', waitingOn: 'owner' }),
    t('5', 'next', 'e', { parent: 'r', dependsOn: ['1'] }),
    t('6', 'next', 'f', { parent: 'r', dependsOn: ['3', 'ghost'] }),
    t('7', 'dropped', 'g', { parent: 'r' }),
  ]
  const s = boardSegments({ tasks }, boardRows({ tasks }), 'r')
  assert.deepEqual(s.segments.map((g) => g.kind), ['done', 'now', 'waiting', 'needs you', 'ready', 'blocked', 'dropped'])
  assert.equal(new Set(s.segments.map((g) => g.kind)).size, 7, 'blocked and waiting differ')
  assert.equal(s.segments[1].tooltip, 'b · now · opus high')
  assert.equal(s.segments[2].tooltip, 'c · waiting · on CI')
  assert.equal(s.segments[5].tooltip, "f · blocked by 3 (waiting), 'ghost' (not on the board)")
  assert.deepEqual([s.done, s.dropped, s.total, s.continuous], [1, 1, 7, false])
  const many = [t('r', 'now', 'r'), ...Array.from({ length: SEGMENT_MAX + 1 }, (_, i) => t(String(i), 'next', 'w', { parent: 'r' }))]
  assert.equal(boardSegments({ tasks: many }, boardRows({ tasks: many }), 'r').continuous, true)
  const fewer = many.slice(0, -1)
  assert.equal(boardSegments({ tasks: fewer }, boardRows({ tasks: fewer }), 'r').continuous, false)
})

test('boardSegments counts what the parent row\'s progress counts: a now child with children is a now segment', () => {
  // The live board's shape: #888 is now, with a done child #889, and a task outside the root.
  const tasks = [
    t('883', 'now', 'root'),
    t('1', 'done', 'a', { parent: '883' }),
    t('3', 'now', 'b', { parent: '883' }),
    t('3b', 'done', 'c', { parent: '3' }),
    t('9', 'done', 'apart'),
  ]
  const rows = boardRows({ tasks })
  const s = boardSegments({ tasks }, rows, '883')
  assert.deepEqual(s.segments.map((g) => [g.item, g.kind]), [['1', 'done'], ['3', 'now']])
  const p = rows.find((r) => r.item === '883').progress
  assert.deepEqual([s.done, s.dropped, s.total], [p.done, p.dropped, p.total], 'the bar and the text agree')
  assert.deepEqual(boardSegments({ tasks }, rows, 'nope').segments, [])
})

test('driftState and driftWords: not run, failed, matches, differs', () => {
  const rows = (drift) => boardRows({ drift, tasks: [t('1', 'waiting', 'a'), t('2', 'waiting', 'b')] })
  assert.equal(driftWords(driftState(undefined, [])), 'not run yet')
  const failed = driftState({ checkedAt: 'x', error: 'exit 3' }, [])
  assert.deepEqual(failed, { kind: 'failed', error: 'exit 3', at: 'x' })
  assert.equal(driftWords(driftState({ checkedAt: 'x', checked: 2, items: [] }, rows())), 'matches')
  const one = { checkedAt: 'x', items: [{ item: '1', status: 'done' }] }
  assert.equal(driftWords(driftState(one, rows(one))), '1 differs')
  const two = { checkedAt: 'x', items: [{ item: '1', status: 'done' }, { item: '2', status: 'done' }] }
  assert.equal(driftWords(driftState(two, rows(two))), '2 differ')
})
