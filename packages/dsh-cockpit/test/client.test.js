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
function load({ open = false, primitives, measured = 0 } = {}) {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    // A bar's measured width is the only useState(0): measured gives it.
    useState: (init) => [typeof init === 'function' ? init() : init === false ? open : init === 0 ? measured : init, () => {}],
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
    useMemo: (fn) => fn(),
  }
  let row
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (r) => { row = r } } } })
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
      { item: '1', what: 'Profile and guard', status: 'waiting', why: 'CI still running.', issue: '#884', pr: '#892', waitingOn: 'owner', nextAction: 'Owner: once CI is green, merge PR #892 by hand.', readyCommand: 'gh pr merge 892 --squash', parent: '883' },
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
  const calls = { tabs: [], slots: [], opened: [] }
  exports.apply({
    effect: (fn) => fn(),
    sidebarRightTabs: { register: (d) => { calls.tabs.push(d); return () => {} } },
    sidebarRight: { openTab: (kind, options) => { calls.opened.push([kind, options]) } },
    slots: { inject: (_name, fn) => fn(), register: (entry, Component) => { calls.slots.push({ entry, Component }); return () => {} } },
  })
  return calls
}

test('the bundle registers the Board tab, the four tool cards and the strip; materializing it requires only react', () => {
  const { row, exports } = load()
  assert.equal(row.id, '@rs-dsh/dsh-cockpit')
  assert.deepEqual([...exports.inject], ['slots', 'sidebarRightTabs', 'sidebarRight'])
  const calls = register(exports)
  assert.equal(calls.tabs.length, 1)
  assert.equal(calls.tabs[0].id, '@rs-dsh/dsh-cockpit')
  assert.equal(calls.tabs[0].title(), 'Board', 'still "Board" in 0.1')
  assert.deepEqual(calls.slots.map((s) => [s.entry.name, s.entry.key ?? s.entry.id]), [
    ['sidebar.right.pane.tab', '@rs-dsh/dsh-cockpit'],
    ['tool.call.toolview', 'board_open'], ['tool.call.toolview', 'board_read'], ['tool.call.toolview', 'board_add'], ['tool.call.toolview', 'board_update'],
    ['conversation.input.dock', 'dsh-cockpit-progress'],
  ])
  assert.equal(JSON.stringify(calls.slots[0].entry.inject('s1')), '{"sessionId":"s1"}')
  const dock = calls.slots[5].entry
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

test('Needs you: only waitingOn owner, with the ask as written, Open PR and the command', () => {
  const out = render(live)
  const at = out.indexOf('Needs you')
  assert.ok(at >= 0 && at < out.indexOf('Log reader'), out)
  for (const s of ['#884 Profile and guard', 'Owner: once CI is green, merge PR #892 by hand.', 'Open PR #892', 'gh pr merge 892 --squash', 'Copy']) assert.ok(out.slice(at).includes(s), s)
  assert.equal(out.split('Owner: once CI is green').length, 2, 'the ask shows once, in the card')
  assert.ok(out.includes('Needs you · see top'))
  const none = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => ({ ...t, waitingOn: t.item === '1' ? undefined : t.waitingOn })) } }
  assert.ok(!render(none).includes('Needs you'), 'no guess from nextAction')
  const open = nodes(live).find((n) => cls(n) === 'dshc-open')
  assert.equal(open.props.href, 'https://github.com/Romany-Saad/resturants-app/pull/892')
})

test('rows: fixed columns, tree order, a mark by shape, and dropped struck through and counted apart', () => {
  const all = nodes(live)
  assert.deepEqual(all.filter((n) => n.type === 'li').map((n) => n.props['data-item']), ['883', '1', '2', '5', '6b', '7'])
  for (const r of all.filter((n) => cls(n) === 'dshc-row')) {
    assert.deepEqual(r.children.filter(Boolean).slice(0, 4).map((k) => cls(k).split(' ').pop()), ['dshc-cid', 'dshc-cst', 'dshc-ct', 'dshc-cpr'])
  }
  const { exports } = load()
  assert.match(exports.CSS, /grid-template-columns:36px 68px minmax\(0,1fr\) 60px 20px/)
  assert.ok(!/animation|transition/.test(exports.CSS), 'nothing moves')
  const mark = (item) => within(all, item).map(cls).find((c) => /dshc-(ring|dot|check|dash)/.test(c)) || ''
  assert.deepEqual(['2', '5', '1', '7'].map(mark), ['dshc-check', 'dshc-ring', 'dshc-dot dshc-dot-waiting', 'dshc-dash'])
  assert.match(cls(all.find((n) => n.type === 'li' && n.props['data-item'] === '7')), /dshc-dropped/)
  assert.match(exports.CSS, /\.dshc-dropped \.dshc-tt\{text-decoration:line-through\}/)
  assert.ok(render(live).includes('1 of 5 done · 1 dropped · 1 needs you'))
})

test('rows: no "Next:" label; Waiting on <who>; Start when; blocked by short refs; problems name the reference', () => {
  const out = render(live)
  assert.ok(!out.includes('Next:'))
  assert.ok(out.includes('Hub: start once #892 merges.'))
  assert.ok(out.includes('Waiting on release'))
  assert.ok(!out.includes('Owner: Owner'))
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
  assert.equal(title('2').props.title, '#888 Log reader')
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
  const segs = nodes(view).filter((n) => 'data-segment' in n.props)
  assert.deepEqual(segs.map((s) => [s.props['data-item'], s.props['data-segment']]), [['1', 'done'], ['3', 'now']])
  assert.equal(segs[1].props.title, 'b · now · opus high')
  assert.ok(render(view).includes('1 of 2 done'))
  assert.equal(segs.filter((s) => s.props['data-segment'] === 'done').length, 1, 'as many done segments as the text counts')
})

test('the parent row: progress in words and the thin bar, one segment per child, by shape', () => {
  const all = nodes(live)
  const segs = all.filter((n) => 'data-segment' in n.props)
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
  assert.ok(out.includes('A hub agent binds a board when it starts to coordinate work. The board shows here after that.'))
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
  assert.equal(m.line, '⚠ Needs you: Owner: once CI is green, merge PR #892 by hand. · Copy command · Board ›')
  assert.equal(textOf(tree), 'Needs you: Owner: once CI is green, merge PR #892 by hand.Copy command·Board ›', 'the action as written, no key or count')
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

test('the strip: the same segments and counts as the parent row\'s bar, each with a tooltip; nothing moves', () => {
  const { exports } = load()
  const { m, tree } = strip(live)
  const rowSegs = nodes(live).filter((n) => 'data-segment' in n.props).map((s) => [s.props['data-item'], s.props['data-segment'], s.props.title])
  const stripSegs = expand(tree).filter((n) => 'data-segment' in n.props).map((s) => [s.props['data-item'], s.props['data-segment'], s.props.title])
  assert.deepEqual(stripSegs, rowSegs, 'one segment model')
  assert.ok(stripSegs.every((s) => s[2]), 'every segment has a tooltip')
  assert.equal(m.done, '1 of 5 done · 1 dropped')
  assert.ok(!/animation|transition/.test(exports.CSS))
  // A board without one parent row: one segment per work task (a row without children).
  const flat = { key: 'f', board: { key: 'f', tasks: [{ item: '1', what: 'a', status: 'done' }, { item: '2', what: 'b', status: 'next', dependsOn: ['1'] }] } }
  assert.deepEqual([...strip(flat).m.bar.segments.map((s) => s.kind)], ['done', 'ready'])
  assert.equal(strip(flat).m.line, 'f · 1 of 2 done · Board ›')
  const epics = { key: 'e', board: { key: 'e', tasks: ['a', 'b'].flatMap((p) => [{ item: p, what: p, status: 'now' }, ...[1, 2, 3].map((i) => ({ item: p + i, what: p + i, status: i === 1 ? 'done' : 'next', parent: p }))]) } }
  assert.equal(strip(epics).m.done, '2 of 6 done', 'two epics: their work tasks, not the epics')
  assert.deepEqual([...strip(epics).m.bar.segments.map((s) => s.item)], ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'])
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
  assert.equal(bar(live).props.title, '⚠ Needs you: Owner: once CI is green, merge PR #892 by hand. (#884 Profile and guard) · 1 of 5 done · 1 dropped')
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
  assert.match(exports.CSS, /\.dshc-fill\{display:block;height:8px;border-radius:4px;/)
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
  assert.equal(fill.children[0].props.style.width, '53px')
})

test('the strip opens the Board tab: the strip at its focus row, a segment at its own row, without the click going twice', () => {
  const opened = []
  const { tree } = strip(live, (item) => opened.push(item))
  const all = expand(tree)
  const bar = all.find((n) => n.props.role === 'button' && n.props.className === 'dshc-strip')
  assert.equal(bar.props.tabIndex, 0, 'keyboard reachable')
  assert.equal(bar.props['aria-label'], '⚠ Needs you: Owner: once CI is green, merge PR #892 by hand. · Copy command · Board ›')
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
