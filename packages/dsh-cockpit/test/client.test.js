// Smoke test of the built browser bundle, client/client.js, without a browser:
// run it in a VM with a stub module loader and a stub React that renders
// function components to text, then check the tab registration and the view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

function load(state) {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: () => [state, () => {}],
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
})

test('a bound board renders the tree, fields, flags, drift and readyCommand', () => {
  const view = {
    key: 'bosla-883',
    board: {
      key: 'bosla-883', parent: 'R/r#883', revision: 8, updatedAt: 't',
      tasks: [
        { item: '2', what: 'board', status: 'now', issue: '#885' },
        { item: '2a', what: 'reader', status: 'waiting', parent: '2', dependsOn: ['1'], pr: '#902', provider: 'codex', model: 'gpt-6.1-sol', effort: 'high', readyCommand: 'gh pr merge 902' },
      ],
      drift: { checkedAt: 'c', items: [{ item: '2a', status: 'done', note: '#902 merged', differs: true }] },
    },
    flags: [{ item: '2a', code: 'unknown_dependency', ref: '1' }],
  }
  const { exports } = load({ view })
  const Body = register(exports).slots[0].Component
  const out = text(Body({ sessionId: 's1' })).replace(/[ \t]+/g, ' ')
  for (const s of ['bosla-883', 'revision 8', '(ongoing)', '(warning)', 'issue #885', 'pr #902', 'codex · gpt-6.1-sol · high',
    'after 1', '! unknown dependency 1', '2a: unknown dependency 1', 'drift: done (#902 merged)', '1 differing', 'command gh pr merge 902', 'copy']) {
    assert.ok(out.includes(s), 'missing ' + JSON.stringify(s) + ' in\n' + out)
  }
  assert.ok(out.indexOf('board') < out.indexOf('reader'))
})

const liveLike = {
  tasks: [
    { item: '1', what: 'Profile', status: 'waiting', why: 'Blocker: X.', issue: '#884', nextAction: 'Owner: decide.', parent: '883' },
    { item: '2', what: 'Log reader', status: 'done', issue: '#888', parent: '883' },
    { item: '3', what: 'Reports', status: 'now', issue: '#885', nextAction: 'Builder: build #885.', parent: '883', dependsOn: ['2'] },
    { item: '5', what: 'Docs', status: 'next', issue: '#887', parent: '883', dependsOn: ['1', '3'] },
    { item: '883', what: 'effort', status: 'next', issue: '#883' },
    { item: '7', what: 'After the reader', status: 'next', parent: '883', dependsOn: ['2'] },
    { item: '8', what: 'After a ghost', status: 'next', dependsOn: ['ghost'] },
    { item: '6b', what: 'Rule', status: 'waiting', why: 'Starts on release.', nextAction: 'Hub: start later.', dependsOn: ['5'], extra: { startCondition: 'released' }, readyCommand: 'gh issue create' },
    { item: '9', what: 'Done one', status: 'done', nextAction: 'stale' },
  ],
}

test('ready: a next task whose dependencies are all done, or that has none', () => {
  const { exports } = load({})
  const ready = Object.fromEntries(exports.boardRows(liveLike).map((r) => [r.item, r.ready]))
  assert.deepEqual(ready, { 883: true, 1: false, 2: false, 3: false, 5: false, 7: true, 8: false, '6b': false, 9: false })
})

test('dependencies show the issue of the task they name, else the item', () => {
  const { exports } = load({})
  const after = Object.fromEntries(exports.boardRows(liveLike).map((r) => [r.item, r.after.join(', ')]))
  assert.equal(after['3'], '#888')
  assert.equal(after['5'], '#884, #885')
  assert.equal(after['6b'], '#887')
  assert.equal(after['8'], 'ghost')
})

test('why, nextAction and startCondition show where the brief asks', () => {
  const { exports } = load({})
  const rows = Object.fromEntries(exports.boardRows(liveLike).map((r) => [r.item, r]))
  assert.equal(rows['1'].why, 'Blocker: X.')
  assert.equal(rows['1'].nextAction, 'Owner: decide.')
  assert.equal(rows['3'].nextAction, 'Builder: build #885.')
  assert.equal(rows['3'].why, undefined)
  assert.equal(rows['9'].nextAction, undefined)
  assert.equal(rows['6b'].startCondition, 'released')
  const bound = load({ view: { key: 'k', board: { key: 'k', revision: 1, tasks: liveLike.tasks }, flags: [] } }).exports
  const out = text(register(bound).slots[0].Component({ sessionId: 's' })).replace(/[ \t]+/g, ' ')
  for (const s of ['[ready]', 'after #888', 'why Starts on release.', 'starts when released', 'next Hub: start later.', 'command gh issue create']) {
    assert.ok(out.includes(s), 'missing ' + JSON.stringify(s) + ' in\n' + out)
  }
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

test('treeRows nests children and draws loops as roots', () => {
  const { exports } = load({})
  const rows = exports.treeRows([{ item: '1' }, { item: '2', parent: '1' }, { item: '3', parent: '3' }, { item: '4', parent: '9' }])
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((r) => [r.task.item, r.depth]))), [['1', 0], ['2', 1], ['3', 0], ['4', 0]])
})
