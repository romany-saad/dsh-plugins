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
function load({ open = false } = {}) {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => [typeof init === 'function' ? init() : init === false ? open : init, () => {}],
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
  }
  let row
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: (r) => { row = r } } } })
  const exports = row.factory((name) => { if (name !== 'react') throw new Error('unexpected require ' + name); return React })
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

test('the bundle registers the Board tab and its body, and requires only react', () => {
  const { row, exports } = load()
  assert.equal(row.id, '@romany-saad/dsh-cockpit')
  assert.deepEqual([...exports.inject], ['slots', 'sidebarRightTabs'])
  const calls = { tabs: [], slots: [] }
  exports.apply({
    effect: (fn) => fn(),
    sidebarRightTabs: { register: (d) => { calls.tabs.push(d); return () => {} } },
    slots: { inject: (_name, fn) => fn(), register: (entry, Component) => { calls.slots.push({ entry, Component }); return () => {} } },
  })
  assert.equal(calls.tabs.length, 1)
  assert.equal(calls.tabs[0].id, '@romany-saad/dsh-cockpit')
  assert.equal(calls.tabs[0].title(), 'Board', 'still "Board" in 0.1')
  assert.deepEqual(calls.slots.map((s) => s.entry.name), ['sidebar.right.pane.tab'], 'the tab only: no strip, no tool cards in this step')
  assert.equal(calls.slots[0].entry.key, calls.tabs[0].id)
  assert.equal(JSON.stringify(calls.slots[0].entry.inject('s1')), '{"sessionId":"s1"}')
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
  // now: the left half filled with the info accent and an info outline, never solid, never moving.
  assert.match(exports.CSS, /\[data-segment=now\]\{background:linear-gradient\(to right,var\(--dshc-info\) 50%,transparent 50%\);box-shadow:inset 0 0 0 1px var\(--dshc-info\)\}/)
  assert.doesNotMatch(exports.CSS, /\[data-segment=now\]\{[^}]*(animation|transition)/)
  assert.match(exports.CSS, /\[data-segment=waiting\]\{background:/)
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
