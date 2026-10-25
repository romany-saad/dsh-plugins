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
    slots: { inject: (_name, fn) => fn(), register: (entry, Component) => { calls.slots.push({ entry, Component }); return () => {} } },
  }
  exports.apply(ctx)
  return calls
}

test('the bundle registers under the package id with a Board tab and its body', () => {
  const { row, exports } = load({ loading: true })
  assert.equal(row.id, '@romany-saad/dsh-cockpit')
  assert.deepEqual([...exports.inject], ['slots', 'sidebarRightTabs'])
  const { tabs, slots } = register(exports)
  assert.equal(tabs[0].id, '@romany-saad/dsh-cockpit')
  assert.equal(tabs[0].title(), 'Board')
  assert.equal(slots[0].entry.name, 'sidebar.right.pane.tab')
  assert.equal(slots[0].entry.key, tabs[0].id)
  assert.equal(slots[0].entry.inject('s1').sessionId, 's1')
  assert.deepEqual(slots.slice(1).map((s) => [s.entry.name, s.entry.key]), ['board_open', 'board_read', 'board_add', 'board_update'].map((k) => ['tool.call.toolview', k]))
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
  assert.equal(out.split('unknown dependency release notes').length, 2, out)
  assert.ok(out.includes('1 flag'))
  assert.ok(!out.includes('Flags:'))
})

test('the drift line shows only when drift is configured or a result exists', () => {
  assert.ok(!render(live).includes('Drift'))
  assert.ok(render({ ...live, driftConfigured: true }).includes('Drift: never checked'))
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
  assert.deepEqual([...new Set(widths)].sort(), ['7.5em', '7ch'], 'one id width and one status width for every row')
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

test('treeOrder nests children and draws loops as roots', () => {
  const { exports } = load({})
  const rows = exports.treeOrder([{ item: '1' }, { item: '2', parent: '1' }, { item: '3', parent: '3' }, { item: '4', parent: '9' }])
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => [r.task.item, r.depth]))), [['1', 0], ['2', 1], ['3', 0], ['4', 0]])
})
