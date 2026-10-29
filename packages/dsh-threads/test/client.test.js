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

// The core's oneLine, from the real dsh-core bundle, as apply() passes it.
function coreOneLine() {
  const source = readFileSync(new URL('../../dsh-core/client.js', import.meta.url), 'utf8')
  let registered
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (entry) => { registered = entry } } } })
  return registered.factory(() => { throw new Error('no requires at load time') })._internals.oneLine
}
const oneLine = coreOneLine()

test('bundle id, name and inject match package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(bundle.name, pkg.name)
  assert.deepEqual([...bundle.inject].sort(), ['inputTriggers', 'locale', 'rsDshCore', 'slots', 'uiConversation'])
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
  const insert = c.makeInsert(thread, oneLine)
  assert.deepEqual(plain(c.decodeRef(insert.ref)), { passage: 'the passage', messages: [{ role: 'user', text: 'q' }, { role: 'ai', text: 'a' }] })
  assert.equal(insert.clipboardText, '> the passage')
  assert.throws(() => c.decodeRef('{}'))
})
