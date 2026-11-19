// The built browser bundle, client/client.js, without a browser: run it in a
// VM with a stub module loader and a stub React that expands function
// components, then check the tab registration and what the tab draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { bundle } from '../client/build.mjs'

const code = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

/** The bundle's exports; useState gives a row's open state (false unless open). */
function load({ open = false, primitives, measured = 0, prefs } = {}) {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    // A bar's measured width is the only useState(0): measured gives it.
    useState: (init) => [typeof init === 'function' ? init() : init === false ? open : init === 0 ? measured : init, () => {}],
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
    useMemo: (fn) => fn(),
  }
  let row
  const store = new Map(prefs ? [['dsh-cockpit.view', JSON.stringify(prefs)]] : [])
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (r) => { row = r } } }, localStorage })
  const exports = row.factory((name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives' && primitives) return primitives
    throw new Error('unexpected require ' + name)
  })
  return { row, exports }
}

/** Every rendered element, function components expanded. */
function nodes(view, options) {
  const { exports } = load(options)
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }))
    out.push(n)
    walk(n.children)
  }
  walk(exports.BoardView({ view, now: Date.UTC(2026, 9, 25, 8) }))
  return out
}

const BLOCK = new Set(['li', 'div', 'p', 'header', 'section', 'dd', 'button', 'dt'])
function render(view, options) {
  const { exports } = load(options)
  const text = (n) => {
    if (n === null || n === undefined || n === false) return ''
    if (Array.isArray(n)) return n.map(text).join('')
    if (typeof n !== 'object') return String(n)
    if (typeof n.type === 'function') return text(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }))
    if (n.type === 'svg') return ''
    return text(n.children) + (BLOCK.has(n.type) ? '\n' : '')
  }
  return text(exports.BoardView({ view, now: Date.UTC(2026, 9, 25, 8) })).replace(/[ \t]+/g, ' ')
}
const cls = (n) => n.props.className || ''
/** The CSS without the lit graph line's flow, the one motion the board allows. */
const stillCss = (css) => css.split('\n').filter((l) => !/dshc-flow|path\[data-edge=depends\]\[data-lit\]\{animation/.test(l)).join('\n')
const within = (all, item) => {
  const li = all.find((n) => n.type === 'li' && n.props['data-item'] === item)
  const out = []
  const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children })); out.push(n); walk(n.children) }
  walk(li)
  return out
}

const PARENT = 'Romany-Saad/resturants-app#883'
const live = {
  key: 'sim-883',
  links: { issue: 'https://github.com/{repo}/issues/{number}', pr: 'https://github.com/{repo}/pull/{number}' },
  board: {
    key: 'sim-883', parent: PARENT, revision: 25, updatedAt: '2026-10-25T07:51:00Z',
    tasks: [
      { item: '883', what: 'effort', status: 'now', issue: '#883' },
      { item: '1', what: 'Profile and guard', status: 'waiting', why: 'CI still running.', issue: '#884', pr: '#892', waitingOn: 'user', nextAction: 'You: once CI is green, merge PR #892 by hand.', readyCommand: 'gh pr merge 892 --squash', parent: '883' },
      { item: '2', what: 'Log reader', status: 'done', issue: '#888', pr: '#889', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', parent: '883' },
      { item: '5', what: 'Live checks and docs', status: 'next', why: 'Needs item 1 merged.', issue: 'romany-saad/dsh-plugins#1', nextAction: 'Hub: start once #892 merges.', parent: '883', dependsOn: ['1', '2', 'release notes'] },
      { item: '6b', what: 'Board rule in Bosla', status: 'waiting', waitingOn: 'release', startWhen: 'dsh-cockpit 0.1 released', parent: '883', dependsOn: ['5'], readyCommand: 'git worktree add x -b y' },
      { item: '7', what: 'Old approach', status: 'dropped', nextAction: 'stale', parent: '883' },
    ],
  },
}

test('the bundle is what client/build.mjs builds from the sources', () => {
  assert.equal(code, bundle(), 'run node client/build.mjs')
})

/** apply() against a stub ctx: the tab, the slots and what openTab was asked. */
function register(exports) {
  const calls = { tabs: [], slots: [], opened: [], sessions: [], aside: [], refresh: [] }
  exports.apply({
    effect: (fn) => fn(),
    sidebarRightTabs: { register: (d) => { calls.tabs.push(d); return () => {} } },
    sidebarRight: { openTab: (kind, options) => { calls.opened.push([kind, options]) }, openResource: (address, options) => calls.aside.push([address, options]) },
    sessions: { refreshProjections: (id) => calls.refresh.push(id) },
    uiWorkspace: { openSession: (address) => calls.sessions.push(address) },
    slots: { inject: (_name, fn) => fn(), register: (entry, Component) => { calls.slots.push({ entry, Component }); return () => {} } },
  })
  return calls
}

test('the bundle registers the Board tab, the five tool cards and the strip; materializing it requires only react', () => {
  const { row, exports } = load()
  assert.equal(row.id, '@rs-dsh/dsh-cockpit')
  assert.deepEqual([...exports.inject], ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'uiWorkspace'], 'sessions and uiWorkspace for the Agents view')
  const calls = register(exports)
  assert.equal(calls.tabs.length, 1)
  assert.equal(calls.tabs[0].id, '@rs-dsh/dsh-cockpit')
  assert.equal(calls.tabs[0].title(), 'Board', 'still "Board" in 0.1')
  assert.deepEqual(calls.slots.map((s) => [s.entry.name, s.entry.key ?? s.entry.id]), [
    ['sidebar.right.pane.tab', '@rs-dsh/dsh-cockpit'],
    ['tool.call.toolview', 'board_open'], ['tool.call.toolview', 'board_read'], ['tool.call.toolview', 'board_add'], ['tool.call.toolview', 'board_update'], ['tool.call.toolview', 'board_inbox'], ['tool.call.toolview', 'board_process'],
    ['conversation.input.dock', 'dsh-cockpit-progress'],
  ])
  const tabProps = calls.slots[0].entry.inject('s1')
  assert.equal(tabProps.sessionId, 's1')
  // The Agents view's actions go where DSH's subagent dropdown sends them.
  const address = { parentSessionId: 'root', childSessionId: 'a', mode: 'continuable' }
  tabProps.agents.open(address)
  tabProps.agents.aside(address)
  tabProps.agents.refresh('a')
  assert.equal(JSON.stringify(calls.sessions), JSON.stringify([address]))
  assert.equal(JSON.stringify(calls.aside), JSON.stringify([['dsh-resource://subagentchat/session/a?parent=root&mode=continuable', { kind: 'subagentchat', preferNewPane: true }]]))
  assert.equal(JSON.stringify(calls.refresh), '["a"]')
  const dock = calls.slots[7].entry
  assert.equal(dock.order, 30, 'after the Todo, Goal and Queue docks')
  const props = dock.inject('s1')
  assert.equal(props.sessionId, 's1')
  props.openBoard()
  props.openBoard('5')
  assert.equal(JSON.stringify(calls.opened), JSON.stringify([['dsh-cockpit-board', undefined], ['dsh-cockpit-board', { params: { item: '5' } }]]))
})

test('header: key and parent left, revision and time right; the drift line only when configured or present', () => {
  const out = render(live)
  assert.match(out, /sim-883Romany-Saad\/resturants-app#883rev 25 · \d\d:51 · \d+ min ago/)
  assert.ok(!out.includes('Drift'))
  assert.ok(render({ ...live, driftConfigured: true }).includes('Drift: not run yet'))
  const drift = { checkedAt: '2026-10-25T07:40:00Z', checked: 3, items: [{ item: '6b', status: 'done', note: 'released' }] }
  const d = render({ ...live, board: { ...live.board, drift } })
  assert.match(d, /Drift: 1 differs · \d\d:40/)
  assert.ok(d.includes('reported: done'), 'the row tag says "reported", not "drift"')
  assert.match(render({ ...live, board: { ...live.board, drift: { checkedAt: '2026-10-25T07:40:00Z', checked: 3, items: [] } } }), /Drift: matches/)
  const { exports } = load()
  const at = new Date(2026, 9, 25, 15, 22, 0)
  assert.equal(exports.headerMeta({ revision: 3, updatedAt: at.toISOString() }, at.getTime() + 9 * 60000), 'rev 3 · 15:22 · 9 min ago')
  assert.equal(exports.whenText(at.toISOString(), at.getTime() + 3 * 86400000), '2026-10-25 15:22 · 3 d ago')
  assert.equal(exports.whenText(at.toISOString(), at.getTime() - 30000), '15:22 · just now', 'changed since the minute tick')
  assert.equal(exports.whenText(at.toISOString(), at.getTime() - 5 * 60000), '15:22 · in the future')
  assert.equal(exports.headerMeta({ key: 'k' }, at.getTime()), '', 'a fallback file without revision or updatedAt')
})

test('Needs you: only waitingOn user, with the ask as written, Open PR and the command', () => {
  const out = render(live)
  const at = out.indexOf('Needs you')
  assert.ok(at >= 0 && at < out.indexOf('Log reader'), out)
  for (const s of ['#884 Profile and guard', 'You: once CI is green, merge PR #892 by hand.', 'Open PR #892', 'gh pr merge 892 --squash', 'Copy']) assert.ok(out.slice(at).includes(s), s)
  assert.equal(out.split('You: once CI is green').length, 2, 'the ask shows once, in the card')
  assert.ok(out.includes('Needs you · see top'))
  const none = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => ({ ...t, waitingOn: t.item === '1' ? undefined : t.waitingOn })) } }
  assert.ok(!render(none).includes('Needs you'), 'no guess from nextAction')
  const open = nodes(live).find((n) => cls(n) === 'dshc-open')
  assert.equal(open.props.href, 'https://github.com/Romany-Saad/resturants-app/pull/892')
})

test('legacy owner waits render identically to canonical user waits', () => {
  const legacy = { ...live, board: { ...live.board, tasks: live.board.tasks.map((task) => task.waitingOn === 'user' ? { ...task, waitingOn: ' Owner ' } : task) } }
  assert.equal(render(legacy), render(live))
  assert.equal(strip(legacy).m.line, strip(live).m.line)
})

test('Needs you: no id column; the step id is in the title\'s tooltip, and the ask and command span the card', () => {
  const card = nodes(live).find((n) => cls(n) === 'dshc-ni')
  assert.ok(card, 'the card')
  assert.ok(!nodes(live).some((n) => /\bdshc-id\b/.test(cls(n))), 'no id column to leave empty under it')
  const title = nodes(live).find((n) => /dshc-nit/.test(cls(n)))
  assert.equal(title.props.title, 'Step 1', 'the full id on hover')
  const { exports } = load()
  assert.match(exports.CSS, /\.dshc-ni\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;/)
  assert.match(exports.CSS, /\.dshc-ask\{grid-column:1\/-1;/, 'the ask starts at the card\'s left edge')
  assert.match(exports.CSS, /\.dshc-ni \.dshc-cmd\{grid-column:1\/-1;/)
})

test('rows: mark · title · PR columns, tree order, a mark by shape, and dropped struck through and counted apart', () => {
  const all = nodes(live)
  assert.deepEqual(all.filter((n) => n.type === 'li').map((n) => n.props['data-item']), ['883', '1', '2', '5', '6b', '7'])
  const rowOf = (item) => within(all, item).find((n) => cls(n) === 'dshc-row')
  for (const item of ['1', '2', '5', '6b', '7']) {
    const cells = rowOf(item).children.filter(Boolean).slice(0, 3)
    assert.deepEqual(cells.map((k) => cls(k).split(' ').pop()), ['dshc-cst', 'dshc-ct', 'dshc-cpr'], item)
    // The status word: no column, but the mark's tooltip and accessible name.
    // A next step says ready or blocked too, as its bar segment does (#5 waits on open #1).
    assert.equal(cells[0].props.title, item === '5' ? 'next · blocked' : live.board.tasks.find((t) => t.item === item).status)
    assert.equal(cells[0].props['aria-label'], cells[0].props.title)
  }
  // The parent row is its section's header: title, then its count; no mark column.
  const cell = (k) => (typeof k.type === 'function' ? k.type({ ...k.props, children: k.props.children }) : k)
  assert.deepEqual(rowOf('883').children.filter(Boolean).slice(0, 2).map((k) => cls(cell(k)).split(' ')[0]), ['dshc-ct', 'dshc-hdcount'])
  assert.ok(!all.some((n) => /\bdshc-cid\b/.test(cls(n))), 'no id column')
  const { exports } = load()
  assert.match(exports.CSS, /\.dshc-row\{display:grid;grid-template-columns:16px minmax\(0,1fr\) auto 20px;/)
  assert.match(exports.CSS, /\.dshc-parentrow \.dshc-row\{grid-template-columns:minmax\(0,1fr\) auto;/, 'no empty chevron column on a parent with nothing to open')
  assert.match(exports.CSS, /\.dshc-parentrow \.dshc-row\[data-expandable\]\{grid-template-columns:minmax\(0,1fr\) auto 20px\}/, 'the same 10 px right edge as the overall card, so the bars line up')
  assert.match(exports.CSS, /\.dshc-parentrow \.dshc-cmeta,\.dshc-parentrow \.dshc-detail\{grid-column:1\/-1\}/, 'the bar spans the section')
  assert.ok(!/animation|transition/.test(stillCss(exports.CSS)), 'nothing moves')
  const mark = (item) => within(all, item).find((n) => cls(n) === 'dshc-mk')?.props['data-mark']
  assert.deepEqual(['2', '5', '1', '6b', '7'].map(mark), ['done', 'blocked', 'needs-you', 'waiting', 'dropped'], 'a waiting step that needs you is marked apart; blocked #5 as its segment')
  // One size for every mark: a 12 px circle with DSH's 1.5 px step ring.
  assert.match(exports.CSS, /\.dshc-mk\{box-sizing:border-box;[^}]*width:12px;height:12px;border-radius:50%;corner-shape:round;border:1\.5px solid/, 'round, not DSH\'s default squircle')
  assert.ok(!/\.dshc-(dot|ring|dash)\{/.test(exports.CSS), 'no smaller drawn dots left')
  assert.match(cls(all.find((n) => n.type === 'li' && n.props['data-item'] === '7')), /dshc-dropped/)
  assert.match(exports.CSS, /\.dshc-dropped \.dshc-tt\{text-decoration:line-through\}/)
  assert.ok(render(live).includes('1 of 5 done · 1 dropped · 1 needs you'))
})

test('with the host\'s ui-primitives: the StateDot step for done at the marks\' one size, the host icons; now stays still', () => {
  const used = []
  const comp = (name) => { const f = (props) => { used.push([name, props]); return { type: 'host-' + name, props, children: [] } }; return f }
  const primitives = Object.fromEntries(['StateDot', 'IconWarningTriangleOutlineRegular', 'IconRightUpOutlineRegular', 'IconChevronRightOutlineRegular', 'IconChevronDownOutlineRegular', 'IconCopyOutlineRegular'].map((n) => [n, comp(n)]))
  const all = nodes(live, { primitives })
  const dots = used.filter(([n]) => n === 'StateDot').map(([, p]) => [p.state, p.appearance, p.size])
  assert.deepEqual(dots, [['done', 'step', 12]], 'done #2 only: the same 12 px as the drawn marks')
  assert.ok(!dots.some(([s]) => s === 'ongoing'), 'never the spinner: nothing moves')
  for (const n of ['IconWarningTriangleOutlineRegular', 'IconRightUpOutlineRegular', 'IconChevronRightOutlineRegular', 'IconCopyOutlineRegular']) assert.ok(used.some(([u]) => u === n), n)
  const mark = (item) => within(all, item).find((n) => cls(n) === 'dshc-mk')?.props['data-mark']
  assert.deepEqual(['5', '6b', '7'].map(mark), ['blocked', 'waiting', 'dropped'], 'the statuses with no StateDot step are drawn in its style')
})

test('rows: no "Next:" label; Waiting on <who>; Start when; blocked by short refs; problems name the reference', () => {
  const out = render(live)
  assert.ok(!out.includes('Next:'))
  assert.ok(out.includes('Hub: start once #892 merges.'))
  assert.ok(out.includes('Waiting on release'))
  assert.ok(!out.includes('You: You:'))
  assert.ok(out.includes('Blocked by #884 (waiting)'))
  assert.ok(out.includes('Blocked by dsh-plugins#1 (next)'), 'a cross-repo blocker is short too')
  const at = out.indexOf('Board data problems')
  assert.ok(at > 0 && at < out.indexOf('Log reader'))
  assert.ok(out.includes("Unknown dependency: 'release notes' on romany-saad/dsh-plugins#1"), out)
  assert.ok(out.includes("Blocked by 'release notes' (not on the board)"), 'and in place on the row')
  assert.ok(!out.includes('stale'), 'a dropped row has no wait line')
})

test('titles: a short cross-repo reference, the full one in its link; open titles wrap, closed ones truncate', () => {
  const all = nodes(live)
  const five = within(all, '5')
  const a = five.find((n) => n.type === 'a' && n.props.title === 'romany-saad/dsh-plugins#1')
  assert.deepEqual(a.children.flat(), ['dsh-plugins#1'])
  assert.equal(a.props.href, 'https://github.com/romany-saad/dsh-plugins/issues/1')
  assert.equal(a.props.target, '_blank')
  assert.equal(a.props.rel, 'noopener noreferrer')
  const title = (item) => within(all, item).find((n) => /dshc-tt/.test(cls(n)))
  assert.match(cls(title('5')), /dshc-wrap/)
  assert.match(cls(title('2')), /dshc-trunc/)
  assert.equal(title('2').props.title, '#888 Log reader · step 2', 'a truncated title in full, with the step id')
  assert.equal(title('5').props.title, 'step 5', 'a wrapped title shows in full; its tooltip has the id')
})

test('links: the PR cell is the link through the links config; with no patterns nothing but full URLs links', () => {
  const pr = (view, item) => { const all = within(nodes(view), item); const at = all.findIndex((n) => cls(n) === 'dshc-cpr'); return all[at + 1] }
  assert.equal(pr(live, '2').props.href, 'https://github.com/Romany-Saad/resturants-app/pull/889')
  assert.deepEqual(pr(live, '2').children.flat(), ['PR #889'])
  const plain = { ...live, links: {} }
  assert.deepEqual(nodes(plain).filter((n) => n.type === 'a'), [], 'no github.com built in')
  assert.equal(pr(plain, '2').type, 'span')
  assert.ok(!render(plain).includes('Open PR'))
  const full = { ...plain, board: { ...plain.board, tasks: plain.board.tasks.map((t) => (t.item === '2' ? { ...t, pr: 'https://git.example/r/pull/889' } : t)) } }
  assert.equal(pr(full, '2').props.href, 'https://git.example/r/pull/889')
})

test('board text is only text: no markup, and only http(s) becomes an href', () => {
  const evil = { key: 'k', links: { issue: 'https://t.example/{ref}' }, board: { key: 'k', revision: 1, tasks: [
    { item: '1', what: '<img src=x onerror=alert(1)>', status: 'next', issue: 'javascript:alert(1)', pr: 'javascript:alert(2)', nextAction: '<b>hi</b>', readyCommand: '$(rm -rf ~)' },
  ] } }
  const all = nodes(evil, { open: true })
  for (const a of all.filter((n) => n.type === 'a')) assert.match(a.props.href, /^https?:\/\//)
  assert.ok(!all.some((n) => 'dangerouslySetInnerHTML' in n.props))
  const out = render(evil, { open: true })
  assert.ok(out.includes('<img src=x onerror=alert(1)>') && out.includes('<b>hi</b>') && out.includes('$(rm -rf ~)'))
  const { exports } = load()
  assert.equal(exports.safeUrl('javascript:alert(1)'), undefined)
  assert.equal(exports.safeUrl('https://x.example/'), 'https://x.example/')
})

test('the expanded row: a key/value grid with Start when, Model and the command box', () => {
  const out = render(live, { open: true })
  for (const s of ['Start when\ndsh-cockpit 0.1 released', 'Model\nclaude-opus-5-5 · high', 'Reason\nNeeds item 1 merged.', 'git worktree add x -b y']) assert.ok(out.includes(s), s + ' in\n' + out)
  assert.equal(nodes(live).filter((n) => 'data-command-box' in n.props).length, 1, 'collapsed: only the Needs you card')
  assert.equal(nodes(live, { open: true }).filter((n) => 'data-command-box' in n.props).length, 2)
  const chev = nodes(live).filter((n) => cls(n) === 'dshc-chev')
  assert.ok(chev.length && chev.every((n) => n.props['aria-expanded'] === false))
})

test('the parent row: a now child with children is a now segment, and the bar counts what the text counts', () => {
  const view = { key: 'k', board: { key: 'k', revision: 1, tasks: [
    { item: 'r', what: 'root', status: 'now' },
    { item: '1', what: 'a', status: 'done', parent: 'r' },
    { item: '3', what: 'b', status: 'now', parent: 'r', model: 'opus', effort: 'high' },
    { item: '3b', what: 'c', status: 'done', parent: '3' },
  ] } }
  const segs = within(nodes(view), 'r').filter((n) => 'data-segment' in n.props)
  assert.deepEqual(segs.map((s) => [s.props['data-item'], s.props['data-segment']]), [['1', 'done'], ['3', 'now']])
  assert.equal(segs[1].props.title, 'b · now · opus high')
  assert.ok(render(view).includes('1 of 2 done'))
  assert.equal(segs.filter((s) => s.props['data-segment'] === 'done').length, 1, 'as many done segments as the text counts')
})

test('the parent row: progress in words and the thin bar, one segment per child, by shape', () => {
  const all = nodes(live)
  const segs = within(all, '883').filter((n) => 'data-segment' in n.props)
  assert.deepEqual(segs.map((s) => [s.props['data-item'], s.props['data-segment']]), [['1', 'needs you'], ['2', 'done'], ['5', 'blocked'], ['6b', 'waiting'], ['7', 'dropped']])
  assert.equal(segs[3].props.title, 'Board rule in Bosla · waiting · on release')
  const { exports } = load()
  for (const kind of ['done', 'now', 'waiting', '"needs you"', 'ready', 'blocked', 'dropped']) assert.ok(exports.CSS.includes('[data-segment=' + kind + ']'), kind)
  assert.match(exports.CSS, /\[data-segment=blocked\]\{border:1px dashed/)
  // now: the left half filled with the info accent and an info outline, never solid, never moving; the half in whole px once measured.
  assert.match(exports.CSS, /\[data-segment=now\]\{background:linear-gradient\(to right,var\(--dshc-info\) var\(--dshc-half\),transparent var\(--dshc-half\)\);box-shadow:inset 0 0 0 1px var\(--dshc-info\)\}/)
  assert.doesNotMatch(exports.CSS, /\[data-segment=now\]\{[^}]*(animation|transition)/)
  assert.match(exports.CSS, /\[data-segment=waiting\]\{background:/)
})

test('the Board tab groups each root tree separately, with a whole-board leaf bar and a local bar for every root parent', () => {
  const view = { key: 'forest', board: { key: 'forest', tasks: [
    { item: 'a', what: 'First project', status: 'now' },
    { item: 'a1', what: 'Finished work', status: 'done', parent: 'a' },
    { item: 'a2', what: 'Nested project', status: 'now', parent: 'a' },
    { item: 'a21', what: 'Nested work', status: 'waiting', waitingOn: 'CI', parent: 'a2' },
    { item: 'b', what: 'Second project', status: 'now' },
    { item: 'b1', what: 'Ready work', status: 'next', parent: 'b' },
    { item: 'publish', what: 'Publish release', status: 'waiting', waitingOn: 'release' },
    { item: 'old', what: 'Abandoned task', status: 'dropped' },
  ] } }
  const all = nodes(view)
  const overall = all.find((n) => cls(n) === 'dshc-overall')
  assert.ok(overall, 'a dedicated overall section')
  assert.equal(overall.type, 'section')
  assert.equal(overall.props['aria-label'], 'Whole board')
  assert.ok(textOf(overall).includes('Whole board'))
  const segments = (ns) => ns.filter((n) => 'data-segment' in n.props).map((n) => [n.props['data-item'], n.props['data-segment']])
  assert.deepEqual(segments(expand(overall)), [
    ['a1', 'done'], ['a21', 'waiting'], ['b1', 'ready'], ['publish', 'waiting'], ['old', 'dropped'],
  ], 'all leaves, including standalone tasks, but no parent tasks')
  const groups = all.filter((n) => 'data-board-group' in n.props)
  assert.deepEqual(groups.map((n) => [n.type, n.props['data-board-group']]), [
    ['section', 'a'], ['section', 'b'], ['section', 'standalone'],
  ])
  const rows = (section) => expand(section).filter((n) => n.type === 'li').map((n) => n.props['data-item'])
  assert.deepEqual(groups.map(rows), [['a', 'a1', 'a2', 'a21'], ['b', 'b1'], ['publish', 'old']])
  assert.ok(textOf(groups[2]).includes('Standalone tasks'))
  // Inspect the root's own bar, not its nested parent's bar or the overall bar.
  const localSegments = (item) => segments(within(all, item))
  assert.deepEqual(localSegments('a'), [['a1', 'done'], ['a2', 'now']], 'direct children, not descendant leaves')
  assert.deepEqual(localSegments('b'), [['b1', 'ready']], 'a second parent still has its local bar')
})

test('the whole-board bar runs in the order of the sections below it, standalone tasks last', () => {
  const view = { key: 'mixed', board: { key: 'mixed', tasks: [
    { item: 'early', what: 'Standalone first in the file', status: 'waiting', waitingOn: 'CI' },
    { item: 'a', what: 'Project', status: 'now' },
    { item: 'a1', what: 'Work', status: 'done', parent: 'a' },
    { item: 'mid', what: 'Standalone between parents', status: 'next' },
    { item: 'b', what: 'Other project', status: 'now' },
    { item: 'b1', what: 'More work', status: 'now', parent: 'b' },
  ] } }
  const all = nodes(view)
  const overall = all.find((n) => cls(n) === 'dshc-overall')
  const bar = expand(overall).filter((n) => 'data-segment' in n.props).map((n) => n.props['data-item'])
  const groups = all.filter((n) => 'data-board-group' in n.props)
  assert.deepEqual(groups.map((n) => n.props['data-board-group']), ['a', 'b', 'standalone'])
  const drawn = groups.flatMap((g) => expand(g).filter((n) => n.type === 'li').map((n) => n.props['data-item']))
  assert.deepEqual(bar, ['a1', 'b1', 'early', 'mid'])
  assert.deepEqual(bar, drawn.filter((i) => i !== 'a' && i !== 'b'), 'the bar follows the sections')
})

test('the Board tab keeps the whole-board summary for a single tree and groups flat roots as standalone tasks', () => {
  const single = nodes(live)
  assert.equal(single.filter((n) => cls(n) === 'dshc-overall').length, 1)
  assert.deepEqual(single.filter((n) => 'data-board-group' in n.props).map((n) => n.props['data-board-group']), ['883'])
  const flat = nodes({ key: 'flat', board: { key: 'flat', tasks: [
    { item: 'one', what: 'First task', status: 'done' },
    { item: 'two', what: 'Second task', status: 'next' },
  ] } })
  const groups = flat.filter((n) => 'data-board-group' in n.props)
  assert.deepEqual(groups.map((n) => n.props['data-board-group']), ['standalone'])
  assert.ok(textOf(groups[0]).includes('Standalone tasks'))
  const overall = flat.find((n) => cls(n) === 'dshc-overall')
  assert.ok(overall)
  assert.deepEqual(expand(overall).filter((n) => 'data-segment' in n.props).map((n) => n.props['data-item']), ['one', 'two'])
})

test('card error and stopped text use the tab colour names, set on the card in both themes', () => {
  const { exports } = load()
  assert.match(exports.CSS, /\.dshc-card-sum\[data-state=error\]\{color:var\(--dshc-err\)\}/)
  assert.match(exports.CSS, /\.dshc-card-sum\[data-state=stopped\]\{color:var\(--dshc-warn\)\}/)
  // The colour names are defined on the card root in light and overridden in dark, as on the tab and the strip.
  assert.match(exports.CSS, /\[data-dsh-cockpit-dock\],\[data-dsh-cockpit-card\]\{--dshc-l0:/)
  assert.match(exports.CSS, /body\[data-ds-dark-theme\] \[data-dsh-cockpit-card\]\{--dshc-t:[^}]*--dshc-warn:var\(--dsw-alias-state-warn-label\)[^}]*--dshc-err:var\(--dsw-alias-state-error-primary\)\}/)
  // Only the card's own rules: no second copy of the light mixes.
  assert.doesNotMatch(exports.CSS, /\.dshc-card-sum\[data-state=\w+\]\{color:color-mix/)
})

test('the empty state and a board that cannot be shown', () => {
  const out = render({ key: null, boards: ['a'] })
  assert.ok(out.includes('No board in this session'))
  assert.ok(out.includes('An agent opens a board when it starts work with several steps. The board shows here after that.'))
  assert.ok(render({ key: 'k', error: 'no such board' }).includes('k: no such board'))
})

test('the CommandBox copy state machine: Copied, Copy failed, back to Copy', async () => {
  const { exports } = load()
  assert.equal(exports.copyStep('idle', 'copied'), 'copied')
  assert.equal(exports.copyStep('idle', 'failed'), 'failed')
  assert.equal(exports.copyStep('copied', 'reset'), 'idle')
  const got = []
  assert.equal(await exports.copyText('x', { writeText: async (t) => { got.push(t) } }), 'copied')
  assert.deepEqual(got, ['x'])
  assert.equal(await exports.copyText('x', { writeText: async () => { throw new Error('denied') } }), 'failed')
  assert.equal(await exports.copyText('x', undefined), 'failed')
  assert.match(exports.CSS, /\.dshc-cmd code\{[^}]*white-space:pre-wrap;overflow-wrap:anywhere/)
})

// ---- The progress strip ----

/** Text and nodes of any element tree, function components expanded. */
function expand(node) {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }))
    out.push(n)
    walk(n.children)
  }
  walk(node)
  return out
}
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node !== 'object') return String(node)
  if (typeof node.type === 'function') return textOf(node.type({ ...node.props, children: node.children.length ? node.children : node.props.children }))
  if (node.type === 'svg') return ''
  return textOf(node.children)
}
const strip = (view, openBoard) => { const { exports } = load(); const m = exports.dockModel(view); return { m, tree: exports.StripView({ m, openBoard }) } }
const withTasks = (view, fn) => ({ ...view, board: { ...view.board, tasks: fn(view.board.tasks) } })

test('the strip, needs you: "⚠ Needs you: <action> · Copy command · Board ›", copying the ready command', () => {
  const { m, tree } = strip(live)
  assert.equal(m.kind, 'needs you')
  assert.equal(m.line, '⚠ Needs you: You: once CI is green, merge PR #892 by hand. · Copy command · Board ›')
  assert.equal(textOf(tree), 'Needs you: You: once CI is green, merge PR #892 by hand.Copy command·Board ›', 'the action as written, no key or count')
  const all = expand(tree)
  const copy = all.find((n) => n.type === 'button' && n.props['data-copy-state'] === 'idle')
  assert.equal(copy.props['aria-label'], 'Copy command for #884 Profile and guard')
  const two = withTasks(live, (ts) => ts.map((t) => (t.item === '6b' ? { ...t, waitingOn: 'Owner' } : t)))
  assert.equal(strip(two).m.line, '⚠ 2 need you · Board ›', 'two asks: a count and no Copy')
  assert.ok(!expand(strip(two).tree).some((n) => n.props['data-copy-state']))
})

test('the strip, normal: "<key> · N of M done · <focus> · Board ›"; blocked names the blocker and its status, then in progress', () => {
  const calm = withTasks(live, (ts) => ts.map((t) => (t.item === '1' ? { ...t, status: 'done', waitingOn: undefined } : t)))
  const { m, tree } = strip(calm)
  assert.equal(m.kind, 'normal')
  assert.equal(m.line, "sim-883 · 2 of 5 done · 1 dropped · dsh-plugins#1 blocked by 'release notes' (not on the board) · Board ›")
  assert.ok(textOf(tree).includes('sim-883'))
  const blocked = withTasks(calm, (ts) => ts.map((t) => (t.item === '5' ? { ...t, dependsOn: ['1'] } : t.item === '1' ? { ...t, status: 'now' } : t)))
  assert.equal(strip(blocked).m.focus, 'dsh-plugins#1 blocked by #884 (now)', 'the blocker and its status, short refs as the titles show them')
  const busy = withTasks(calm, (ts) => ts.filter((t) => t.item !== '5' && t.item !== '6b').map((t) => (t.item === '2' ? { ...t, status: 'now' } : t)))
  assert.equal(strip(busy).m.focus, 'in progress: #888 Log reader')
  const two = withTasks(busy, (ts) => ts.map((t) => (t.item === '1' ? { ...t, status: 'now' } : t)))
  assert.equal(strip(two).m.focus, '2 in progress: #884, #888')
  const done = withTasks(calm, (ts) => ts.filter((t) => t.item === '883' || t.item === '2'))
  assert.equal(strip(done).m.line, 'sim-883 · 1 of 1 done · Board ›')
})

test('the strip: whole-board leaf segments, each with a tooltip; nothing moves', () => {
  const { exports } = load()
  const { m, tree } = strip(live)
  const overall = nodes(live).find((n) => cls(n) === 'dshc-overall')
  assert.ok(overall, 'the Board tab has a whole-board summary')
  const rowSegs = expand(overall).filter((n) => 'data-segment' in n.props).map((s) => [s.props['data-item'], s.props['data-segment'], s.props.title])
  const stripSegs = expand(tree).filter((n) => 'data-segment' in n.props).map((s) => [s.props['data-item'], s.props['data-segment'], s.props.title])
  assert.deepEqual(stripSegs, rowSegs, 'one segment model')
  assert.ok(stripSegs.every((s) => s[2]), 'every segment has a tooltip')
  assert.equal(m.done, '1 of 5 done · 1 dropped')
  assert.ok(!/animation|transition/.test(stillCss(exports.CSS)))
  // A board without one parent row: one segment per work task (a row without children).
  const flat = { key: 'f', board: { key: 'f', tasks: [{ item: '1', what: 'a', status: 'done' }, { item: '2', what: 'b', status: 'next', dependsOn: ['1'] }] } }
  assert.deepEqual([...strip(flat).m.bar.segments.map((s) => s.kind)], ['done', 'ready'])
  assert.equal(strip(flat).m.line, 'f · 1 of 2 done · Board ›')
  const epics = { key: 'e', board: { key: 'e', tasks: ['a', 'b'].flatMap((p) => [{ item: p, what: p, status: 'now' }, ...[1, 2, 3].map((i) => ({ item: p + i, what: p + i, status: i === 1 ? 'done' : 'next', parent: p }))]) } }
  assert.equal(strip(epics).m.done, '2 of 6 done', 'two epics: their work tasks, not the epics')
  assert.deepEqual([...strip(epics).m.bar.segments.map((s) => s.item)], ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'])
})

test('the rendered strip includes a waiting top-level task outside a completed parent (#23)', () => {
  const view = { key: 'release', board: { key: 'release', tasks: [
    { item: 'root', what: 'Implementation', status: 'done' },
    { item: 'build', what: 'Build', status: 'done', parent: 'root' },
    { item: 'publish', what: 'Publish', status: 'waiting', waitingOn: 'CI' },
  ] } }
  const { m, tree } = strip(view)
  assert.equal(m.line, 'release · 1 of 2 done · Board ›')
  const segments = expand(tree).filter((n) => 'data-segment' in n.props)
  assert.deepEqual(segments.map((n) => [n.props['data-item'], n.props['data-segment']]), [
    ['build', 'done'], ['publish', 'waiting'],
  ])
  assert.equal(segments[1].props.title, 'Publish · waiting · on CI')
})

test('the strip at narrow widths: the action or focus first, then the count, the segments, and the key last; the full text in the tooltip', () => {
  const { exports } = load()
  // The key drops below 600 px of strip; Board ›, Copy command and the count never shrink.
  assert.match(exports.CSS, /@container dshc-strip \(max-width:600px\)\{\.dshc-strip \.dshc-key,\.dshc-strip \.dshc-key\+\.dshc-sep\{display:none\}\}/)
  assert.match(exports.CSS, /\.dshc-strip \.dshc-done,\.dshc-strip \.dshc-go,\.dshc-strip \.dshc-copy,\.dshc-strip \.dshc-ic\{flex:none\}/)
  assert.match(exports.CSS, /\.dshc-strip \.dshc-focus\{flex:1 1 auto;min-width:0\}/)
  assert.match(exports.CSS, /\.dshc-strip \.dshc-barbox\{flex:0 1000 auto/, 'the segments give way before the text')
  // The full text is the strip's tooltip.
  const calm = withTasks(live, (ts) => ts.map((t) => (t.item === '1' ? { ...t, status: 'done', waitingOn: undefined } : t)))
  const bar = (view) => expand(strip(view).tree).find((n) => n.props.className === 'dshc-strip')
  assert.equal(bar(calm).props.title, "sim-883 · 2 of 5 done · 1 dropped · dsh-plugins#1 blocked by 'release notes' (not on the board)")
  assert.equal(bar(live).props.title, '⚠ Needs you: You: once CI is green, merge PR #892 by hand. (#884 Profile and guard) · 1 of 5 done · 1 dropped')
  // Below 460 px: the continuous fill instead of the segments, no "· 1 dropped", and no bar beside a needs-you action.
  const all = expand(strip(calm).tree)
  assert.ok(all.some((n) => n.props.className === 'dshc-barbox dshc-alt'))
  assert.deepEqual(all.find((n) => n.props.className === 'dshc-more').children, [' · 1 dropped'])
  assert.match(exports.CSS, /@container dshc-strip \(max-width:460px\)\{\.dshc-strip \.dshc-barbox\[data-alt\],\.dshc-strip \.dshc-more,\.dshc-strip\[data-kind="needs you"\] \.dshc-barbox\{display:none\}\.dshc-strip \.dshc-alt\{display:block\}\}/)
  assert.match(exports.CSS, /@container dshc-strip \(max-width:380px\)\{\.dshc-strip \.dshc-barbox\{display:none\}\}/)
})

test('the strip\'s Copy command announces its result, as the CommandBox does', () => {
  const all = expand(strip(live).tree)
  const copy = all.find((n) => n.props.className === 'dshc-copy')
  assert.ok(copy, 'the shared CopyButton')
  assert.ok(expand(copy).some((n) => n.props.role === 'status'))
})

test('the strip above 24 segments is one continuous bar', () => {
  const tasks = [{ item: 'r', what: 'root', status: 'now' }, ...Array.from({ length: 25 }, (_, i) => ({ item: String(i), what: 'w' + i, status: i < 5 ? 'done' : 'next', parent: 'r' }))]
  const big = { key: 'big', board: { key: 'big', tasks } }
  const all = expand(strip(big).tree)
  assert.equal(all.filter((n) => 'data-segment' in n.props).length, 0)
  assert.ok(all.some((n) => n.props.className === 'dshc-fill'))
  const at24 = { ...big, board: { ...big.board, tasks: tasks.slice(0, 25) } }
  assert.equal(expand(strip(at24).tree).filter((n) => 'data-segment' in n.props).length, 24)
})

// ---- The segmented bar's geometry, shared by the parent row and the strip ----

test('segment widths: whole pixels that, with the 1 px gaps, fill the bar exactly; the leftover to the first segments', () => {
  const { exports } = load()
  for (const [width, n] of [[120, 5], [347, 7], [348.6, 7], [100, 1], [263, 24], [300, 24], [64, 3], [10, 1], [21, 2]]) {
    const w = exports.segmentWidths(width, n)
    assert.equal(w.length, n)
    assert.ok(w.every((x) => Number.isInteger(x) && x >= 10), width + '/' + n + ': whole px, at least 10')
    assert.equal(w.reduce((a, b) => a + b, 0) + (n - 1), Math.floor(width), width + '/' + n + ': the sum and the gaps fill the bar')
    assert.ok(Math.max(...w) - Math.min(...w) <= 1)
    const extra = w.filter((x) => x > w[n - 1]).length
    assert.ok(w.slice(0, extra).every((x) => x === w[0]) && w.slice(extra).every((x) => x === w[n - 1]), 'the wider ones come first')
  }
  // 347 - 6 gaps = 341 = 7 * 48 + 5: five segments of 49 px, then two of 48.
  assert.deepEqual([...exports.segmentWidths(347, 7)], [49, 49, 49, 49, 49, 48, 48])
  // A fractional width is rounded down first: 348.6 is 348 px.
  assert.deepEqual([...exports.segmentWidths(348.6, 7)], [49, 49, 49, 49, 49, 49, 48])
  // The 'now' half and the continuous fill are whole pixels too.
  assert.equal(exports.halfFill(49), 24)
  assert.equal(exports.halfFill(48), 24)
  assert.ok(Number.isInteger(exports.fillWidth(347, 1, 3)))
  assert.equal(exports.fillWidth(347, 3, 3), 347)
})

test('segment corners: square, except the first one\'s left end and the last one\'s right end, 4 px (half the 8 px height); one segment is round at both', () => {
  const { exports } = load()
  assert.deepEqual([0, 1, 2].map((i) => exports.segmentRadius(i, 3)), ['4px 0 0 4px', '0 0 0 0', '0 4px 4px 0'])
  assert.deepEqual([0, 1].map((i) => exports.segmentRadius(i, 2)), ['4px 0 0 4px', '0 4px 4px 0'])
  assert.equal(exports.segmentRadius(0, 1), '4px 4px 4px 4px')
  assert.match(exports.CSS, /\.dshc-seg\{flex:none;min-width:10px;height:8px;border-radius:0;/)
  assert.match(exports.CSS, /\.dshc-bar\{display:flex;gap:1px;height:8px\}/)
  // The continuous bar: the same 8 px height and round ends.
  assert.match(exports.CSS, /\.dshc-fill\{display:flex;gap:1px;height:8px;border-radius:4px;/)
  // No half pixel in the bar's rules: no .5 px, no 1.5 px.
  const bar = exports.CSS.split('\n').filter((l) => /dshc-(seg|bar|fill)/.test(l)).join('\n')
  assert.doesNotMatch(bar, /\d\.\d+px/)
})

test('segment fallback: n segments at 10 px with 1 px gaps, else one continuous bar', () => {
  const { exports } = load()
  // Five segments need 5 * 10 + 4 = 54 px.
  assert.ok(exports.segmentsFit(54, 5))
  assert.ok(!exports.segmentsFit(53, 5))
  assert.ok(exports.segmentsFit(54.9, 5))
  assert.equal(exports.segmentWidths(53, 5), undefined)
  assert.ok(exports.segmentsFit(10, 1) && !exports.segmentsFit(9, 1))
  assert.equal(exports.stripBarWidth({ segments: Array(5) }), 54, 'the strip asks for the room the segments need')
  assert.equal(exports.stripBarWidth({ segments: Array(24) }), 120)
  assert.equal(exports.stripBarWidth({ segments: Array(30), continuous: true }), 72)
  // A desktop strip: about 28 px a segment, from 120 px up to a quarter of the strip (at most 280).
  assert.equal(exports.stripBarWidth({ segments: Array(5) }, 639), 54, 'below 640 px: as before')
  assert.equal(exports.stripBarWidth({ segments: Array(5) }, 716), 144)
  assert.equal(exports.stripBarWidth({ segments: Array(3) }, 920), 120)
  assert.equal(exports.stripBarWidth({ segments: Array(24) }, 920), 230)
  assert.equal(exports.stripBarWidth({ segments: Array(24) }, 1400), 280)
  assert.equal(exports.stripBarWidth({ segments: Array(30), continuous: true }, 920), 230)
  const bar = { segments: [1, 2, 3, 4, 5].map((i) => ({ item: String(i), kind: 'done', tooltip: 't' })), continuous: false, done: 5, dropped: 0, total: 5 }
  const at = (measured) => expand(load({ measured }).exports.Bar({ bar }))
  // Measured wide enough: whole-pixel widths and the corner rule inline.
  const fit = at(54).filter((n) => 'data-segment' in n.props)
  assert.deepEqual(fit.map((s) => s.props.style.width), [10, 10, 10, 10, 10])
  assert.deepEqual(fit.map((s) => s.props.style.borderRadius), ['4px 0 0 4px', '0 0 0 0', '0 0 0 0', '0 0 0 0', '0 4px 4px 0'])
  assert.equal(at(54).find((n) => n.props.className === 'dshc-bar').props.style.width, 54)
  // One pixel short: the continuous bar, in whole pixels.
  const narrow = at(53)
  assert.equal(narrow.filter((n) => 'data-segment' in n.props).length, 0)
  const fill = narrow.find((n) => n.props.className === 'dshc-fill')
  assert.equal(fill.props.style.width, 53)
  // All five done: one run, the whole width.
  assert.deepEqual(expand(fill).filter((n) => n.props['data-run']).map((n) => [n.props['data-run'], n.props.style.width]), [['done', 53]])
})

test('the strip opens the Board tab: the strip at its focus row, a segment at its own row, without the click going twice', () => {
  const opened = []
  const { tree } = strip(live, (item) => opened.push(item))
  const all = expand(tree)
  const bar = all.find((n) => n.props.role === 'button' && n.props.className === 'dshc-strip')
  assert.equal(bar.props.tabIndex, 0, 'keyboard reachable')
  assert.equal(bar.props['aria-label'], '⚠ Needs you: You: once CI is green, merge PR #892 by hand. · Copy command · Board ›')
  bar.props.onClick({ stopPropagation() {} })
  const seg = all.find((n) => n.props['data-item'] === '5' && 'data-segment' in n.props)
  let stopped = false
  seg.props.onClick({ stopPropagation: () => { stopped = true } })
  all.find((n) => n.type === 'button' && textOf(n) === 'Board ›').props.onClick({ stopPropagation() {} })
  assert.deepEqual(opened, ['1', '5', '1'])
  assert.ok(stopped)
})

test('the strip hides without a bound board that parsed', () => {
  const { exports } = load()
  for (const view of [undefined, { key: null, boards: ['a'] }, { key: 'k', error: 'no such board' }]) assert.equal(exports.dockModel(view), undefined)
  const dock = register(exports).slots.find((s) => s.entry.name === 'conversation.input.dock')
  assert.equal(dock.Component({ sessionId: 's' }), null, 'nothing while the first poll runs')
})

// ---- The chat cards ----

const card = (props, extra) => load(extra).exports.toolCardModel(props)
const argsOf = (o) => JSON.stringify(o)

test('a card\'s title comes from lib/present.js on the arguments, then the result\'s meta title', () => {
  assert.equal(card({ toolName: 'board_update', phase: 'preparing', block: { name: 'board_update' } }).state, 'running')
  assert.equal(card({ toolName: 'board_update', phase: 'start', block: { argsRaw: argsOf({ item: '3', set: { status: 'waiting', pr: '#902' } }) } }).summary, 'update 3 → waiting: pr #902')
  const open = { call: { argsRaw: argsOf({ key: 'sim-883' }) }, meta: { title: 'open sim-883 (new)' }, content: [{ type: 'text', text: '{"ok":true,"tree":"1  now  #883"}' }], isError: false }
  const m = card({ toolName: 'board_open', phase: 'result', block: open })
  assert.deepEqual([m.state, m.title, m.summary], ['ok', 'Board', 'open sim-883 (new)'])
  assert.equal(load().exports.cardBody(m), '1  now  #883', 'opened: the tree text')
  const noMeta = { ...open, meta: undefined, call: { argsRaw: argsOf({ item: '2', remove: true }) } }
  assert.equal(card({ toolName: 'board_update', phase: 'result', block: noMeta }).summary, 'remove 2')
})

test('a failed {ok:false} card shows its code; a thrown error and an interruption say so', () => {
  const failed = { call: { argsRaw: '{}' }, content: [{ type: 'text', text: '{"ok":false,"code":"not_bound","message":"m"}' }], isError: false, meta: { title: 'x' } }
  const f = card({ toolName: 'board_read', phase: 'result', block: failed })
  assert.deepEqual([f.state, f.summary], ['error', 'read board · not_bound'])
  const thrown = { call: { argsRaw: argsOf({ key: 'k' }) }, content: [{ type: 'text', text: 'Error: boom' }], isError: true }
  assert.equal(card({ toolName: 'board_open', phase: 'result', block: thrown }).summary, 'open k · failed')
  const stopped = { ...thrown, error: { name: 'x', code: 'interrupted' } }
  assert.equal(card({ toolName: 'board_open', phase: 'result', block: stopped }).state, 'stopped')
})

test('a settled card whose call left the loaded window reads its arguments from the node\'s args view', () => {
  const view = (o) => ({ value: (k) => o[k] })
  const gone = { call: null, args: view({ item: '3', set: { status: 'done' } }), content: [{ type: 'text', text: '{"ok":true}' }], isError: false }
  assert.equal(card({ toolName: 'board_update', phase: 'result', block: gone }).summary, 'update 3 → done')
  const failed = { call: null, args: view({ key: 'k' }), content: [{ type: 'text', text: 'Error: boom' }], isError: true }
  assert.equal(card({ toolName: 'board_open', phase: 'result', block: failed }).summary, 'open k · failed')
})

test('the fallback card row opens from the keyboard', () => {
  const block = { call: { argsRaw: '{"key":"k"}' }, content: [{ type: 'text', text: '{"ok":true,"tree":"T"}' }], isError: false }
  let toggled = 0
  const Row = register(load().exports).slots.find((s) => s.entry.key === 'board_open').Component
  const head = expand(Row({ toolName: 'board_open', phase: 'result', block, useDisclosure: () => ({ expanded: false, toggle: () => { toggled++ } }) })).find((n) => n.props.role === 'button')
  const target = {}
  head.props.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault() {} })
  head.props.onKeyDown({ key: ' ', target, currentTarget: target, preventDefault() {} })
  assert.equal(toggled, 2)
})

test('a row is looked up in its own board, never another body\'s', () => {
  const { exports } = load()
  assert.match(exports.CSS, /\.dshc-strip \.dshc-go\{/, 'the strip\'s Board › rule is scoped; the problems arrow keeps its own')
  assert.doesNotMatch(exports.CSS, /(^|\n|\})\.dshc-go\{/)
  const prob = nodes(live).find((n) => n.props.className === 'dshc-prob')
  const asked = []
  const root = { querySelector: (sel) => { asked.push(sel); return null } }
  prob.props.onClick({ currentTarget: { closest: () => root } })
  assert.deepEqual(asked, ['li[data-item="5"]'])
})

test('the card renders folded and opens to the result, through the host\'s DisclosureRow when the shell has it', () => {
  const block = { call: { argsRaw: argsOf({ key: 'sim-883' }) }, meta: { title: 'open sim-883' }, content: [{ type: 'text', text: '{"ok":true,"tree":"TREE"}' }], isError: false }
  const row = (expanded, primitives) => {
    const { exports } = load(primitives ? { primitives } : undefined)
    const Row = register(exports).slots.find((s) => s.entry.key === 'board_open').Component
    return Row({ toolName: 'board_open', phase: 'result', block, useDisclosure: () => ({ expanded, toggle() {} }) })
  }
  assert.ok('data-dsh-cockpit-card' in row(false).props, 'the card root carries the colour names')
  assert.ok(!textOf(row(false)).includes('TREE'), 'folded')
  assert.match(textOf(row(false)), /Board.*open sim-883/)
  assert.ok(textOf(row(true)).includes('TREE'), 'opened')
  const seen = []
  const DisclosureRow = (p) => { seen.push(p); return { type: 'div', props: {}, children: [p.title, p.collapsedContent, p.children] } }
  const withRow = row(true, { DisclosureRow })
  assert.ok('data-dsh-cockpit-card' in withRow.props)
  assert.ok(textOf(withRow).includes('TREE'))
  assert.deepEqual([seen[0].title, seen[0].expandable, seen[0].open, seen[0].expandOnRowClick], ['Board', true, true, true])
})


// ---- The Inbox (#51) ----

const withInbox = (view, inbox) => ({ ...view, board: { ...view.board, inbox } })
const INBOX = [
  { id: 'i1', text: 'Dark mode for the strip', state: 'open', source: 'chat' },
  { id: 'i2', text: 'Export the board as Markdown', state: 'refined', refinedInto: ['5', '6b'], refinedWith: 'grill-me' },
  { id: 'i3', text: 'Old idea', state: 'dropped', note: 'covered by #884' },
  { id: 'i4', text: 'Gone', state: 'dropped', clearedAt: '2026-10-25T07:00:00Z' },
]
/** A fill that records what it put in the message box, and answers result. */
const filler = (result = 'filled') => { const calls = []; const fill = (text) => { calls.push(text); return result }; fill.calls = calls; return fill }
const inboxOfView = (view, fill) => {
  const { exports } = load()
  return expand(exports.BoardView({ view, now: Date.UTC(2026, 9, 25, 8), fill }))
}

test('the Inbox: items not cleared, with what they became; refined and dropped are told apart', () => {
  const out = render(withInbox(live, INBOX))
  assert.ok(out.includes('Inbox 1 open'))
  assert.ok(out.includes('Dark mode for the strip'))
  assert.ok(out.includes('refined → 5, 6b · with grill-me'))
  assert.ok(out.includes('dropped') && out.includes('covered by #884'))
  assert.ok(!out.includes('Gone'), 'a cleared item is not shown')
  assert.ok(out.indexOf('Inbox') < out.indexOf('effort'), 'above the tree')
  const all = nodes(withInbox(live, INBOX))
  assert.deepEqual(all.filter((n) => n.props['data-inbox-item']).map((n) => [n.props['data-inbox-item'], n.props['data-state']]), [['i1', 'open'], ['i2', 'refined'], ['i3', 'dropped']])
  assert.ok(!render(live).includes('Inbox'), 'no section without items or a message box')
})

test('the Inbox buttons fill the message box and write nothing: Refine, Refine all, Clear, Add', () => {
  const two = withInbox(live, [...INBOX, { id: 'i5', text: 'Second', state: 'open' }])
  const fill = filler()
  const all = inboxOfView(two, fill)
  const button = (label, within) => all.find((n) => n.type === 'button' && textOf(n) === label && (!within || n.props.title.includes(within)))
  button('Refine', 'i1').props.onClick()
  button('Refine all').props.onClick()
  button('Clear', 'i2').props.onClick()
  assert.deepEqual(fill.calls, ['/cockpit-refine i1', '/cockpit-refine', 'Clear inbox item i2.'])
  assert.equal(all.filter((n) => n.type === 'button' && textOf(n) === 'Refine').length, 2, 'one per open item')
  assert.equal(all.filter((n) => n.type === 'button' && textOf(n) === 'Clear').length, 2, 'one per refined or dropped item')
  assert.ok(!inboxOfView(withInbox(live, INBOX), fill).some((n) => n.type === 'button' && textOf(n) === 'Refine all'), 'Refine all only with two open items')
  // Without a message box (no inputActions), no buttons at all.
  assert.ok(!nodes(two).some((n) => n.type === 'button' && /^(Refine|Clear|Add)/.test(textOf(n))))
})

test('Add item: the empty board and a board with no items offer it; Enter fills "Add to the inbox: …"', () => {
  const fill = filler()
  const empty = inboxOfView({ key: null, boards: [] }, fill)
  assert.ok(empty.some((n) => n.props['data-inbox-add'] !== undefined), 'with no board too: the first item opens one')
  const form = inboxOfView(live, fill).find((n) => n.props['data-inbox-add'] !== undefined)
  assert.ok(form, 'a board without items still offers Add item')
  assert.equal(form.children.find((c) => c.type === 'input').props.placeholder, 'Add item…')
})

test('useFill: fills an empty message box; a draft or a busy box is left as it is', () => {
  const { exports } = load()
  const set = []
  const actions = { setDraft: (t) => set.push(t) }
  // useInput is a selector hook, as the slot passes it: it must be called with a selector.
  const hook = (state) => (selector, equal) => {
    assert.equal(typeof selector, 'function', 'useInput takes a selector')
    assert.equal(typeof equal, 'function')
    return selector(state)
  }
  assert.equal(exports.useFill(hook({ draft: '', phase: 'plain', attachmentIds: [] }), actions)('x'), 'filled')
  assert.equal(exports.useFill(hook({ draft: 'my draft', phase: 'plain' }), actions)('y'), 'draft')
  assert.equal(exports.useFill(hook({ draft: '', phase: 'submitting' }), actions)('z'), 'unavailable')
  assert.deepEqual(set, ['x'])
  assert.equal(exports.useFill(() => ({}), undefined), undefined, 'no box: no buttons')
})

test('the strip counts open Inbox items apart from the tasks, and shows with items only', () => {
  const calm = withTasks(live, (ts) => ts.map((t) => (t.item === '1' ? { ...t, status: 'done', waitingOn: undefined } : t)))
  const { m, tree } = strip(withInbox(calm, INBOX))
  assert.equal(m.inbox, '1 in inbox')
  assert.equal(m.line, "sim-883 · 2 of 5 done · 1 dropped · 1 in inbox · dsh-plugins#1 blocked by 'release notes' (not on the board) · Board ›")
  assert.ok(m.tooltip.includes(' · 1 in inbox · '))
  assert.ok(textOf(tree).includes('1 dropped·1 in inbox·'), textOf(tree))
  const needs = strip(withInbox(live, INBOX)).m
  assert.ok(needs.line.endsWith('Copy command · 1 in inbox · Board ›'), needs.line)
  assert.equal(m.bar.total, 5, 'items are not segments')
  const onlyInbox = strip({ key: 'session-1', board: { key: 'session-1', tasks: [], inbox: [INBOX[0]] } })
  assert.equal(onlyInbox.m.line, 'session-1 · 1 in inbox · Board ›', 'no "0 of 0 done" and no bar')
  assert.equal(textOf(onlyInbox.tree), 'session-1·1 in inboxBoard ›', 'one separator, none left dangling')
  assert.ok(!expand(onlyInbox.tree).some((n) => n.props['data-segment'] || n.props.className === 'dshc-fill'))
})

test('a board_inbox card: its title from lib/present.js, the new id and an opened board from the result', () => {
  const args = { action: 'add', text: 'dark mode for the strip' }
  assert.equal(card({ phase: 'start', toolName: 'board_inbox', block: { argsRaw: argsOf(args) } }).summary, 'inbox: add "dark mode for the strip"')
  assert.equal(card({ phase: 'start', toolName: 'board_inbox', block: { argsRaw: argsOf({ action: 'clear', id: ['i1', 'i2'] }) } }).summary, 'inbox: clear i1, i2')
  assert.equal(card({ phase: 'start', toolName: 'board_add', block: { argsRaw: argsOf({ what: 'x', refines: ['i3'] }) } }).summary, 'add next "x" · next · from i3')
})


// ---- Process map and Flow (#52) ----

test('header shows Process line when process info is present', () => {
  const withProc = { ...live, process: { revision: 4, stagesCount: 8 } }
  const out = render(withProc)
  assert.ok(out.includes('Process: rev 4 · 8 stages'))
})

test('compact view shows stage track on flow items; stage tag shows on materialized stage tasks', () => {
  const flowTask = {
    item: 'f1', what: 'Feature work', status: 'next',
    flow: {
      revision: 1,
      stages: [
        { id: 'refine', title: 'Refine', status: 'done' },
        { id: 'build', title: 'Build', status: 'now' },
        { id: 'verify', title: 'Verify', status: 'waiting' },
        { id: 'docs', title: 'Docs', status: 'next' },
      ],
      skipped: { docs: 'no docs needed' },
    },
  }
  const stageChild = {
    item: 'c1', what: 'Build implementation', status: 'now', parent: 'f1', stage: 'build',
  }
  const view = {
    key: 'flow-board',
    board: { key: 'flow-board', tasks: [flowTask, stageChild] },
  }
  const out = render(view)
  assert.ok(out.includes('Refine ✓'))
  assert.ok(out.includes('Build ●'))
  assert.ok(out.includes('Verify …'))
  assert.ok(!out.includes('Docs'), 'skipped stage is not in track')
  assert.ok(out.includes('stage: build'))
  assert.ok(nodes(view).some((n) => n.type === 'button' && textOf(n) === 'Expanded'), 'the flow toggle on the view bar')
})

// ---- Needs you toggle, graph view, the overall bar ----

const J = (v) => JSON.parse(JSON.stringify(v))
const expandAll = (root) => {
  const flat = []
  const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children })); flat.push(n); walk(n.children) }
  walk(root)
  return flat
}

test('Needs you: its title shows or hides the cards and keeps the count', () => {
  const sec = nodes(live).find((n) => 'data-needs-you' in n.props)
  const toggle = expand(sec).find((n) => 'data-needs-you-toggle' in n.props)
  assert.equal(toggle.type, 'button')
  assert.equal(toggle.props['aria-expanded'], true)
  assert.match(textOf(toggle), /^Needs you1Hide/)
  assert.ok(expand(sec).some((n) => cls(n) === 'dshc-ni'))
  const { exports } = load()
  const board = live.board
  const flat = expandAll(exports.NeedsYou({ board, rows: exports.boardRows(board), byItem: new Map(board.tasks.map((t) => [t.item, t])), hidden: true }))
  const hidden = flat.find((n) => 'data-needs-you' in n.props)
  assert.ok('data-hidden' in hidden.props)
  assert.ok(!flat.some((n) => cls(n) === 'dshc-ni'), 'hidden: no cards')
  assert.match(textOf(hidden), /Needs you1Show/, 'hidden: one line with the count and Show')
  // The choice is kept in this browser.
  const kept = load({ prefs: { needsYouHidden: true } }).exports
  assert.ok(!expandAll(kept.BoardView({ view: live, now: 0 })).some((n) => cls(n) === 'dshc-ni'))
})

test('the overall bar is the first card of the sections, with a key of each state', () => {
  const all = nodes(live)
  const groups = all.find((n) => cls(n) === 'dshc-groups')
  const kids = expand(groups)
  assert.equal(cls(kids.find((n) => cls(n) === 'dshc-overall' || 'data-board-group' in n.props)), 'dshc-overall', 'before the first group')
  assert.ok(!expand(all.find((n) => n.type === 'header')).some((n) => cls(n) === 'dshc-overall'), 'no longer in the header')
  const overall = kids.find((n) => cls(n) === 'dshc-overall')
  const legend = expand(overall).find((n) => 'data-legend' in n.props)
  assert.ok(legend)
  for (const s of ['1 done', '1 dropped', '1 needs you']) assert.ok(textOf(legend).includes(s), s + ' in ' + textOf(legend))
})

test('stackRuns: one whole-pixel run per state, in order, filling the bar exactly', () => {
  const { exports } = load()
  const seg = (k, n) => Array.from({ length: n }, () => ({ kind: k }))
  const segs = [...seg('waiting', 3), ...seg('done', 10), ...seg('now', 1), ...seg('blocked', 16)]
  const runs = exports.stackRuns(segs, 200)
  assert.deepEqual(J(runs.map((r) => r.kind)), ['done', 'now', 'waiting', 'blocked'])
  assert.equal(runs.reduce((a, r) => a + r.width, 0) + runs.length - 1, 200)
  assert.ok(runs.every((r) => Number.isInteger(r.width) && r.width >= 2))
  // Too narrow: every state still keeps 2 px.
  assert.deepEqual(J(exports.stackRuns([...seg('done', 40), ...seg('now', 1)], 32).map((r) => r.width)), [29, 2])
  assert.deepEqual(J(exports.stackRuns(segs, 0).map((r) => Math.round(r.pct))), [33, 3, 10, 53])
  // A bar above 24 tasks is one fill with every state, not only done.
  const tasks = [{ item: 'r', what: 'root', status: 'now' }, ...Array.from({ length: 25 }, (_, i) => ({ item: String(i), what: 'w' + i, status: i < 5 ? 'done' : i < 7 ? 'now' : 'next', parent: 'r' }))]
  const board = { key: 'b', tasks }
  const bar = exports.boardSegments(board, exports.boardRows(board), undefined)
  assert.equal(bar.continuous, true)
  const fill = expandAll(exports.Bar({ bar })).find((n) => cls(n) === 'dshc-fill')
  assert.deepEqual(expandAll(fill).filter((n) => n.props['data-run']).map((n) => n.props['data-run']), ['done', 'now', 'ready'])
  assert.match(fill.props['aria-label'], /5 done, 2 in progress, 18 ready/)
})

test('graphLayout: a parent is a box holding its steps; steps sit below what they depend on; whole pixels in the width', () => {
  const { exports } = load()
  const list = [
    { item: 'p' }, { item: 'a', parent: 'p' }, { item: 'b', parent: 'p', dependsOn: ['a'] }, { item: 'c', parent: 'p' },
    { item: 'loose' }, { item: 'x', dependsOn: ['x', 'missing', 'b'] },
  ]
  const g = exports.graphLayout(list, { width: 300 })
  const at = Object.fromEntries(g.nodes.map((n) => [n.item, n]))
  assert.equal(at.p.container, true)
  assert.ok(['a', 'b', 'c', 'loose', 'x'].every((i) => at[i].container === false))
  const inside = (o, i) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h
  assert.ok(['a', 'b', 'c'].every((i) => inside(at.p, at[i])), 'the steps are inside their parent\'s box')
  assert.ok(!inside(at.p, at.loose) && !inside(at.p, at.x))
  assert.equal(at.p.w, 300, 'a box takes the full width')
  assert.ok(at.a.y < at.b.y, 'b below a, which it depends on')
  assert.ok(at.x.y >= at.p.y + at.p.h, 'x depends on b inside p, so it sits below the whole box')
  assert.ok(g.nodes.every((n) => n.x >= 0 && n.x + n.w <= 300 && [n.x, n.y, n.w, n.h].every(Number.isInteger)))
  assert.deepEqual(J(g.edges.map((e) => [e.from, e.to, e.kind])), [['a', 'b', 'depends'], ['b', 'x', 'depends']], 'only dependencies are lines; no self or unknown ones')
  assert.ok(exports.graphLayout(list, { width: 140 }).nodes.every((n) => n.x + n.w <= 140), 'a narrow tab still fits')
  // Nested parents nest their boxes; a parent loop and a dependency cycle do not hang.
  const deep = exports.graphLayout([{ item: 'r' }, { item: 'm', parent: 'r' }, { item: 'l', parent: 'm' }], { width: 300 })
  const d = Object.fromEntries(deep.nodes.map((n) => [n.item, n]))
  assert.ok(d.r.container && d.m.container && !d.l.container && inside(d.r, d.m) && inside(d.m, d.l))
  const loop = exports.graphLayout([{ item: '1', parent: '2', dependsOn: ['2'] }, { item: '2', parent: '1', dependsOn: ['1'] }], { width: 300 })
  assert.equal(loop.nodes.filter(Boolean).length, 2)
  assert.ok(Number.isFinite(loop.height))
})

test('the graph view: a List | Graph switch; parents as boxes with their steps inside; the overall bar above', () => {
  const { exports } = load({ prefs: { mode: 'graph' } })
  const flat = expandAll(exports.BoardView({ view: live, now: 0 }))
  assert.deepEqual(flat.filter((n) => 'data-view' in n.props).map((n) => [n.props['data-view'], n.props['aria-pressed']]), [['list', false], ['graph', true], ['agents', false]])
  assert.ok(flat.some((n) => 'data-graph' in n.props))
  const boxes = flat.filter((n) => cls(n) === 'dshc-gc').map((n) => n.props['data-item'])
  const steps = flat.filter((n) => cls(n) === 'dshc-gn').map((n) => n.props['data-item'])
  const parents = new Set(live.board.tasks.map((t) => t.parent).filter(Boolean))
  assert.deepEqual(boxes.sort(), [...parents].sort(), 'each parent is a box')
  assert.deepEqual([...new Set([...boxes, ...steps])].sort(), [...new Set(live.board.tasks.map((t) => t.item))].sort(), 'every task once')
  const box = flat.find((n) => cls(n) === 'dshc-gc')
  assert.ok(expandAll(box).some((n) => cls(n) === 'dshc-gch'), 'its header: mark, title and count')
  assert.match(textOf(box), /of \d+ done/)
  assert.equal(box.props.role, 'button')
  assert.equal(box.props.tabIndex, 0)
  assert.ok(!flat.some((n) => n.props['data-edge'] === 'parent'), 'no parent lines')
  assert.ok(!/parent → step/.test(textOf(flat.find((n) => 'data-graph' in n.props))), 'no parent line in the key')
  assert.ok(!flat.some((n) => cls(n).startsWith('dshc-li')), 'no list rows in the graph')
  assert.ok(flat.some((n) => cls(n) === 'dshc-overall'), 'the overall bar stays above the graph')
})

test('a board_process card: its title from lib/present.js', () => {
  assert.equal(card({ phase: 'start', toolName: 'board_process', block: { argsRaw: argsOf({ action: 'read' }) } }).summary, 'process: read')
  assert.equal(card({ phase: 'start', toolName: 'board_process', block: { argsRaw: argsOf({ action: 'propose' }) } }).summary, 'process: propose')
  assert.equal(card({ phase: 'result', toolName: 'board_process', block: { argsRaw: argsOf({ action: 'save' }), meta: { title: 'process: save · rev 2' }, content: [{ type: 'text', text: JSON.stringify({ ok: true, saved: true, map: { revision: 2 } }) }] } }).summary, 'process: save · rev 2')
})

test('header shows warning when processDrift is reported', () => {
  const withDrift = {
    ...live,
    processDrift: {
      changed: ['CONTRIBUTING.md'],
      message: 'Process may be out of date: CONTRIBUTING.md changed',
    },
  }
  const out = render(withDrift)
  assert.ok(out.includes('Process may be out of date: CONTRIBUTING.md changed'))
})


// ---- Send on click (rc.3) ----

test('Inbox buttons queue the request when sending is on: Refine, Refine all and Clear; Add item stays a fill', () => {
  const calls = []
  const actions = { setDraft: (t) => calls.push(['draft', t]), submit: (...a) => calls.push(['submit', ...a]) }
  const hook = (state) => (selector, equal) => selector(state)
  const { exports } = load()
  const fill = exports.useFill(hook({ draft: '', phase: 'plain', queue: [] }), actions, true)
  assert.equal(fill('/cockpit-refine i1', { send: true }), 'sent')
  assert.deepEqual(calls, [['draft', '/cockpit-refine i1'], ['submit', 'queue', 'click']])
  calls.length = 0
  assert.equal(fill('Add to the inbox: x'), 'filled', 'no send option: only filled')
  assert.deepEqual(calls, [['draft', 'Add to the inbox: x']])
})

test('sending is off with the config switch or without a submit action: the button only fills', () => {
  const calls = []
  const hook = (state) => (selector) => selector(state)
  const { exports } = load()
  const off = exports.useFill(hook({ draft: '', phase: 'plain' }), { setDraft: (t) => calls.push(t), submit: () => calls.push('submit') }, false)
  assert.equal(off('x', { send: true }), 'filled')
  const none = exports.useFill(hook({ draft: '', phase: 'plain' }), { setDraft: (t) => calls.push(t) }, true)
  assert.equal(none('y', { send: true }), 'filled')
  assert.deepEqual(calls, ['x', 'y'])
})

test('a draft in the box is never sent or replaced, and queued messages do not block a click', () => {
  const calls = []
  const actions = { setDraft: (t) => calls.push(['draft', t]), submit: () => calls.push(['submit']) }
  const hook = (state) => (selector) => selector(state)
  const { exports } = load()
  assert.equal(exports.useFill(hook({ draft: 'my text', phase: 'plain', queue: [] }), actions, true)('x', { send: true }), 'draft')
  assert.equal(exports.useFill(hook({ draft: '', phase: 'submitting', queue: [] }), actions, true)('x', { send: true }), 'unavailable')
  assert.deepEqual(calls, [], 'nothing was written')
  // Messages waiting for their turn: the click still queues behind them.
  const queued = exports.useFill(hook({ draft: '', phase: 'submitting', queue: [{ id: 'm1' }] }), actions, true)
  assert.equal(queued('/cockpit-refine i2', { send: true }), 'sent')
  const plainQueued = exports.useFill(hook({ draft: '', phase: 'plain', queue: [{ id: 'm1' }, { id: 'm2' }] }), actions, true)
  assert.equal(plainQueued('/cockpit-refine', { send: true }), 'sent')
  assert.equal(calls.filter((c) => c[0] === 'submit').length, 2)
})

test('the buttons ask for a send; the Add item field does not', () => {
  const asked = []
  const fill = (text, options) => { asked.push([text, options && options.send === true]); return 'sent' }
  const all = inboxOfView(withInbox(live, [...INBOX, { id: 'i5', text: 'Second', state: 'open' }]), fill)
  const click = (label, within) => all.find((n) => n.type === 'button' && textOf(n) === label && (!within || n.props.title.includes(within))).props.onClick()
  click('Refine', 'i1'); click('Refine all'); click('Clear', 'i2')
  assert.deepEqual(asked.map((a) => a[1]), [true, true, true])
})

test('a nested row: its meta lines and detail start where its title text does, not at the row edge', () => {
  const { exports } = load()
  assert.equal(exports.titleInset({ indent: 0, elbow: false }), 0)
  assert.equal(exports.titleInset({ indent: 1, elbow: false }), 16)
  assert.equal(exports.titleInset({ indent: 2, elbow: true }), 48, 'two indent steps and the elbow')
  assert.match(exports.CSS, /\.dshc-row>\.dshc-cmeta,\.dshc-row>\.dshc-detail\{margin-left:var\(--dshc-in,0px\)\}/)
  const view = { key: 'deep', board: { key: 'deep', tasks: [
    { item: 'p', what: 'Parent', status: 'now' },
    { item: 'a', what: 'Child', status: 'now', parent: 'p' },
    { item: 'b', what: 'Grandchild', status: 'now', parent: 'a', why: 'A reason', nextAction: 'Do it' },
  ] } }
  const rowOf = (all, item) => within(all, item).find((n) => cls(n) === 'dshc-row')
  const all = nodes(view, { open: true })
  assert.equal(rowOf(all, 'b').props.style['--dshc-in'], '32px', 'the indent (16) and the elbow (16)')
  assert.ok(within(all, 'b').some((n) => cls(n) === 'dshc-detail'), 'the detail is open and inherits the inset')
  assert.equal(rowOf(all, 'a').props.style?.['--dshc-in'], undefined, 'a depth-1 row has no inset')
})

test('a ready row has no "ready" tag; the bar still marks it ready and a blocked row still says so', () => {
  const view = { key: 'r', board: { key: 'r', tasks: [
    { item: 'p', what: 'Parent', status: 'now' },
    { item: 'a', what: 'First', status: 'done', parent: 'p' },
    { item: 'b', what: 'Unblocked', status: 'next', parent: 'p', dependsOn: ['a'] },
    { item: 'c', what: 'Plain next', status: 'next', parent: 'p' },
    { item: 'd', what: 'Blocked', status: 'next', parent: 'p', dependsOn: ['e'] },
    { item: 'e', what: 'Open work', status: 'now', parent: 'p' },
  ] } }
  const all = nodes(view)
  for (const item of ['b', 'c']) assert.ok(!within(all, item).some((n) => /dshc-tag/.test(cls(n)) && textOf(n) === 'ready'), item + ': no ready tag')
  assert.ok(!/dshc-tag-ok/.test(load().exports.CSS), 'its style is gone too')
  assert.ok(textOf(within(all, 'd').find((n) => cls(n) === 'dshc-cmeta')).includes('Blocked by'))
  const seg = (item) => all.find((n) => n.props['data-item'] === item && 'data-segment' in n.props)?.props['data-segment']
  assert.deepEqual(['b', 'c', 'd'].map(seg), ['ready', 'ready', 'blocked'])
})

test('a next step\'s mark follows its bar segment: a green ring when ready, a dashed ring when blocked', () => {
  const view = { key: 'm', board: { key: 'm', tasks: [
    { item: 'p', what: 'Parent', status: 'now' },
    { item: 'a', what: 'First', status: 'done', parent: 'p' },
    { item: 'b', what: 'Unblocked', status: 'next', parent: 'p', dependsOn: ['a'] },
    { item: 'c', what: 'Plain next', status: 'next', parent: 'p' },
    { item: 'd', what: 'Blocked', status: 'next', parent: 'p', dependsOn: ['e'] },
    { item: 'e', what: 'Open work', status: 'now', parent: 'p' },
  ] } }
  const all = nodes(view)
  const mark = (item) => within(all, item).find((n) => cls(n) === 'dshc-mk')?.props['data-mark']
  const seg = (item) => all.find((n) => n.props['data-item'] === item && 'data-segment' in n.props)?.props['data-segment']
  assert.deepEqual(['b', 'c', 'd'].map(mark), ['ready', 'ready', 'blocked'])
  assert.deepEqual(['b', 'c', 'd'].map(mark), ['b', 'c', 'd'].map(seg), 'the mark and the segment say the same')
  const word = (item) => within(all, item).find((n) => cls(n) === 'dshc-cst').props['aria-label']
  assert.deepEqual(['b', 'd', 'e'].map(word), ['next · ready', 'next · blocked', 'now'])
  const { exports } = load()
  assert.match(exports.CSS, /\.dshc-mk\[data-mark=ready\]\{border-color:var\(--dshc-ok-mark\)\}/, 'the ready segment\'s green')
  assert.match(exports.CSS, /\.dshc-mk\[data-mark=blocked\]\{border-style:dashed;border-color:var\(--dshc-mark\)\}/, 'the blocked segment\'s dashed border')
  // The graph's nodes draw the same marks.
  const graph = expandAll(load({ prefs: { mode: 'graph' } }).exports.BoardView({ view, now: 0 }))
  const gmark = (item) => expandAll(graph.find((n) => cls(n) === 'dshc-gn' && n.props['data-item'] === item)).find((n) => cls(n) === 'dshc-mk')?.props['data-mark']
  assert.deepEqual(['b', 'd'].map(gmark), ['ready', 'blocked'])
})

test('graph hover: the node, its direct dependencies and dependants stay lit; the rest dims', () => {
  const { exports } = load()
  const list = [
    { item: 'p' }, { item: 'a', parent: 'p' }, { item: 'b', parent: 'p', dependsOn: ['a'] },
    { item: 'c', parent: 'p', dependsOn: ['b'] }, { item: 'd', dependsOn: ['c'] }, { item: 'x' },
  ]
  const g = exports.graphLayout(list, { width: 300 })
  const f = exports.graphFocus(g.edges, 'b')
  assert.deepEqual([...f.items].sort(), ['a', 'b', 'c'], 'one step each way, not d two steps on, not the parent')
  assert.deepEqual(J(f.dependencies), ['a'])
  assert.deepEqual(J(f.dependants), ['c'])
  assert.deepEqual([...f.edges].sort(), ['a>b:depends', 'b>c:depends'])
  assert.equal(exports.graphFocus(g.edges, undefined), undefined, 'nothing hovered: nothing dims')
  assert.deepEqual([...exports.graphFocus(g.edges, 'x').items], ['x'], 'a node with no dependencies keeps only itself')
  const { CSS } = exports
  assert.match(CSS, /\.dshc-gbox\[data-focus\] \.dshc-gn:not\(\[data-lit\]\),\.dshc-gbox\[data-focus\] \.dshc-gc:not\(\[data-lit\]\)>\.dshc-gch\{opacity:\.3\}/, 'a step and a parent box\'s header dim alike')
  assert.match(CSS, /\.dshc-gbox\[data-focus\] \.dshc-gsvg path:not\(\[data-lit\]\)\{opacity:\.15\}/)
  assert.ok(!/animation|transition/.test(stillCss(CSS)), 'nothing moves')
  // Each node takes the pointer and the keyboard focus.
  const graph = expandAll(load({ prefs: { mode: 'graph' } }).exports.BoardView({ view: live, now: 0 }))
  const node = graph.find((n) => cls(n) === 'dshc-gn')
  for (const k of ['onPointerEnter', 'onPointerLeave', 'onFocus', 'onBlur']) assert.equal(typeof node.props[k], 'function', k)
  assert.ok(!graph.some((n) => n.props['data-focus'] !== undefined), 'nothing hovered at first')
})

test('graph pin: a click keeps a step\'s links lit after the pointer leaves; a double-click opens the list', () => {
  // A stub React whose useState keeps its value across renders, so a click's state shows on the next render.
  const store = []
  let at = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => { const i = at++; if (!(i in store)) store[i] = typeof init === 'function' ? init() : init; return [store[i], (v) => { store[i] = typeof v === 'function' ? v(store[i]) : v }] },
    useRef: (v) => ({ current: v }), useEffect: () => {}, useLayoutEffect: () => {}, useMemo: (fn) => fn(),
  }
  let row
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (r) => { row = r } } }, localStorage: { getItem: () => null, setItem() {} } })
  const ex = row.factory((name) => { if (name === 'react') return React; throw new Error(name) })
  const board = { key: 'g', tasks: [
    { item: 'a', what: 'A', status: 'done' }, { item: 'b', what: 'B', status: 'now', dependsOn: ['a'] },
    { item: 'c', what: 'C', status: 'next', dependsOn: ['b'] }, { item: 'x', what: 'X', status: 'next' },
  ] }
  const rows = ex.boardRows(board)
  const byItem = new Map(board.tasks.map((t) => [t.item, t]))
  const opened = []
  const render = () => { at = 0; return expandAll(ex.GraphView({ board, rows, byItem, onOpen: (i) => opened.push(i) })) }
  const node = (all, item) => all.find((n) => cls(n) === 'dshc-gn' && n.props['data-item'] === item)
  const litOf = (all) => all.filter((n) => cls(n) === 'dshc-gn' && n.props['data-lit']).map((n) => n.props['data-item'] + ':' + n.props['data-lit'])
  const stop = { stopPropagation() {} }
  let all = render()
  node(all, 'b').props.onClick(stop)
  all = render()
  assert.deepEqual(litOf(all), ['a:dependency', 'b:self', 'c:dependant'], 'the click lights b and its links')
  assert.equal(node(all, 'b').props['aria-pressed'], true)
  assert.notEqual(node(all, 'b').props['data-pin'], undefined, 'b is marked as pinned')
  node(all, 'b').props.onPointerLeave()
  node(all, 'x').props.onPointerEnter()
  all = render()
  assert.deepEqual(litOf(all), ['a:dependency', 'b:self', 'c:dependant'], 'leaving b, or hovering another step, keeps b\'s highlight')
  assert.equal(opened.length, 0, 'a click does not open the list')
  node(all, 'b').props.onClick(stop)
  node(all, 'x').props.onPointerLeave()
  all = render()
  assert.deepEqual(litOf(all), [], 'clicking b again clears it')
  node(all, 'c').props.onClick(stop)
  all = render()
  const graph = all.find((n) => 'data-graph' in n.props)
  graph.props.onClick({ target: { closest: () => null } })
  all = render()
  assert.deepEqual(litOf(all), [], 'a click on the background clears it')
  node(all, 'c').props.onDoubleClick(stop)
  assert.deepEqual(opened, ['c'], 'a double-click opens the list at that step')
  assert.match(textOf(all.find((n) => 'data-graph-hint' in n.props)), /double-click/)
  assert.match(ex.CSS, /\.dshc-gn\[data-pin\],\.dshc-gc\[data-pin\]\{outline:2px solid var\(--dshc-info\)/)
})

test('graph flow: a lit dependency line runs from the step that comes first to the one that waits; only then, and not with reduced motion', () => {
  const { exports } = load()
  const css = exports.CSS
  assert.match(css, /@keyframes dshc-flow\{from\{stroke-dashoffset:0\}to\{stroke-dashoffset:-7\}\}/, 'a negative offset moves the dashes toward the path\'s end')
  assert.match(css, /\.dshc-gbox\[data-focus\] \.dshc-gsvg path\[data-edge=depends\]\[data-lit\]\{animation:dshc-flow \.5s linear infinite\}/, 'only lit lines, only while a step is hovered or pinned')
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.dshc-gbox\[data-focus\] \.dshc-gsvg path\[data-edge=depends\]\[data-lit\]\{animation:none\}\}/)
  assert.equal(css.split('\n').filter((l) => /animation|transition|@keyframes/.test(l)).length, 3, 'nothing else moves')
  // Every line starts at its dependency and ends at the step that waits: the dashes run that way.
  const g = exports.graphLayout([{ item: 'a' }, { item: 'b', dependsOn: ['a'] }, { item: 'c', dependsOn: ['b'] }, { item: 'p' }, { item: 'q', parent: 'p', dependsOn: ['c'] }], { width: 300 })
  const at = Object.fromEntries(g.nodes.map((n) => [n.item, n]))
  for (const e of g.edges) {
    const [x, y] = e.d.slice(1).split(' ').slice(0, 2).map(Number)
    const a = at[e.from]
    assert.ok(x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h, e.from + '>' + e.to + ' starts on its dependency')
    const end = e.d.trim().split(' ').slice(-2).map(Number)
    const b = at[e.to]
    assert.ok(end[0] >= b.x && end[0] <= b.x + b.w && end[1] >= b.y && end[1] <= b.y + b.h, e.from + '>' + e.to + ' ends on the step that waits')
  }
})

test('list → graph: a double-click on a row opens the graph with that step pinned; links, buttons and the details do not', () => {
  // State per component, by its key and hook order, as React keeps it: the graph and the list each keep their own.
  const store = new Map()
  let comp = 'BoardView'
  let at = 0
  const prefs = new Map()
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => { const k = comp + '#' + at++; if (!store.has(k)) store.set(k, typeof init === 'function' ? init() : init); return [store.get(k), (v) => store.set(k, typeof v === 'function' ? v(store.get(k)) : v)] },
    useRef: (v) => ({ current: v }), useEffect: () => {}, useLayoutEffect: () => {}, useMemo: (fn) => fn(),
  }
  let row
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (r) => { row = r } } }, localStorage: { getItem: (k) => prefs.get(k) ?? null, setItem: (k, v) => prefs.set(k, v) } })
  const ex = row.factory((name) => { if (name === 'react') return React; throw new Error(name) })
  const view = { key: 'g', board: { key: 'g', tasks: [
    { item: 'p', what: 'Parent', status: 'now' },
    { item: 'a', what: 'A', status: 'done', parent: 'p' }, { item: 'b', what: 'B', status: 'now', parent: 'p', dependsOn: ['a'] },
    { item: 'c', what: 'C', status: 'next', parent: 'p', dependsOn: ['b'] },
  ] } }
  // Expand the tree, giving each function component its own state slots.
  const render = () => {
    const out = []
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (typeof n.type === 'function') {
        const saved = [comp, at]
        comp = (n.type.name || 'fn') + ':' + (n.props.key ?? n.props['data-item'] ?? n.props.row?.item ?? ''); at = 0
        const child = n.type({ ...n.props, children: n.children.length ? n.children : n.props.children })
        ;[comp, at] = saved
        return walk(child)
      }
      out.push(n); walk(n.children)
    }
    comp = 'BoardView'; at = 0
    walk(ex.BoardView({ view, now: 0 }))
    return out
  }
  const rowOf = (all, item) => all.find((n) => n.type === 'li' && n.props['data-item'] === item).children.find((n) => n && cls(n) === 'dshc-row')
  const pressed = (all) => all.find((n) => n.props['data-view'] && n.props['aria-pressed'] === true)?.props['data-view']
  let all = render()
  assert.equal(pressed(all), 'list')
  const target = (inLink) => ({ closest: (s) => (inLink && /a,button/.test(s) ? {} : null) })
  rowOf(all, 'b').props.onDoubleClick({ target: target(true) })
  assert.equal(pressed(render()), 'list', 'a double-click on a link or a button stays in the list')
  all = render()
  assert.match(rowOf(all, 'b').props.title, /Double-click to show in the graph/)
  rowOf(all, 'b').props.onDoubleClick({ target: target(false) })
  all = render()
  assert.equal(pressed(all), 'graph', 'the graph opens')
  const lit = all.filter((n) => (cls(n) === 'dshc-gn' || cls(n) === 'dshc-gc') && n.props['data-lit']).map((n) => n.props['data-item'] + ':' + n.props['data-lit'])
  assert.deepEqual(lit, ['a:dependency', 'b:self', 'c:dependant'], 'with b selected and its links lit')
  assert.notEqual(all.find((n) => cls(n) === 'dshc-gn' && n.props['data-item'] === 'b').props['data-pin'], undefined)
  // The List | Graph switch starts the graph with nothing pinned.
  all.find((n) => n.props['data-view'] === 'list').props.onClick()
  render().find((n) => n.props['data-view'] === 'graph').props.onClick()
  all = render()
  assert.ok(!all.some((n) => n.props['data-pin'] !== undefined), 'nothing pinned from the switch')
  // A parent row works too.
  all.find((n) => n.props['data-view'] === 'list').props.onClick()
  all = render()
  rowOf(all, 'p').props.onDoubleClick({ target: target(false) })
  all = render()
  assert.notEqual(all.find((n) => cls(n) === 'dshc-gc' && n.props['data-item'] === 'p').props['data-pin'], undefined, 'a parent row selects its box')
})

test('the Inbox is one card: a tinted header, the items as rows, and Add item… as its last row', () => {
  const view = { key: 'k', board: { key: 'k', tasks: [{ item: '1', what: 'one', status: 'next' }],
    inbox: [{ id: 'i1', text: 'an idea', state: 'open' }, { id: 'i2', text: 'refined one', state: 'refined', refinedInto: ['1'] }] } }
  const { exports } = load()
  const fill = () => 'filled'
  const all = expandAll(exports.BoardView({ view, now: 0, fill }))
  const sec = all.find((n) => 'data-inbox' in n.props)
  const card = sec.children.flat().find((n) => n && cls(n) === 'dshc-ibcard')
  assert.ok(card, 'the section holds one card')
  const kids = card.children.flat().filter(Boolean)
  assert.deepEqual(kids.map((n) => (typeof n.type === 'function' ? n.type.name : cls(n))), ['dshc-sech', 'dshc-ib', 'InboxAdd'], 'header, items, Add item…')
  const css = exports.CSS
  assert.match(css, /\.dshc-ibcard\{border:\.5px solid var\(--dsw-alias-border-l3,var\(--dshc-border\)\);border-radius:var\(--dsw-radius-md,8px\);overflow:hidden\}/, 'drawn like a step group')
  assert.match(css, /\.dshc-inbox \.dshc-sech\{[^}]*background:var\(--dshc-l1\);border-bottom:1px solid var\(--dshc-border\)\}/, 'its header tinted like a group title')
  assert.match(css, /\.dshc-ibcard>\.dshc-ibadd\{margin:0;[^}]*border-top:1px solid var\(--dshc-border\)\}/, 'Add item… is the card\'s last row')
  assert.match(css, /\.dshc-empty \.dshc-ibadd\{/, 'the empty tab keeps its own Add item…')
})

// ---- The Agents view: the session's subagents and theirs, as DSH's header dropdown lists them ----

/** Stand-in Session state: root's catalog lists a (running), b and c; a's lists a1; b and c none. */
function agentState({ nested = true, running = ['a'], empty = false } = {}) {
  const byId = {
    root: { id: 'root' },
    a: { id: 'a', running: running.includes('a'), title: 'Survey', projectionValues: { tokenUsage: { uncachedInputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    b: { id: 'b', running: running.includes('b'), projectionValues: { subagentTiming: { settledMs: 65000, lastTurnCompleted: true } } },
    c: { id: 'c', running: running.includes('c') },
    a1: { id: 'a1', running: running.includes('a1') },
  }
  const projectionsBySession = { root: { state: 'ready', values: { subagentCatalog: empty ? [] : [
    { id: 'a', label: 'explorer', mode: 'continuable' }, { id: 'b', label: 'reviewer', mode: 'one-shot' }, { id: 'c', label: 'tester', mode: 'continuable' },
  ] } } }
  if (nested) {
    projectionsBySession.a = { state: 'ready', values: { subagentCatalog: [{ id: 'a1', label: 'helper', mode: 'one-shot' }] } }
    projectionsBySession.b = { state: 'ready', values: { subagentCatalog: [] } }
    projectionsBySession.c = { state: 'ready', values: { subagentCatalog: [] } }
    projectionsBySession.a1 = { state: 'ready', values: { subagentCatalog: [] } }
    // a ran on Sonnet at high effort; b's first request is still to come, so only its next selection is known.
    projectionsBySession.a.values.modelSelection = { lastUsed: { provider: 'claude', model: 'claude-sonnet-5-5', reasoningEffort: 'high' }, next: null }
    projectionsBySession.b.values.modelSelection = { lastUsed: null, next: { provider: 'codex', model: 'gpt-6.1-sol' } }
  }
  return { byId, projectionsBySession }
}
function agentsView(opts = {}, prefs) {
  const { exports } = load({ prefs })
  const st = agentState(opts)
  const calls = { open: [], aside: [], refresh: [] }
  const agents = { open: (a) => calls.open.push(a), aside: (a) => calls.aside.push(a), refresh: (id) => calls.refresh.push(id) }
  const all = expandAll(exports.AgentsView({ sessionId: 'root', useSessions: (sel) => sel(st), useSessionStatus: (sel) => sel(new Map()), agents }))
  return { exports, all, calls }
}
const agentRows = (all) => all.filter((n) => n.props.role === 'treeitem').map((n) => n.props['aria-label'].split(' ')[0])

test('the view switch is List | Graph | Agents, and Agents shows the session\'s subagent tree', () => {
  const { exports } = load({ prefs: { mode: 'agents' } })
  const st = agentState()
  const flat = expandAll(exports.BoardView({ view: live, now: 0, agentProps: { sessionId: 'root', useSessions: (sel) => sel(st), useSessionStatus: (sel) => sel(new Map()), agents: {} } }))
  assert.deepEqual(flat.filter((n) => 'data-view' in n.props).map((n) => [n.props['data-view'], n.props['aria-pressed'], textOf(n)]), [['list', false, 'List'], ['graph', false, 'Graph'], ['agents', true, 'Agents']])
  assert.ok(flat.some((n) => 'data-agents' in n.props), 'the Agents view')
  assert.ok(!flat.some((n) => cls(n).startsWith('dshc-li')), 'no step rows')
  assert.ok(!flat.some((n) => 'data-graph' in n.props), 'no graph')
  // A board with no steps yet still offers Agents.
  const bare = expandAll(exports.BoardView({ view: { key: 'k', board: { key: 'k', tasks: [] } }, now: 0, agentProps: {} }))
  assert.deepEqual(bare.filter((n) => 'data-view' in n.props).map((n) => n.props['data-view']), ['list', 'agents'])
})

test('Agents: the whole tree with the dropdown\'s rows, statuses, tokens and time', () => {
  const { all } = agentsView()
  assert.deepEqual(agentRows(all), ['explorer', 'helper', 'reviewer', 'tester'], 'every branch open, a child under its parent')
  const row = (label) => all.find((n) => n.props.role === 'treeitem' && n.props['aria-label'].startsWith(label + ' '))
  assert.match(row('explorer').props['aria-label'], /^explorer Survey · continuable · running claude-sonnet-5-5 · high 1\.2K tok$/)
  assert.match(row('reviewer').props['aria-label'], /^reviewer one-shot · completed gpt-6\.1-sol 1m 05s$/)
  assert.match(row('tester').props['aria-label'], /^tester continuable · not running$/)
  assert.deepEqual(all.filter((n) => n.type === 'li' && n.props['data-agent']).map((n) => [n.props['data-agent'], n.props['data-state']]),
    [['a', 'ongoing'], ['a1', 'idle'], ['b', 'done'], ['c', 'idle']], 'the dropdown\'s three states')
  assert.equal(textOf(all.find((n) => 'data-agents-summary' in n.props)), '1 running · 4 in all', 'counts the whole tree')
})

test('Agents: the root and each branch are asked for once; actions open as the dropdown does', () => {
  const { all, calls, exports } = agentsView({ nested: false })
  // What the view's effect asks for (the stub React runs no effects, so the rule is tested directly).
  const cats = (o) => exports.agentCatalogs(agentState(o).projectionsBySession, {}, new Map())
  assert.deepEqual(J(exports.agentBranchesToLoad('root', cats({ nested: false }), new Set(), new Set())), ['a', 'b', 'c'], 'each branch of a loaded root')
  assert.deepEqual(J(exports.agentBranchesToLoad('root', cats({ nested: false }), new Set(['a']), new Set(['b']))), ['c'], 'not one already asked for, not a collapsed one')
  assert.deepEqual(J(exports.agentBranchesToLoad('root', cats({ nested: true }), new Set(), new Set())), [], 'every branch loaded: nothing more')
  assert.deepEqual(J(exports.agentBranchesToLoad('root', {}, new Set(), new Set())), [], 'no root catalog yet: the root is asked for on its own')
  const row = all.find((n) => n.props.role === 'treeitem')
  row.props.onClick()
  assert.equal(JSON.stringify(calls.open), JSON.stringify([{ parentSessionId: 'root', childSessionId: 'a', mode: 'continuable' }]))
  all.find((n) => cls(n) === 'dshc-agaside').props.onClick({ stopPropagation() {} })
  assert.equal(calls.aside.length, 1)
  assert.equal(exports.agentChatAddress({ parentSessionId: 'a', childSessionId: 'a1', mode: 'one-shot' }), 'dsh-resource://subagentchat/session/a1?parent=a&mode=one-shot')
  assert.equal(exports.agentChatAddress({ parentSessionId: 'p q&r', childSessionId: 'x y', mode: 'continuable' }), 'dsh-resource://subagentchat/session/x%20y?parent=' + new URLSearchParams({ parent: 'p q&r' }).toString().slice(7) + '&mode=continuable', 'the same query as URLSearchParams')
})

test('Agents: Running keeps the ones running now; the choice is kept; no subagents says so', () => {
  const running = agentsView({}, { agentsFilter: 'running' })
  assert.deepEqual(agentRows(running.all), ['explorer'], 'a runs; its helper and the others do not')
  assert.equal(running.all.find((n) => n.props['data-agents-filter'] === 'running').props['aria-pressed'], true)
  const none = agentsView({ running: [] }, { agentsFilter: 'running' })
  assert.match(textOf(none.all.find((n) => 'data-agents' in n.props)), /No subagents are running\./)
  const empty = agentsView({ empty: true })
  assert.ok(empty.all.some((n) => 'data-empty' in n.props))
  assert.match(textOf(empty.all.find((n) => 'data-empty' in n.props)), /No subagents in this session yet/)
  assert.ok(!empty.all.some((n) => n.props.role === 'treeitem'))
})

test('Agents: the time and token text match the dropdown\'s', () => {
  const { exports } = load()
  assert.deepEqual([999, 1200, 15600, 2400000].map(exports.agentTokenText), ['999 tok', '1.2K tok', '15.6K tok', '2.4M tok'])
  assert.deepEqual([4000, 65000, 3725000, 90000000].map(exports.agentDurationText), ['4s', '1m 05s', '1h 02m 05s', '1d 1h'])
})

test('Agents: each subagent\'s model and effort, from its own modelSelection, as DSH\'s agent-team rows read it', () => {
  const { all, exports } = agentsView()
  const model = (id) => { const li = all.find((n) => n.type === 'li' && n.props['data-agent'] === id); const m = expandAll(li).find((n) => 'data-agent-model' in n.props && expandAll(n).length); return m ? textOf(m) : undefined }
  // Only a row's own line: the first model line inside its li belongs to it.
  assert.equal(model('a'), 'claude-sonnet-5-5 · high', 'the latest request\'s model and effort')
  assert.equal(model('b'), 'gpt-6.1-sol', 'before its first request: the next selection; no effort, none shown')
  assert.equal(model('c'), undefined, 'no selection recorded: no model line')
  assert.equal(all.find((n) => 'data-agent-model' in n.props).props.title, 'claude · claude-sonnet-5-5 · high', 'the provider in the tooltip')
  assert.equal(exports.agentModel(undefined), undefined)
  assert.equal(exports.agentModel({ values: { modelSelection: { lastUsed: { model: '' }, next: null } } }), undefined)
  assert.equal(JSON.stringify(exports.agentModel({ values: { modelSelection: { lastUsed: null, next: { provider: 'p', model: 'm', reasoningEffort: 'low' } } } })), '{"model":"m","effort":"low","provider":"p"}')
})

// ---- The step menu: DSH's context menu on list rows and graph nodes, target dsh-cockpit.step ----

const menuView = { key: 'm', links: { issue: 'https://github.com/{repo}/issues/{number}', pr: 'https://github.com/{repo}/pull/{number}' }, board: { key: 'm', parent: 'acme/shop#1', tasks: [
  { item: 'p', what: 'Parent', status: 'now' },
  { item: 'a', what: 'Wire the provider', status: 'waiting', parent: 'p', issue: 'acme/shop#12', pr: 'acme/shop#34', readyCommand: 'gh pr merge 34' },
  { item: 'b', what: 'Plain', status: 'next', parent: 'p' },
] } }

/** A stand-in for DSH's useContextMenu: records each target and the handlers it was given. */
function fakeMenu() {
  const opened = []
  const menu = { getTriggerProps: (target, handlers = {}) => ({
    onContextMenu: (e) => { opened.push(typeof target === 'function' ? target() : target); if (e && e.preventDefault) e.preventDefault() },
    onKeyDown: (e) => { if (handlers.onKeyDown) handlers.onKeyDown(e); if (e.shiftKey && e.key === 'F10') opened.push(typeof target === 'function' ? target() : target) },
  }) }
  return { menu, opened }
}

test('step menu: every list row and graph node opens it with the step as a dsh-cockpit.step target', () => {
  const { exports } = load()
  assert.equal(exports.STEP_TARGET, 'dsh-cockpit.step')
  const { menu, opened } = fakeMenu()
  const list = expandAll(exports.BoardView({ view: menuView, now: 0, menu, sessionId: 's1' }))
  const li = (item) => list.find((n) => n.type === 'li' && n.props['data-item'] === item)
  li('a').props.onContextMenu({ preventDefault() {} })
  li('p').props.onContextMenu({ preventDefault() {} })
  assert.equal(opened[0].kind, 'dsh-cockpit.step')
  assert.deepEqual(J(opened[0].value), { sessionId: 's1', boardKey: 'm', item: 'a', what: 'Wire the provider', title: 'acme/shop#12 Wire the provider', status: 'waiting', view: 'list', parent: 'p',
    issue: 'acme/shop#12', issueUrl: 'https://github.com/acme/shop/issues/12', pr: 'acme/shop#34', prUrl: 'https://github.com/acme/shop/pull/34', readyCommand: 'gh pr merge 34' })
  assert.ok(Object.isFrozen(opened[0].value), 'a fixed snapshot')
  assert.equal(opened[1].value.item, 'p', 'a parent row has the menu too')
  li('b').props.onKeyDown({ shiftKey: true, key: 'F10' })
  assert.equal(opened[2].value.item, 'b', 'Shift+F10 opens it from the keyboard')
  // The graph: nodes and boxes, the same target with view: 'graph'.
  const graph = expandAll(load({ prefs: { mode: 'graph' } }).exports.BoardView({ view: menuView, now: 0, menu, sessionId: 's1' }))
  const node = (item) => graph.find((n) => (cls(n) === 'dshc-gn' || cls(n) === 'dshc-gc') && n.props['data-item'] === item)
  node('a').props.onContextMenu({ preventDefault() {} })
  node('p').props.onContextMenu({ preventDefault() {} })
  assert.deepEqual(opened.slice(3).map((t) => [t.value.item, t.value.view]), [['a', 'graph'], ['p', 'graph']])
  // A box keeps Enter for its pin, the menu gets its own keys after it.
  let prevented = 0
  node('p').props.onKeyDown({ key: 'Enter', target: 1, currentTarget: 1, preventDefault() { prevented++ } })
  assert.equal(prevented, 1, 'Enter still pins the box')
})

test('step menu: cockpit adds copy actions only, links when the step has them', () => {
  const { exports } = load()
  const copied = []
  const copy = (value, label) => copied.push([label, value])
  const full = exports.stepTarget({ sessionId: 's', boardKey: 'm', row: { item: 'a', title: '#12 Wire', status: 'now', issueUrl: 'https://x/i/12', prUrl: 'https://x/p/34' }, task: { what: 'Wire', issue: '#12', pr: '#34', readyCommand: 'gh pr merge 34' }, view: 'list' }).value
  const actions = exports.stepCopyActions(full, copy)
  assert.deepEqual(J(actions.map((a) => [a.id, a.label, a.separatorBefore || false])), [
    ['copy-title', 'Copy title', false], ['copy-id', 'Copy step id', false], ['copy-command', 'Copy ready command', false],
    ['copy-pr-link', 'Copy PR link', true], ['copy-issue-link', 'Copy issue link', false],
  ], 'copies, then links after a divider')
  actions.forEach((a) => a.run())
  assert.deepEqual(J(copied.map((c) => c[1])), ['#12 Wire', 'a', 'gh pr merge 34', 'https://x/p/34', 'https://x/i/12'])
  const bare = exports.stepTarget({ sessionId: 's', boardKey: 'm', row: { item: 'b', title: 'Plain', status: 'next' }, task: { what: 'Plain' }, view: 'graph' }).value
  assert.deepEqual(J(exports.stepCopyActions(bare, copy).map((a) => a.id)), ['copy-title', 'copy-id'], 'no command, no links: nothing to copy for them')
  assert.equal(exports.stepTarget({ sessionId: 's', boardKey: 'm', row: { item: 'x', title: 't', status: 'next', prUrl: 'javascript:alert(1)' }, task: { pr: 'evil' }, view: 'list' }).value.prUrl, undefined, 'only http(s) links')
})

test('step menu: registered with the contextMenus service when there is one, and nothing breaks without it', () => {
  const { exports } = load()
  const registered = []
  let injected
  const base = {
    effect: (fn) => fn(),
    sidebarRightTabs: { register: () => () => {} }, sidebarRight: { openTab() {}, openResource() {} },
    sessions: { refreshProjections() {} }, uiWorkspace: { openSession() {} },
    slots: { inject: (_n, fn) => fn(), register: () => () => {} },
  }
  exports.apply({ ...base, inject: (names, fn) => { injected = names; fn({ effect: (f) => f(), contextMenus: { register: (c) => { registered.push(c); return () => {} } } }) } })
  assert.deepEqual(J(injected), ['contextMenus'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].target, 'dsh-cockpit.step')
  assert.equal(registered[0].id, 'dsh-cockpit.copy')
  const actions = registered[0].resolve({ item: 'a', title: 'T', what: 'T' }, new AbortController().signal)
  assert.ok(actions.every((a) => a.failureLabel), 'a failed copy says why')
  assert.doesNotThrow(() => exports.apply(base), 'no ctx.inject: no menu, the rest still registers')
  // Without useContextMenu the rows have no menu handlers and still render.
  const plain = expandAll(exports.BoardView({ view: menuView, now: 0 }))
  assert.equal(plain.find((n) => n.type === 'li' && n.props['data-item'] === 'a').props.onContextMenu, undefined)
})

test('copy over plain HTTP: without the clipboard API, or when it refuses, a hidden text field copies', async () => {
  const { exports } = load()
  // A fake document: records the field's value when execCommand('copy') runs, and what is left behind.
  const fakeDoc = (result = true) => {
    const log = { copied: [], appended: 0, removed: 0, refocused: 0 }
    const active = { focus: () => { log.refocused++ } }
    const doc = {
      activeElement: active,
      body: { appendChild: () => { log.appended++ } },
      createElement: () => ({ value: '', style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove: () => { log.removed++ } }),
      execCommand: (cmd) => { if (cmd === 'copy') log.copied.push(doc._field && doc._field.value); return result },
    }
    const create = doc.createElement
    doc.createElement = () => (doc._field = create())
    return { doc, log }
  }
  const http = fakeDoc()
  assert.equal(await exports.copyText('step-7', undefined, http.doc), 'copied', 'no clipboard API: the text field copies')
  assert.deepEqual(J(http.log), { copied: ['step-7'], appended: 1, removed: 1, refocused: 1 }, 'the field is removed and focus goes back')
  const refused = fakeDoc()
  assert.equal(await exports.copyText('x', { writeText: async () => { throw new Error('denied') } }, refused.doc), 'copied', 'the API refuses: the field copies')
  const api = fakeDoc()
  const got = []
  assert.equal(await exports.copyText('y', { writeText: async (t) => { got.push(t) } }, api.doc), 'copied')
  assert.deepEqual(J([got, api.log.copied]), [['y'], []], 'the API works: no text field')
  const blocked = fakeDoc(false)
  assert.equal(await exports.copyText('z', undefined, blocked.doc), 'failed', 'the browser refuses both: failed')
  assert.equal(blocked.log.removed, 1, 'and still cleans up')
})
