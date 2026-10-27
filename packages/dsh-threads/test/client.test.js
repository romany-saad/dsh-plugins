import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// Load the real bundle the way the browser does.
function loadBundle() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let registered
  const window = { __ModuleLoader__: { load: (entry) => { registered = entry } } }
  vm.runInNewContext(source, { window })
  assert.equal(registered.id, '@rs-dsh/dsh-threads')
  return registered.factory(() => { throw new Error('no requires at load time') })
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const bundle = loadBundle()
const c = bundle._internals

test('bundle id, name and inject match package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(bundle.name, pkg.name)
  assert.deepEqual([...bundle.inject].sort(), ['conversation', 'inputTriggers', 'locale', 'sessions', 'slots', 'uiConversation'])
})

// Every class this bundle styles is its own. dsh-cockpit's "dshc-" prefix
// once caught this plugin's .dshc-bar, which turned cockpit's progress bar
// into a fixed toolbar. Each sibling plugin's bundle is read as text.
test('CSS class names do not collide with the other rs-dsh plugins', () => {
  const classes = (file) => new Set(readFileSync(new URL(file, import.meta.url), 'utf8').match(/\bdsh[a-z]{1,3}-[a-z0-9-]+/g) ?? [])
  // dshq-bar is dsh-quote's toolbar, read to sit beside it, never styled.
  const own = [...classes('../client.js')].filter((c) => c !== 'dshq-bar')
  assert.deepEqual(own.filter((c) => !c.startsWith('dshth-')), [], 'one prefix, dshth-')
  for (const sibling of ['../../dsh-cockpit/client/client.js', '../../dsh-quote/client.js']) {
    const theirs = classes(sibling)
    const shared = own.filter((c) => theirs.has(c))
    assert.deepEqual(shared, [], sibling + ' shares ' + shared.join(', '))
  }
})

test('row keys parse into anchors and back', () => {
  assert.deepEqual(plain(c.parseNodeKey('13:input-message570d9a15-f94e')), { kind: 'user', messageId: '570d9a15-f94e' })
  assert.deepEqual(plain(c.parseNodeKey('14:assistant-step3:12')), { kind: 'assistant', turn: 3, step: 12 })
  assert.equal(c.parseNodeKey('9:turn-tail1'), undefined)
  assert.equal(c.parseNodeKey('14:assistant-stepx'), undefined)
  assert.equal(c.nodeKeyOf({ kind: 'user', messageId: 'abc' }), '13:input-messageabc')
  assert.equal(c.nodeKeyOf({ kind: 'assistant', turn: 3, step: 12 }), '14:assistant-step3:12')
  assert.equal(c.nodeKeyOf({ kind: 'reasoning', turn: 1, step: 1, block: 0 }), '14:assistant-step1:1')
})

test('locate finds a passage regardless of whitespace, and picks the repeat its context matches', () => {
  const page = c.stripSpace('Retry it. Then retry it. Finally retry it once more.')
  const at = c.locate(page, { text: 'retry it', prefix: 'Then ', suffix: '. Finally' })
  assert.equal(page.slice(at - 4, at), 'Then')
  assert.equal(c.locate(page, { text: 'Retry\n it', prefix: '', suffix: '. Then' }), 0)
  assert.equal(c.locate(page, { text: 'absent' }), -1)
})

test('a thread serializes for the model and the sent bubble parses it back', () => {
  const thread = { passage: 'keeps </passage> tags', messages: [{ role: 'user', text: 'why </comment>?' }, { role: 'ai', text: 'because' }] }
  const prompt = c.serializeThread(thread) + '\nWhat now?'
  const m = c.threadRule.match(prompt, 0)
  assert.equal(m.start, 0)
  assert.deepEqual(plain(m.data), thread)
  assert.equal(prompt.slice(m.end), 'What now?')
  assert.equal(c.threadRule.match('mentions <comment-thread> inline', 0), undefined)
})

test('the chip ref carries the thread, so a restored draft still serializes', () => {
  const thread = { anchor: { text: 'the passage' }, messages: [{ id: '1', role: 'user', text: 'q', time: 1 }, { id: '2', role: 'ai', text: 'a', time: 2, model: 'm' }] }
  const insert = c.makeInsert(thread)
  assert.deepEqual(plain(c.decodeRef(insert.ref)), { passage: 'the passage', messages: [{ role: 'user', text: 'q' }, { role: 'ai', text: 'a' }] })
  assert.equal(insert.clipboardText, '> the passage')
  assert.throws(() => c.decodeRef('{}'))
})

test('chips stack at the top of the draft and shift other references', () => {
  const file = { source: 'reference', ref: '@a.ts', offset: 4, length: 5, label: 'a.ts', clipboardText: '@a.ts' }
  let draft = { text: 'see @a.ts', references: [file] }
  const one = c.makeInsert({ anchor: { text: 'one' }, messages: [] })
  const two = c.makeInsert({ anchor: { text: 'two' }, messages: [] })
  draft = c.stackChip(draft, one)
  draft = c.stackChip(draft, two)
  assert.equal(draft.text, '> one\n> two\nsee @a.ts')
  for (const r of draft.references) assert.equal(draft.text.slice(r.offset, r.offset + r.length), r.clipboardText)
})
