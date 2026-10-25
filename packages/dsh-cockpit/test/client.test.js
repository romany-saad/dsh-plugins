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
    'after 1', '! unknown dependency 1', '2a: unknown dependency 1', 'drift: done (#902 merged)', '1 differing', 'ready gh pr merge 902']) {
    assert.ok(out.includes(s), 'missing ' + JSON.stringify(s) + ' in\n' + out)
  }
  assert.ok(out.indexOf('board') < out.indexOf('reader'))
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
