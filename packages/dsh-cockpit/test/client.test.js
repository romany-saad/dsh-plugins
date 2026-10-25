// Smoke test of the built browser bundle, client/client.js, without a browser:
// run it in a VM with a stub module loader and a stub React that renders
// function components to text, then check the tab registration and the view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

function load(state, { open = false } = {}) {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    // The view hook's state is the test's; a row's open state is { open }.
    useState: (init) => [init && init.loading ? state : init === false ? open : init, () => {}],
    useEffect: () => {},
  }
  const primitives = { StateDot: ({ state }) => '(' + state + ')', Tag: (p) => '[' + [].concat(p.children).join('') + ']' }
  const modules = { react: React, '@deepseek-ai/dsh-client-ui-primitives': primitives }
  let row
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (r) => { row = r } } } })
  const exports = row.factory((name) => { if (!(name in modules)) throw new Error('unexpected require ' + name); return modules[name] })
  return { row, exports }
}

const text = (node) => {
  if (node === null || node === undefined || node === false) return ''
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node !== 'object') return String(node)
  if (typeof node.type === 'function') return text(node.type({ ...node.props, children: node.children.length ? node.children : node.props.children }))
  return text(node.children) + (node.type === 'li' || node.type === 'div' || node.type === 'p' ? '\n' : ' ')
}

function register(exports) {
  const calls = { tabs: [], slots: [] }
  const ctx = {
    effect: (fn) => fn(),
    sidebarRightTabs: { register: (d) => { calls.tabs.push(d); return () => {} } },
    sidebarRight: { openTab: (kind, options) => { calls.opened = (calls.opened || []).concat([[kind, options]]) } },
    slots: { inject: (_name, fn) => fn(), register: (entry, Component) => { calls.slots.push({ entry, Component }); return () => {} } },
  }
  exports.apply(ctx)
  return calls
}

test('the bundle registers under the package id with a Board tab and its body', () => {
  const { row, exports } = load({ loading: true })
  assert.equal(row.id, '@romany-saad/dsh-cockpit')
  assert.deepEqual([...exports.inject], ['slots', 'sidebarRightTabs', 'sidebarRight'])
  const { tabs, slots } = register(exports)
  assert.equal(tabs[0].id, '@romany-saad/dsh-cockpit')
  assert.equal(tabs[0].title(), 'Board')
  assert.equal(slots[0].entry.name, 'sidebar.right.pane.tab')
  assert.equal(slots[0].entry.key, tabs[0].id)
  assert.equal(slots[0].entry.inject('s1').sessionId, 's1')
  assert.deepEqual(slots.slice(1, 5).map((s) => [s.entry.name, s.entry.key]), ['board_open', 'board_read', 'board_add', 'board_update'].map((k) => ['tool.call.toolview', k]))
  assert.equal(slots[5].entry.name, 'conversation.input.dock')
})

const flat = (out) => out.replace(/[ \t]+/g, ' ')
function render(view, options) {
  const { exports } = load({ view }, options)
  return flat(text(register(exports).slots[0].Component({ sessionId: 's1' })))
}

const live = {
  key: 'sim-883',
  board: {
    key: 'sim-883', parent: 'Romany-Saad/resturants-app#883', revision: 25, updatedAt: 't',
    tasks: [
      { item: '1', what: 'Profile and guard', status: 'waiting', why: 'CI still running.', issue: '#884', pr: '#892', nextAction: 'Owner: once CI is green, merge PR #892 by hand.', readyCommand: 'gh pr merge 892 --squash', parent: '883' },
      { item: '2', what: 'Log reader', status: 'done', issue: '#888', pr: '#889', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', parent: '883' },
      { item: '5', what: 'Live checks and docs', status: 'next', why: 'Needs item 1 merged.', issue: '#887', nextAction: 'Hub: start once #892 merges.', parent: '883', dependsOn: ['1', '2', 'release notes'] },
      { item: '883', what: '#883 effort', status: 'now', issue: '#883' },
      { item: '6b', what: 'Board rule in Bosla', status: 'waiting', why: 'Starts only once 0.1 is released.', nextAction: 'Hub: start once 0.1 is released.', parent: '883', dependsOn: ['5'], extra: { startCondition: 'dsh-cockpit 0.1 released' } },
    ],
  },
  flags: [{ item: '5', code: 'unknown_dependency', ref: 'release notes' }],
}

test('Needs you lists the owner\'s tasks first with the command, copy and Open; guessed without waitingOn', () => {
  const out = render(live)
  const needs = out.indexOf('Needs you')
  assert.ok(needs >= 0 && needs < out.indexOf('#888 Log reader'), out)
  assert.ok(out.includes('Needs you (guessed)'))
  assert.ok(out.slice(needs).startsWith('Needs you (guessed)'))
  for (const s of ['gh pr merge 892 --squash', 'copy', 'Open']) assert.ok(out.includes(s), s + ' in\n' + out)
  assert.equal(out.split('gh pr merge 892 --squash').length, 2, 'the command shows once')
  const set = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => (t.item === '6b' ? { ...t, waitingOn: 'release' } : t)) } }
  assert.ok(!render(set).includes('Needs you'), 'waitingOn set somewhere, nobody on owner: no block')
  const owner = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => (t.item === '1' ? { ...t, waitingOn: 'Owner' } : t)) } }
  assert.ok(render(owner).includes('Needs you') && !render(owner).includes('(guessed)'))
})

test('one wait line per row, the others only when opened; never the same text twice', () => {
  const closed = render(live)
  assert.ok(closed.includes('Hub: start once 0.1 is released.'))
  assert.ok(!closed.includes('Starts only once 0.1 is released.'))
  assert.ok(!closed.includes('dsh-cockpit 0.1 released'))
  const open = render(live, { open: true })
  for (const s of ['why Starts only once 0.1 is released.', 'starts when dsh-cockpit 0.1 released']) assert.ok(open.includes(s), s + ' in\n' + open)
  assert.equal(open.split('Hub: start once 0.1 is released.').length, 2)
})

test('done rows are one muted line with PR; model and detail only when opened', () => {
  const closed = render(live)
  assert.match(closed, /#888 Log reader PR #889/)
  assert.ok(!closed.includes('claude-opus-5-5'))
  assert.ok(render(live, { open: true }).includes('model claude-opus-5-5 · high'), 'provider hidden')
})

test('blocked by names the unmet dependency with its status; the parent shows progress; flags show once', () => {
  const out = render(live)
  assert.ok(out.includes('blocked by #884 (waiting)'))
  assert.ok(out.includes('blocked by #887 (next)'))
  assert.ok(out.includes('1 of 4 done · 1 needs you'))
  assert.ok(!out.includes('(ongoing)'), 'no status dot on the parent')
  assert.equal(out.split("! blocked by 'release notes' (not on the board)").length, 2, out)
  assert.ok(!/\d flags?/.test(out), 'no flag count chip')
})

test('the problems strip: one line per problem under the header, each showing its row; none, no strip', () => {
  const tasks = [
    { item: '883', what: '#883 effort', status: 'now', issue: '#883' },
    { item: '1', what: 'Profile and guard', status: 'done', issue: '#884', pr: '#892', parent: '883' },
    { item: '3', what: 'Work reports', status: 'done', issue: '#885', pr: '#890', parent: '4' },
    { item: '4', what: 'Nightcost', status: 'done', issue: '#886', pr: '#891', parent: '3' },
    { item: '5', what: 'Live checks', status: 'next', issue: '#887', parent: '883', dependsOn: ['release notes'] },
  ]
  const view = { key: 'sim-883', board: { key: 'sim-883', parent: 'o/r#883', revision: 1, tasks } }
  const out = render(view)
  const strip = out.indexOf('Parent loop: #885 ↔ #886')
  assert.ok(strip > 0 && strip < out.indexOf('#883 effort'), out)
  assert.ok(out.includes("Unknown dependency: 'release notes' on #887"))
  assert.ok(out.includes('3 of 4 done'), 'the loop rows count under #883')
  assert.ok(out.includes('! parent loop: #885 → #886 → #885'))
  const { exports } = load({ view })
  const rows = exports.boardRows(view.board)
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => r.guide + r.item))), ['883', '├─ 1', '├─ 3', '├─ 4', '└─ 5'])
  const buttons = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }))
    if (n.type === 'section' && 'data-problems' in n.props) buttons.push(...[].concat(n.children).flat())
    walk(n.children)
  }
  walk(register(exports).slots[0].Component({ sessionId: 's' }))
  assert.equal(buttons.length, 2, 'one line per problem')
  const clean = { ...view, board: { ...view.board, tasks: tasks.map((t) => ({ ...t, parent: t.item === '883' ? undefined : '883', dependsOn: undefined })) } }
  assert.ok(!render(clean).includes('Parent loop'))
})

test('every row keeps the dot slot; done rows a muted check; a Needs-you row only tags', () => {
  const out = render(live)
  assert.match(out, /✓ done/)
  const row1 = out.split('\n').filter((l) => l.includes('#884 Profile and guard'))
  assert.equal(row1.length, 2, 'once in Needs you, once in the tree')
  assert.equal(out.split('Owner: once CI is green, merge PR #892 by hand.').length, 2, 'the action shows only in Needs you')
  assert.ok(out.includes('[needs you]'))
  assert.match(out, /#887 Live checks and docs/)
  assert.match(out, /#884 Profile and guard PR #892/, 'PR inline on open rows too')
})

test('the drift line: hidden when off with no result; "not run yet" when configured; else the result', () => {
  assert.ok(!render(live).includes('Drift'))
  assert.ok(!render(live).includes('drift'))
  assert.ok(render({ ...live, driftConfigured: true }).includes('Drift check available · not run yet'))
  assert.ok(!render({ ...live, driftConfigured: true }).includes('never checked'))
  const drift = { checkedAt: '2026-10-25T07:00:00Z', items: [{ item: '1', status: 'done', note: '#892 merged', differs: true }] }
  const out = render({ ...live, board: { ...live.board, drift } })
  assert.ok(out.includes('1 differing') && out.includes('[drift: done]'))
})

test('ids and statuses sit in fixed-width columns with tree guides', () => {
  const { exports } = load({})
  const view = { ...live }
  const out = render(view)
  for (const s of ['├─ 1', '├─ 2', '├─ 5', '└─ 6b']) assert.ok(out.includes(s), s)
  const rows = exports.boardRows(live.board)
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => r.guide + r.item))), ['883', '├─ 1', '├─ 2', '├─ 5', '└─ 6b'])
  const widths = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }))
    if (n.type === 'span' && n.props.style && n.props.style.flex === 'none' && n.props.style.width) widths.push(n.props.style.width)
    walk(n.children)
  }
  walk(register(load({ view }).exports).slots[0].Component({ sessionId: 's' }))
  assert.deepEqual([...new Set(widths)].sort(), ['1em', '3em', '7ch', '8.5em'], 'one id, dot, status, Open and opener width for every row')
})

test('the opener and Open sit in fixed right-hand slots on every row, linked or not', () => {
  const slots = []
  const walk = (n, li) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach((x) => walk(x, li))
    if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }), li)
    if (n.type === 'li') li = n.props['data-item']
    if ('data-open-slot' in n.props || 'data-opener' in n.props) slots.push([li, 'data-opener' in n.props ? 'opener' : 'open', n.props.style.width])
    walk(n.children, li)
  }
  const view = { ...live, board: { ...live.board, parent: 'PROJ-883' } } // no links at all
  walk(register(load({ view }).exports).slots[0].Component({ sessionId: 's' }))
  walk(register(load({ view: live }).exports).slots[0].Component({ sessionId: 's' }))
  const rows = live.board.tasks.length * 2
  assert.equal(slots.filter((s) => s[1] === 'open').length, rows, 'every row has the Open slot')
  assert.equal(slots.filter((s) => s[1] === 'opener').length, rows, 'every row has the opener slot')
  assert.deepEqual([...new Set(slots.map((s) => s[1] + ' ' + s[2]))].sort(), ['open 3em', 'opener 1em'])
})

test('an opened row shows no link line; after lists only dependencies on the board; stored text as stored', () => {
  const open = render(live, { open: true })
  assert.ok(!/\blink /.test(open), open)
  assert.ok(!open.includes('https://github.com'), 'no URL in the text')
  const done = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => (t.item === '1' || t.item === '2' ? { ...t, status: 'done' } : t)) } }
  const out = render(done, { open: true })
  assert.ok(out.includes('after #884, #888'), out)
  assert.ok(!/after[^\n]*release notes/.test(out), 'the unknown dependency is not in after')
  assert.equal(out.split("! blocked by 'release notes' (not on the board)").length, 2, 'only in its flag')
  assert.ok(out.includes('why Needs item 1 merged.'), 'why as stored')
})

test('the dock: done of all work tasks, who needs you, the top open item; opens the Board; hidden unbound', () => {
  const { exports } = load({ view: live })
  const calls = register(exports)
  const dock = calls.slots.find((s) => s.entry.name === 'conversation.input.dock')
  assert.equal(dock.entry.order, 30)
  const props = dock.entry.inject('s1')
  assert.equal(props.sessionId, 's1')
  props.openBoard()
  assert.deepEqual(calls.opened, [['dsh-cockpit-board', undefined]])
  assert.equal(exports.dockModel(live).text, '1 of 4 done · 1 needs you · #884 Profile and guard')
  assert.equal(exports.dockModel(live).fraction, 0.25)
  const out = flat(text(dock.Component(props)))
  assert.ok(out.includes('1 of 4 done') && out.includes('#884 Profile and guard'), out)
  let tree
  const find = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(find); if (n.props.role === 'button') tree = n; else if (typeof n.type === 'function') find(n.type({ ...n.props, children: n.children })); else find(n.children) }
  find(dock.Component(props))
  assert.equal(typeof tree.props.onClick, 'function')
  assert.equal(tree.props.tabIndex, 0, 'keyboard reachable')
  for (const view of [{ key: null, boards: ['a'] }, { key: 'k', error: 'no such board' }, undefined]) {
    assert.equal(exports.dockModel(view), undefined)
    assert.equal(load({ view }).exports && text(register(load({ view }).exports).slots.find((s) => s.entry.name === 'conversation.input.dock').Component({ sessionId: 's' })), '')
  }
})

/** The dock's segment nodes, rendered. */
function segments(view, openBoard) {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }))
    if ('data-segment' in n.props) out.push(n)
    walk(n.children)
  }
  const { exports } = load({ view })
  const dock = register(exports).slots.find((s) => s.entry.name === 'conversation.input.dock')
  walk(dock.Component({ sessionId: 's', openBoard }))
  return out
}

test('the dock bar: one segment per work task in tree order, each with a status fill and tooltip; a click names its row', () => {
  const { exports } = load({ view: live })
  const now = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => (t.item === '2' ? { ...t, status: 'now' } : t)) } }
  assert.equal(exports.segmentsText(exports.dockModel(live)), '[!!needs you][✓][·blocked][!waiting]')
  assert.equal(exports.segmentsText(exports.dockModel(now)), '[!!needs you][◐ now][·blocked][!waiting]')
  const opened = []
  const segs = segments(now, (item) => opened.push(item))
  assert.deepEqual(segs.map((s) => [s.props['data-item'], s.props['data-segment']]), [['1', 'needs you'], ['2', 'now'], ['5', 'blocked'], ['6b', 'waiting']])
  assert.equal(segs[1].props.title, '#888 Log reader · now · claude-opus-5-5 high')
  assert.match(segs[1].props.style.background, /linear-gradient\(to right, var\(--dsw-alias-brand-primary[^)]*\) 50%/, 'now: half the accent')
  assert.ok(segs[0].props.style.boxShadow, 'needs you: an outline as well as the warn fill')
  assert.equal(segs[2].props.title, "#887 Live checks and docs · next · blocked by #884, #888, 'release notes' (not on the board)")
  assert.ok(!Object.values(segs).some((s) => /animation|transition/.test(JSON.stringify(s.props.style))), 'nothing moves')
  let stopped = false
  segs[2].props.onClick({ stopPropagation: () => { stopped = true } })
  assert.deepEqual(opened, ['5'])
  assert.ok(stopped, 'the bar\'s own open-the-Board click does not also fire')
  const calls = register(exports)
  calls.slots.find((s) => s.entry.name === 'conversation.input.dock').entry.inject('s1').openBoard('5')
  assert.equal(JSON.stringify(calls.opened), JSON.stringify([['dsh-cockpit-board', { params: { item: '5' } }]]))
})

test('the dock bar above 24 work tasks is one continuous fill, no segments', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => ({ item: String(i), what: 'w' + i, status: i < 5 ? 'done' : 'next' }))
  const view = { key: 'big', board: { key: 'big', revision: 1, tasks } }
  const { exports } = load({ view })
  assert.equal(exports.dockModel(view).continuous, true)
  assert.equal(segments(view).length, 0)
  assert.equal(exports.segmentsText(exports.dockModel(view)), '[██░░░░░░░░]')
  const at24 = { ...view, board: { ...view.board, tasks: tasks.slice(1) } }
  assert.equal(segments(at24).length, 24)
})

test('the Board body reads its navigation and survives none', () => {
  const { exports } = load({ view: live })
  const body = register(exports).slots[0].Component
  const nav = (params) => () => ({ tab: { id: 't1', navigation: { address: 'a', params, revision: 1 } } })
  for (const useTabInfo of [undefined, nav(undefined), nav({ item: '5' })]) assert.ok(text(body({ sessionId: 's', useTabInfo })).includes('#887 Live checks and docs'))
})

test('Open links the pr, else the issue, through the board parent\'s repo', () => {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }))
    if (n.type === 'a') out.push(n.props)
    walk(n.children)
  }
  const { exports } = load({ view: live })
  walk(register(exports).slots[0].Component({ sessionId: 's' }))
  const hrefs = out.map((a) => a.href)
  assert.ok(hrefs.includes('https://github.com/Romany-Saad/resturants-app/pull/892'))
  assert.ok(hrefs.includes('https://github.com/Romany-Saad/resturants-app/issues/883'))
  for (const a of out) { assert.equal(a.target, '_blank'); assert.match(a.rel, /noopener/) }
  const noRepo = load({ view: { ...live, board: { ...live.board, parent: 'PROJ-883' } } }).exports
  out.length = 0
  walk(register(noRepo).slots[0].Component({ sessionId: 's' }))
  assert.deepEqual(out, [])
})

test('the tool card title comes from the args, or the result meta', () => {
  const { exports } = load({})
  const m = (props) => exports.toolCardModel({ toolName: 'board_update', ...props })
  assert.equal(m({ phase: 'start', block: { argsRaw: JSON.stringify({ item: '2', set: { status: 'done' } }) } }).summary, 'update 2 → done')
  assert.equal(m({ phase: 'preparing', block: {} }).state, 'running')
  const result = { call: { argsRaw: JSON.stringify({ key: 'sim-883' }) }, meta: { title: 'open sim-883 (new)' }, content: [{ type: 'text', text: '{"ok":true,"tree":"x"}' }], isError: false }
  assert.equal(exports.toolCardModel({ toolName: 'board_open', phase: 'result', block: result }).summary, 'open sim-883 (new)')
  const failed = { call: { argsRaw: '{}' }, content: [{ type: 'text', text: '{"ok":false,"code":"not_bound","message":"m"}' }], isError: false }
  const f = exports.toolCardModel({ toolName: 'board_read', phase: 'result', block: failed })
  assert.equal(f.state, 'error')
  assert.equal(f.summary, 'read board · not_bound')
  const Row = register(exports).slots.find((s) => s.entry.key === 'board_update').Component
  const card = flat(text(Row({ toolName: 'board_update', phase: 'start', block: { argsRaw: JSON.stringify({ item: '1', remove: true }) }, useDisclosure: () => ({ expanded: false, toggle: () => {} }) })))
  assert.match(card, /Board.*remove 1/)
})

test('the header time is local time plus how long ago', () => {
  const { exports } = load({})
  const at = new Date(2026, 9, 25, 15, 22, 0)
  assert.equal(exports.whenText(at.toISOString(), at.getTime() + 2 * 60000), '15:22 · 2 min ago')
  assert.equal(exports.whenText(at.toISOString(), at.getTime() + 10000), '15:22 · just now')
  assert.equal(exports.whenText(at.toISOString(), at.getTime() + 3 * 86400000), '2026-10-25 15:22 · 3 d ago')
})

test('an unbound session lists the boards', () => {
  const { exports } = load({ view: { key: null, boards: ['a', 'b'] } })
  const out = text(register(exports).slots[0].Component({ sessionId: 's2' }))
  assert.match(out, /no board open/)
  assert.match(out, /a\s*\n?b/)
})

test('treeOrder nests children and draws loops and lost parents under the board root', () => {
  const { exports } = load({})
  const rows = exports.treeOrder([{ item: '1' }, { item: '2', parent: '1' }, { item: '3', parent: '3' }, { item: '4', parent: '9' }])
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => [r.task.item, r.depth]))), [['1', 0], ['2', 1], ['3', 1], ['4', 1]])
})
