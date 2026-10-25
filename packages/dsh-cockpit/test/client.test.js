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
    useState: (init) => [typeof init === 'function' ? init() : init && init.loading ? state : init === false ? open : init, () => {}],
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
  }
  const primitives = { Tag: (p) => '[' + [].concat(p.children).join('') + ']' }
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
  if (node.type === 'svg') return ''
  return text(node.children) + (['li', 'div', 'p', 'header', 'section', 'dd', 'button'].includes(node.type) ? '\n' : ' ')
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

/** Every rendered element, functions expanded. */
function nodes(view, options) {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children }))
    out.push(n)
    walk(n.children)
  }
  walk(register(load({ view }, options).exports).slots[0].Component({ sessionId: 's' }))
  return out
}
const cls = (n) => n.props.className || ''

test('Needs you: one card per owner task at the top with title, next step, Open PR and the CommandBox; guessed without waitingOn', () => {
  const out = render(live)
  const needs = out.indexOf('Needs you')
  assert.ok(needs >= 0 && needs < out.indexOf('#888 Log reader'), out)
  assert.ok(out.includes('Needs you (guessed)'))
  for (const s of ['#884 Profile and guard', 'Owner: once CI is green, merge PR #892 by hand.', 'Open PR #892', 'gh pr merge 892 --squash', 'Copy']) assert.ok(out.slice(needs).includes(s), s + ' in\n' + out)
  assert.equal(out.split('gh pr merge 892 --squash').length, 2, 'the command shows once, in the card')
  assert.equal(nodes(live).filter((n) => 'data-command-box' in n.props).length, 1)
  const set = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => (t.item === '6b' ? { ...t, waitingOn: 'release' } : t)) } }
  assert.ok(!render(set).includes('Needs you'), 'waitingOn set somewhere, nobody on owner: no block')
  const owner = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => (t.item === '1' ? { ...t, waitingOn: 'Owner' } : t)) } }
  assert.ok(render(owner).includes('Needs you') && !render(owner).includes('(guessed)'))
})

test('header: key and parent left, revision and time right; the drift line below only when configured or present', () => {
  const out = render(live)
  assert.match(out, /sim-883 Romany-Saad\/resturants-app#883 rev 25 · t/)
  assert.ok(!out.includes('Drift'))
  assert.ok(render({ ...live, driftConfigured: true }).includes('Drift check: not run yet'))
  const drift = { checkedAt: '2026-10-25T07:00:00Z', items: [{ item: '1', status: 'done', note: '#892 merged', differs: true }] }
  const d = render({ ...live, board: { ...live.board, drift } })
  assert.ok(d.includes('Drift check: 1 differing') && d.includes('[drift: done]'), d)
  const { exports } = load({})
  const at = new Date(2026, 9, 25, 15, 22, 0)
  assert.equal(exports.headerMeta({ revision: 3, updatedAt: at.toISOString() }, at.getTime() + 9 * 60000), 'rev 3 · 15:22 · 9 min ago')
})

test('rows: fixed columns id · status · title · PR · chevron on every row, keyed by item in tree order', () => {
  const all = nodes(live)
  const rows = all.filter((n) => cls(n) === 'dshc-row')
  assert.equal(rows.length, live.board.tasks.length)
  for (const r of rows) {
    const kids = r.children.filter(Boolean)
    assert.deepEqual(kids.slice(0, 5).map((k) => (typeof k.type === 'string' ? k.type + '.' + (cls(k).split(' ').pop() || '') : 'fn')).map((x) => x.replace(/\.$/, '')).slice(0, 4), ['span.dshc-cid', 'span.dshc-cst', 'span.dshc-ct', 'span.dshc-cpr'])
  }
  assert.deepEqual(all.filter((n) => n.type === 'li').map((n) => n.props['data-item']), ['883', '1', '2', '5', '6b'])
  const { exports } = load({})
  assert.match(exports.CSS, /grid-template-columns:36px 68px minmax\(0,1fr\) 60px 20px/)
  assert.ok(!/animation|transition/.test(exports.CSS), 'no animation')
})

test('status marks: a check for done, a ring for next, dots for now and waiting; the word always shows', () => {
  const all = nodes(live)
  const markOf = (item) => {
    const li = all.find((n) => n.type === 'li' && n.props['data-item'] === item)
    const found = []
    const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (typeof n.type === 'function') return walk(n.type({ ...n.props, children: n.children.length ? n.children : n.props.children })); if (/dshc-(ring|dot|check)/.test(cls(n))) found.push(cls(n)); walk(n.children) }
    walk(li)
    return found.join(' ')
  }
  assert.match(markOf('2'), /dshc-check/)
  assert.match(markOf('5'), /dshc-ring/)
  assert.match(markOf('6b'), /dshc-dot dshc-dot-waiting/)
  assert.equal(markOf('883'), '', 'the parent row has no status mark')
  assert.match(render(live), /2 \| ?done|done/)
})

test('open rows: one Next line, a lock line for blockers, Needs you · see top, problems in place; titles wrap, done titles truncate', () => {
  const out = render(live)
  assert.ok(out.includes('Next: Hub: start once 0.1 is released.'), out)
  assert.ok(!out.includes('Starts only once 0.1 is released.'), 'the other notes only when opened')
  assert.ok(out.includes('Blocked by #884 (waiting)'), out)
  assert.ok(out.includes('Blocked by #887 (next)'))
  assert.ok(out.includes('[Needs you · see top]'))
  assert.equal(out.split('Owner: once CI is green, merge PR #892 by hand.').length, 2, 'the owner ask shows only in Needs you')
  assert.equal(out.split("Blocked by 'release notes' (not on the board)").length, 2, 'the flag shows once, under its title')
  const all = nodes(live)
  const title = (item) => all.find((n) => n.type === 'li' && n.props['data-item'] === item)
  const titleSpan = (li) => { let t; const walk = (n) => { if (!n || typeof n !== 'object' || t) return; if (Array.isArray(n)) return n.forEach(walk); if (cls(n) === 'dshc-ct') { t = n.children.filter(Boolean).pop(); return } walk(n.children) }; walk(li); return t }
  assert.equal(cls(titleSpan(title('5'))), 'dshc-wrap')
  assert.equal(cls(titleSpan(title('2'))), 'dshc-trunc')
  assert.equal(titleSpan(title('2')).props.title, '#888 Log reader', 'full title in the tooltip')
})

test('the parent row: progress in words with who needs you, and the thin segmented bar', () => {
  const out = render(live)
  assert.ok(out.includes('1 of 4 done · 1 needs you'), out)
  const bars = nodes(live).filter((n) => n.props.role === 'progressbar')
  assert.equal(bars.length, 1)
  assert.equal(bars[0].children.flat().length, 4, 'one segment per work task')
})

test('nested rows indent 16 px per level with an elbow; id and status stay put', () => {
  const tasks = [{ item: 'r', what: 'root', status: 'now' }, { item: 'a', what: 'a', status: 'next', parent: 'r' }, { item: 'a1', what: 'a1', status: 'next', parent: 'a' }]
  const view = { key: 'k', board: { key: 'k', revision: 1, tasks } }
  const all = nodes(view)
  assert.deepEqual(all.filter((n) => cls(n) === 'dshc-indent').map((n) => n.props.style.width), [16])
  assert.equal(all.filter((n) => cls(n) === 'dshc-elbow').length, 1)
})

test('the expanded row: a key/value grid and the CommandBox when there is a command; Needs-you rows keep theirs in the card', () => {
  const open = render(live, { open: true })
  for (const s of ['Reason Starts only once 0.1 is released.', 'Start when dsh-cockpit 0.1 released', 'Model claude-opus-5-5 · high']) assert.ok(open.includes(s), s + ' in\n' + open)
  assert.equal(open.split('Hub: start once 0.1 is released.').length, 2, 'never the same text twice')
  assert.ok(!open.includes('https://github.com'), 'no URL in the text')
  const cmd = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => (t.item === '5' ? { ...t, readyCommand: 'git worktree add x -b y' } : t)) } }
  const boxes = nodes(cmd, { open: true }).filter((n) => 'data-command-box' in n.props)
  assert.equal(boxes.length, 2, 'the Needs-you card and the expanded #887')
  assert.equal(nodes(cmd).filter((n) => 'data-command-box' in n.props).length, 1, 'collapsed: only the card')
  const chev = nodes(live).filter((n) => cls(n) === 'dshc-chev')
  assert.ok(chev.length && chev.every((n) => n.props['aria-expanded'] === false))
})

test('board data problems: one line per problem with its rows and ↓ to the row; none, no section', () => {
  const tasks = [
    { item: '883', what: '#883 effort', status: 'now', issue: '#883' },
    { item: '1', what: 'Profile and guard', status: 'done', issue: '#884', pr: '#892', parent: '883' },
    { item: '3', what: 'Work reports', status: 'done', issue: '#885', pr: '#890', parent: '4' },
    { item: '4', what: 'Nightcost', status: 'done', issue: '#886', pr: '#891', parent: '3' },
    { item: '5', what: 'Live checks', status: 'next', issue: '#887', parent: '883', dependsOn: ['release notes'] },
  ]
  const view = { key: 'sim-883', board: { key: 'sim-883', parent: 'o/r#883', revision: 1, tasks } }
  const out = render(view)
  const at = out.indexOf('Board data problems')
  assert.ok(at > 0 && at < out.indexOf('#883 effort'), out)
  assert.ok(out.includes('Parent loop #885, #886'), out)
  assert.ok(out.includes('Unknown dependency #887'))
  assert.ok(out.includes('3 of 4 done'), 'the loop rows count under #883')
  assert.ok(out.includes('Parent loop: #885 → #886 → #885'), 'the flag in place')
  const lines = nodes(view).filter((n) => cls(n) === 'dshc-prob')
  assert.equal(lines.length, 2)
  assert.equal(lines[0].props.title, 'Parent loop: #885 ↔ #886')
  const { exports } = load({ view })
  assert.deepEqual(JSON.parse(JSON.stringify(exports.boardRows(view.board).map((r) => r.item))), ['883', '1', '3', '4', '5'], 'bad data never moves a row')
  const clean = { ...view, board: { ...view.board, tasks: tasks.map((t) => ({ ...t, parent: t.item === '883' ? undefined : '883', dependsOn: undefined })) } }
  assert.ok(!render(clean).includes('Board data problems'))
})

test('the PR column links the pr through the parent repo; Open links the pr, else the issue', () => {
  const hrefs = nodes(live).filter((n) => n.type === 'a').map((a) => a.props)
  assert.ok(hrefs.some((a) => a.href === 'https://github.com/Romany-Saad/resturants-app/pull/892'))
  assert.ok(hrefs.some((a) => a.href === 'https://github.com/Romany-Saad/resturants-app/pull/889'))
  for (const a of hrefs) { assert.equal(a.target, '_blank'); assert.match(a.rel, /noopener/) }
  assert.deepEqual(nodes({ ...live, board: { ...live.board, parent: 'PROJ-883' } }).filter((n) => n.type === 'a'), [])
  assert.match(render({ ...live, board: { ...live.board, parent: 'PROJ-883' } }), /PR #889/, 'the PR text stays without a link')
})

test('the empty state: no board in this session, with the design line', () => {
  const out = render({ key: null, boards: ['a', 'b'] })
  assert.ok(out.includes('No board in this session'))
  assert.ok(out.includes('A hub agent binds a board when it starts to coordinate work. The board shows here after that.'))
})

test('the CommandBox copy state machine: Copied, Copy failed, back to Copy', async () => {
  const { exports } = load({})
  assert.equal(exports.copyStep('idle', 'copied'), 'copied')
  assert.equal(exports.copyStep('idle', 'failed'), 'failed')
  assert.equal(exports.copyStep('copied', 'reset'), 'idle')
  assert.equal(exports.copyStep('failed', 'click'), 'failed')
  const got = []
  assert.equal(await exports.copyText('x', { writeText: async (t) => { got.push(t) } }), 'copied')
  assert.deepEqual(got, ['x'])
  assert.equal(await exports.copyText('x', { writeText: async () => { throw new Error('denied') } }), 'failed')
  assert.equal(await exports.copyText('x', undefined), 'failed')
  assert.match(exports.CSS, /\.dshc-cmd\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/)
  assert.match(exports.CSS, /white-space:pre-wrap;overflow-wrap:anywhere/)
})

test('the strip: segments, then key · done · focus · Board ›; the needs-you variant with Copy command', () => {
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
  assert.equal(exports.dockModel(live).line, '⚠ Needs you: once CI is green, merge PR #892 by hand for #884 Profile and guard · Copy command · Board ›')
  const out = flat(text(dock.Component(props)))
  assert.ok(out.includes('Needs you:') && out.includes('Copy command') && out.includes('Board ›'), out)
  const calm = { ...live, board: { ...live.board, tasks: live.board.tasks.map((t) => (t.item === '1' ? { ...t, status: 'done' } : t)) } }
  assert.equal(exports.dockModel(calm).line, "sim-883 · 2 of 4 done · #887 blocked by 'release notes' (not on the board) · Board ›")
  let tree
  const find = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(find); if (n.props.role === 'button') tree = n; else if (typeof n.type === 'function') find(n.type({ ...n.props, children: n.children })); else find(n.children) }
  find(dock.Component(props))
  assert.equal(typeof tree.props.onClick, 'function')
  assert.equal(tree.props.tabIndex, 0, 'keyboard reachable')
  for (const view of [{ key: null, boards: ['a'] }, { key: 'k', error: 'no such board' }, undefined]) {
    assert.equal(exports.dockModel(view), undefined)
    assert.equal(text(register(load({ view }).exports).slots.find((s) => s.entry.name === 'conversation.input.dock').Component({ sessionId: 's' })), '')
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
  assert.equal(exports.segmentsText(exports.dockModel(live)), '[!!needs you][✓][·blocked][…waiting]')
  assert.equal(exports.segmentsText(exports.dockModel(now)), '[!!needs you][◐ now][·blocked][…waiting]')
  const opened = []
  const segs = segments(now, (item) => opened.push(item))
  assert.deepEqual(segs.map((s) => [s.props['data-item'], s.props['data-segment']]), [['1', 'needs you'], ['2', 'now'], ['5', 'blocked'], ['6b', 'waiting']])
  assert.equal(segs[1].props.title, '#888 Log reader · now · claude-opus-5-5 high')
  assert.match(segs[1].props.style.background, /linear-gradient\(to right, var\(--dsw-alias-state-business-primary\) 50%/, 'now: half the accent')
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

test('treeOrder nests children and draws loops and lost parents under the board root', () => {
  const { exports } = load({})
  const rows = exports.treeOrder([{ item: '1' }, { item: '2', parent: '1' }, { item: '3', parent: '3' }, { item: '4', parent: '9' }])
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => [r.task.item, r.depth]))), [['1', 0], ['2', 1], ['3', 1], ['4', 1]])
})