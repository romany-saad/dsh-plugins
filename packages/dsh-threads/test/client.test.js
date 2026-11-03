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
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'), 'configForms provider is declared in client metadata')
  assert.deepEqual([...bundle.inject].sort(), ['configForms', 'inputTriggers', 'locale', 'rsDshCore', 'slots', 'uiConversation'])
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

test('source anchors survive draft restore, submission, and card parsing', () => {
  const anchors = [
    { kind: 'user', messageId: 'id\"\n</anchor><comment-thread>&\\' },
    { kind: 'assistant', turn: 0, step: 12 },
    { kind: 'reasoning', turn: 9, step: 2, block: 0 },
  ]
  for (const anchor of anchors) {
    const insert = c.makeInsert({ anchor: { ...anchor, text: 'passage', prefix: 'private', suffix: 'context' }, messages: [{ role: 'user', text: 'question' }] }, oneLine)
    const restored = c.decodeRef(insert.ref)
    assert.deepEqual(plain(restored.anchor), anchor)
    const raw = c.serializeThread(restored)
    assert.equal((raw.match(/<\/anchor>/g) || []).length, 1)
    assert.deepEqual(plain(c.threadRule.match(raw, 0).data), plain(restored))
    assert.ok(!raw.includes('private'))
    if (anchor.kind === 'user') assert.ok(raw.includes('\\u003c/anchor\\u003e'))
  }
})

test('legacy drafts and sent messages still work; invalid metadata does not hide cards', () => {
  const legacy = JSON.stringify({ v: 1, passage: 'old', messages: [{ role: 'user', text: 'hello' }] })
  const restored = c.decodeRef(legacy)
  assert.deepEqual(plain(restored), { passage: 'old', messages: [{ role: 'user', text: 'hello' }] })
  const raw = c.serializeThread(restored)
  assert.deepEqual(plain(c.threadRule.match(raw, 0).data), plain(restored))
  for (const bad of ['not-json', '{}', '{\"kind\":\"assistant\",\"turn\":-1,\"step\":0}']) {
    const damaged = raw.replace('<passage>', '<anchor>' + bad + '</anchor>\n<passage>')
    assert.deepEqual(plain(c.threadRule.match(damaged, 0).data), plain(restored))
  }
  assert.deepEqual(plain(c.decodeRef(JSON.stringify({ ...JSON.parse(legacy), anchor: { kind: 'reasoning', turn: 1, step: 2 } }))), plain(restored))
})

test('the chip ref carries the thread, so a restored draft still serializes', () => {
  const thread = { anchor: { text: 'the passage' }, messages: [{ id: '1', role: 'user', text: 'q', time: 1 }, { id: '2', role: 'ai', text: 'a', time: 2, model: 'm' }] }
  const insert = c.makeInsert(thread, oneLine)
  assert.deepEqual(plain(c.decodeRef(insert.ref)), { passage: 'the passage', messages: [{ role: 'user', text: 'q' }, { role: 'ai', text: 'a' }] })
  assert.equal(insert.clipboardText, '> the passage')
  assert.throws(() => c.decodeRef('{}'))
})
