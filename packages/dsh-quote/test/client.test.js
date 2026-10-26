import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// Load the real bundle the way the browser does: it calls
// window.__ModuleLoader__.load({ id, factory }) and we run the factory.
function loadBundle() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let registered
  const window = { __ModuleLoader__: { load: (entry) => { registered = entry } } }
  vm.runInNewContext(source, { window })
  assert.equal(registered.id, '@rs-dsh/dsh-quote')
  return registered.factory(() => { throw new Error('no requires at load time') })
}

// Objects made inside the VM have another realm's prototypes; compare values.
const plain = (value) => JSON.parse(JSON.stringify(value))

const bundle = loadBundle()
const q = bundle._internals

test('bundle id, name and inject match package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(bundle.name, pkg.name)
  assert.deepEqual([...bundle.inject].sort(), ['conversation', 'inputTriggers', 'locale', 'sessions', 'slots', 'uiConversation'])
  assert.equal(typeof bundle.apply, 'function')
})

test('ref round-trips text and note', () => {
  const quote = { text: 'line one\nline "two"', note: 'why?' }
  assert.deepEqual(plain(q.decodeRef(q.encodeRef(quote))), quote)
  assert.deepEqual(plain(q.decodeRef(q.encodeRef({ text: 'x' }))), { text: 'x', note: '' })
  assert.throws(() => q.decodeRef('{"v":1}'))
})

test('serialized quote is parsed back by the user-text rule', () => {
  const quote = { text: 'retry loop </quote> here', note: 'is this </note> safe?' }
  const prompt = q.serializeQuote(quote) + '\n' + q.serializeQuote({ text: 'second' }) + '\nWhat do you mean?'
  const first = q.quoteRule.match(prompt, 0)
  assert.equal(first.start, 0)
  assert.deepEqual(plain(first.data), quote)
  const second = q.quoteRule.match(prompt, first.end)
  assert.equal(second.start, first.end)
  assert.deepEqual(plain(second.data), { text: 'second', note: '' })
  assert.equal(prompt.slice(second.end), 'What do you mean?')
  assert.equal(q.quoteRule.match(prompt, second.end), undefined)
})

test('the rule ignores plain text that merely mentions quotes', () => {
  assert.equal(q.quoteRule.match('use a <quote> tag inline', 0), undefined)
  assert.equal(q.quoteRule.match('Annotation 1: Ask: something', 0), undefined)
})

function chip(text, offset) {
  const insert = q.makeInsert({ text })
  return { source: 'quote', ref: insert.ref, offset, length: insert.clipboardText.length, label: insert.label, clipboardText: insert.clipboardText }
}

function assertConsistent(snapshot) {
  let end = 0
  for (const r of snapshot.references) {
    assert.ok(r.offset >= end, 'references are ordered and non-overlapping')
    assert.equal(snapshot.text.slice(r.offset, r.offset + r.length), r.clipboardText)
    end = r.offset + r.length
  }
}

test('stacking into an empty draft', () => {
  const next = q.stackQuote({ text: '', references: [] }, q.makeInsert({ text: 'alpha' }))
  assert.equal(next.text, '> alpha\n')
  assert.equal(next.references.length, 1)
  assertConsistent(next)
})

test('stacking keeps quotes in order above the question and shifts other chips', () => {
  const file = { source: 'reference', ref: '@src/a.ts', offset: 8, length: 9, label: 'a.ts', appearance: 'file', clipboardText: '@src/a.ts' }
  let draft = { text: 'explain @src/a.ts please', references: [file] }
  draft = q.stackQuote(draft, q.makeInsert({ text: 'first' }))
  draft = q.stackQuote(draft, q.makeInsert({ text: 'second' }))
  assert.equal(draft.text, '> first\n> second\nexplain @src/a.ts please')
  assert.deepEqual(plain(draft.references.map((r) => r.source)), ['quote', 'quote', 'reference'])
  assertConsistent(draft)
})

test('stacking does not swallow a user line that starts with a chip-like text', () => {
  const draft = { text: '> not a chip\nquestion', references: [] }
  const next = q.stackQuote(draft, q.makeInsert({ text: 'real' }))
  assert.equal(next.text, '> real\n> not a chip\nquestion')
  assertConsistent(next)
})

test('stacking after an existing quote chip with no trailing newline', () => {
  const existing = chip('one', 0)
  const draft = { text: existing.clipboardText, references: [existing] }
  const next = q.stackQuote(draft, q.makeInsert({ text: 'two' }))
  assert.equal(next.text, '> one\n> two\n')
  assertConsistent(next)
})

test('labels and clipboard text stay on one line and are bounded', () => {
  const insert = q.makeInsert({ text: 'a\n'.repeat(500), note: 'n\n'.repeat(100) })
  assert.ok(!insert.label.includes('\n'))
  assert.ok(!insert.clipboardText.includes('\n'))
  assert.ok(Array.from(insert.label).length < 90)
})

test('chip text never carries editor placeholder characters', () => {
  const insert = q.makeInsert({ text: 'a\uFFFCb\uE100c' })
  assert.equal(insert.clipboardText, '> abc')
  assert.ok(!/[\uE100-\uE11D\uFFFC]/u.test(insert.label))
})

test('selection cleanup', () => {
  assert.equal(q.cleanSelection('  a \r\n\r\n\r\n\r\nb  '), 'a\n\nb')
  assert.equal(q.cleanSelection('   '), '')
})

test('replaceQuote swaps one chip and shifts everything after it', () => {
  const file = { source: 'reference', ref: '@a.ts', offset: 0, length: 0, label: 'a.ts', clipboardText: '@a.ts' }
  let draft = { text: 'see @a.ts', references: [{ ...file, offset: 4, length: 5 }] }
  draft = q.stackQuote(draft, q.makeInsert({ text: 'short' }))
  draft = q.stackQuote(draft, q.makeInsert({ text: 'other' }))
  const next = q.replaceQuote(draft, 0, q.makeInsert({ text: 'short', note: 'a much longer note' }))
  assertConsistent(next)
  assert.equal(JSON.parse(next.references[0].ref).note, 'a much longer note')
  assert.equal(next.references[1].ref, draft.references[1].ref)
  assert.equal(next.text.endsWith('see @a.ts'), true)
})

test('removeQuote drops the chip and the newline it brought', () => {
  let draft = { text: 'question', references: [] }
  draft = q.stackQuote(draft, q.makeInsert({ text: 'one' }))
  draft = q.stackQuote(draft, q.makeInsert({ text: 'two' }))
  const next = q.removeQuote(draft, 0)
  assert.equal(next.text, '> two\nquestion')
  assert.equal(next.references.length, 1)
  assertConsistent(next)
  assert.equal(q.removeQuote(next, 0).text, 'question')
})

test('quoteChipIndex finds the nth chip sharing a ref', () => {
  const insert = q.makeInsert({ text: 'dup' })
  let draft = { text: '', references: [] }
  draft = q.stackQuote(draft, q.makeInsert({ text: 'x' }))
  draft = q.stackQuote(draft, insert)
  draft = q.stackQuote(draft, insert)
  assert.equal(q.quoteChipIndex(draft, insert.ref, 0), 1)
  assert.equal(q.quoteChipIndex(draft, insert.ref, 1), 2)
  assert.equal(q.quoteChipIndex(draft, insert.ref, 2), -1)
})
