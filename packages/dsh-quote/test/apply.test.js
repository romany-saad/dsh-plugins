import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// Minimal DOM: enough for the toolbar to mount, listen, and be clicked.
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.attrs = {}
    this.listeners = {}
    this.style = {}
    this.hidden = false
    this.textContent = ''
    this.offsetWidth = 200
    this.offsetHeight = 32
    this.value = ''
    this.isConnected = true
  }
  setSelectionRange() {}
  getBoundingClientRect() { return { left: 10, top: 700, width: 80, height: 20, bottom: 720 } }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  removeAttribute(k) { delete this.attrs[k] }
  hasAttribute(k) { return k in this.attrs }
  replaceChildren(...kids) { this.children = [...kids] }
  querySelector() { return null }
  append(...kids) { this.children.push(...kids) }
  appendChild(kid) { this.children.push(kid); return kid }
  remove() { this.removed = true; this.isConnected = false }
  contains(other) { return other === this }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) }
  fire(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...event }) }
  focus() {}
  closest() { return null }
}

function harness({ phase = 'plain', snapshot = { text: 'why?', references: [] }, occurrences = [] } = {}) {
  const docListeners = {}
  const document = {
    head: new FakeElement('head'),
    body: new FakeElement('body'),
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn) },
    removeEventListener: (type, fn) => { docListeners[type] = (docListeners[type] ?? []).filter((f) => f !== fn) },
  }
  // A selection inside the chat region of session "s1".
  const chat = new FakeElement('div')
  chat.setAttribute('data-conversation-session', 's1')
  const textHost = new FakeElement('p')
  textHost.closest = (selector) => (selector.includes('data-conversation-region') ? chat : null)
  let selection = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => '  the retry loop  ',
    getRangeAt: () => ({ commonAncestorContainer: textHost, getBoundingClientRect: () => ({ left: 10, top: 100, width: 50, height: 16, bottom: 116 }) }),
    removeAllRanges() { selection = null },
  }
  const window = {
    innerWidth: 1200,
    innerHeight: 800,
    getSelection: () => selection,
    addEventListener() {},
    removeEventListener() {},
  }

  const calls = { setDraft: [], notify: [], sources: [], rules: [], slots: [] }
  const input = {
    state: { getSnapshot: () => ({ phase, occurrences }) },
    draftSnapshot: snapshot,
    setDraft: (draft) => calls.setDraft.push(draft),
    notify: (level, text) => calls.notify.push({ level, text }),
    focus() {},
    actions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }) },
  }
  const disposers = []
  const ctx = {
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
    locale: { register: () => () => {}, bind: () => (key) => key },
    inputTriggers: { registerSource: (src) => { calls.sources.push(src); return () => {} } },
    uiConversation: { userText: { register: (rule) => { calls.rules.push(rule); return () => {} } } },
    slots: {
      inject: (_name, make) => make(),
      register: (desc, component) => { calls.slots.push({ desc, component }); return () => {} },
    },
    sessions: { scope: (id) => (id === 's1' ? { id } : undefined) },
    conversation: { input: { for: () => input } },
  }

  return { ctx, calls, document, docListeners, disposers, window }
}

function runApply(h) {
  // Re-evaluate with the real window available as a global for apply().
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let entry
  const context = {
    window: { ...h.window, __ModuleLoader__: { load: (e) => { entry = e } } },
    document: h.document,
    setTimeout,
    clearTimeout,
    Element: FakeElement,
  }
  vm.runInNewContext(source, context)
  const mod = entry.factory((id) => {
    if (id === 'react') return { useState: (v) => [v, () => {}] }
    if (id === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    throw new Error('unexpected require ' + id)
  })
  mod.apply(h.ctx)
  return mod
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('apply registers the chip source, user-text rule and node slot', () => {
  const h = harness()
  runApply(h)
  assert.equal(h.calls.sources.length, 1)
  const src = h.calls.sources[0]
  assert.equal(src.trigger, '@')
  assert.equal(src.name, 'quote')
  assert.equal(typeof src.codec.serialize, 'function')
  assert.equal(h.calls.rules[0].id, 'quote')
  assert.equal(h.calls.slots[0].desc.name, 'conversation.user.text.node')
  assert.equal(h.calls.slots[0].desc.key, 'quote')
})

test('codec serializes a chip ref into the <quote> block the rule parses', async () => {
  const h = harness()
  runApply(h)
  const src = h.calls.sources[0]
  const ref = JSON.stringify({ v: 1, text: 'abc', note: 'n' })
  const out = await src.codec.serialize(ref, new AbortController().signal)
  assert.equal(out, '<quote>\nabc\n<note>n</note>\n</quote>')
  assert.equal(h.calls.rules[0].match(out + '\nQ', 0).data.text, 'abc')
  await assert.rejects(Promise.resolve().then(() => src.codec.serialize('{}')))
})

const findBar = (h) => h.document.body.children.find((el) => el.className === 'dshq-bar')
const openPop = (h) => h.document.body.children.filter((el) => el.className === 'dshq-pop' && !el.removed).at(-1)
const buttonsOf = (pop) => pop.children.find((el) => el.className === 'dshq-actions').children
const textareaOf = (pop) => pop.children.find((el) => el.tagName === 'TEXTAREA')

async function quoteSelection(h, note) {
  for (const fn of h.docListeners.selectionchange) fn()
  await tick(150)
  const bar = findBar(h)
  assert.equal(bar.hidden, false, 'toolbar shows for a chat selection')
  assert.equal(bar.children.length, 1, 'one Quote button')
  bar.children[0].fire('click')
  const pop = openPop(h)
  assert.ok(pop, 'Quote opens the note box')
  assert.equal(pop.getAttribute('data-mode'), 'add')
  textareaOf(pop).value = note
  textareaOf(pop).fire('keydown', { key: 'Enter', shiftKey: false })
  assert.ok(pop.removed, 'Enter closes the box')
}

test('Quote opens the note box; Enter with an empty note adds a plain quote', async () => {
  const h = harness()
  runApply(h)
  await quoteSelection(h, '   ')
  assert.equal(h.calls.setDraft.length, 1)
  const draft = h.calls.setDraft[0]
  assert.equal(draft.text, '> the retry loop\nwhy?')
  assert.equal(draft.references[0].source, 'quote')
  assert.deepEqual(JSON.parse(draft.references[0].ref), { v: 1, text: 'the retry loop' })
  assert.equal(h.calls.notify.length, 0)
})

test('a note typed in the box rides in the chip ref', async () => {
  const h = harness()
  runApply(h)
  await quoteSelection(h, '  is there a cap?  ')
  assert.deepEqual(JSON.parse(h.calls.setDraft[0].references[0].ref), { v: 1, text: 'the retry loop', note: 'is there a cap?' })
})

test('clicking a quote chip opens the editor; Save rewrites only that chip', async () => {
  const two = { v: 1, text: 'same passage', note: 'first' }
  const ref = JSON.stringify(two)
  const clip = '> same passage'
  const snapshot = {
    text: clip + '\n' + clip + '\nq',
    references: [
      { source: 'quote', ref, offset: 0, length: clip.length, label: 'a', clipboardText: clip },
      { source: 'quote', ref, offset: clip.length + 1, length: clip.length, label: 'b', clipboardText: clip },
    ],
  }
  const h = harness({ snapshot })
  runApply(h)
  // Press the SECOND chip: the plugin records its position, then DSH calls openReference.
  const card = new FakeElement('div')
  const chips = [new FakeElement('span'), new FakeElement('span')]
  for (const c of chips) c.closest = (sel) => (sel.includes('data-composer-chip') ? c : sel.includes('data-composer-card') ? card : null)
  card.querySelectorAll = () => chips
  for (const fn of h.docListeners.pointerdown) fn({ target: chips[1] })
  assert.equal(h.calls.sources[0].openReference({ sessionId: 's1' }, { ref }), true)
  const pop = openPop(h)
  assert.equal(pop.getAttribute('data-mode'), 'edit')
  assert.equal(textareaOf(pop).value, 'first')
  textareaOf(pop).value = 'second note'
  const [, , save] = buttonsOf(pop)
  save.fire('click')
  const draft = h.calls.setDraft[0]
  assert.equal(JSON.parse(draft.references[0].ref).note, 'first', 'first chip untouched')
  assert.equal(JSON.parse(draft.references[1].ref).note, 'second note', 'clicked chip updated')
})

test('Remove in the editor deletes the chip and its line', async () => {
  const ref = JSON.stringify({ v: 1, text: 'gone' })
  const clip = '> gone'
  const h = harness({ snapshot: { text: clip + '\nask', references: [{ source: 'quote', ref, offset: 0, length: clip.length, label: 'x', clipboardText: clip }] } })
  runApply(h)
  h.calls.sources[0].openReference({ sessionId: 's1' }, { ref })
  const [remove] = buttonsOf(openPop(h))
  remove.fire('click')
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.setDraft[0])), { text: 'ask', references: [] })
})

test('Save with an unchanged note leaves the draft alone', async () => {
  const ref = JSON.stringify({ v: 1, text: 'p', note: 'n' })
  const h = harness({ snapshot: { text: '> p\n', references: [{ source: 'quote', ref, offset: 0, length: 3, label: 'x', clipboardText: '> p' }] } })
  runApply(h)
  h.calls.sources[0].openReference({ sessionId: 's1' }, { ref })
  textareaOf(openPop(h)).fire('keydown', { key: 'Enter', shiftKey: false })
  assert.equal(h.calls.setDraft.length, 0)
})

test('a busy or command composer refuses with a notice and leaves the draft alone', async () => {
  for (const phase of ['submitting', 'claimed']) {
    const h = harness({ phase })
    runApply(h)
    for (const fn of h.docListeners.selectionchange) fn()
    await tick(150)
    findBar(h).children[0].fire('click')
    textareaOf(openPop(h)).fire('keydown', { key: 'Enter', shiftKey: false })
    assert.equal(h.calls.setDraft.length, 0)
    assert.equal(h.calls.notify.length, 1)
    assert.equal(h.calls.notify[0].level, 'error')
  }
})

test('hovering a composer quote chip shows the full quote and note, then restores the host title', async () => {
  const long = 'x'.repeat(300) + ' end of the long passage'
  const occurrences = [
    { source: 'reference', ref: '@a.ts', offset: 0 },
    { source: 'quote', ref: JSON.stringify({ v: 1, text: 'short one' }), offset: 10 },
    { source: 'quote', ref: JSON.stringify({ v: 1, text: long, note: 'a full\nmulti-line note' }), offset: 30 },
  ]
  const h = harness({ occurrences })
  runApply(h)
  // DOM shape: chat host (session) > composer card > two quote chips, each with a titled inner span.
  const host = new FakeElement('div')
  host.setAttribute('data-conversation-session', 's1')
  const card = new FakeElement('div')
  const chips = [new FakeElement('span'), new FakeElement('span')]
  const inner = chips.map(() => { const el = new FakeElement('span'); el.setAttribute('title', 'shortened'); return el })
  chips.forEach((c, i) => {
    c.querySelector = (sel) => (sel === '[title]' && inner[i].hasAttribute('title') ? inner[i] : null)
    c.closest = (sel) => sel.includes('data-composer-chip') ? c : sel.includes('data-composer-card') ? card : sel.includes('data-conversation-session') ? host : null
  })
  card.querySelectorAll = () => chips
  const tip = h.document.body.children.find((el) => el.className === 'dshq-tip')
  assert.ok(tip && tip.hidden, 'tooltip mounted hidden')

  for (const fn of h.docListeners.pointerover) fn({ target: chips[1] })
  assert.equal(inner[1].hasAttribute('title'), false, 'host title muted at once')
  await tick(300)
  assert.equal(tip.hidden, false)
  const [quote, note, hint] = tip.children
  assert.equal(quote.textContent, long, 'full passage, not the label')
  assert.equal(note.textContent, 'a full\nmulti-line note')
  assert.equal(hint.textContent, 'editHint')

  // Move off the chip: tooltip hides after a short grace and the title comes back.
  const elsewhere = new FakeElement('div')
  for (const fn of h.docListeners.pointerover) fn({ target: elsewhere })
  await tick(200)
  assert.equal(tip.hidden, true)
  assert.equal(inner[1].getAttribute('title'), 'shortened')
})

test('dispose removes the toolbar, style and document listeners', () => {
  const h = harness()
  runApply(h)
  for (const d of h.disposers) d()
  assert.equal((h.docListeners.selectionchange ?? []).length, 0)
  assert.ok(h.document.body.children.every((el) => el.removed === true))
  assert.ok(h.document.head.children.every((el) => el.removed === true))
})
