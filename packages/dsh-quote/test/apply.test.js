// dsh-quote on a jsdom page with real React and the real @rs-dsh/dsh-core:
// the Quote button in the shared toolbar, the note box (DSH's InlineEditor),
// the chip editor, the hover card and cleanup.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPage, fakePrimitives, selectText, settle, typeInto, press, click, toolbarButtons, popover } from '../../dsh-core/test/dom.mjs'

const CORE = new URL('../../dsh-core/client.js', import.meta.url)
const QUOTE = new URL('../client.js', import.meta.url)
const CHAT = '<div data-conversation-region="chat" data-conversation-session="s1"><div data-chat-node-key="14:assistant-step1:1"><p id="p">  the retry loop backs off</p></div></div>'

function harness({ phase = 'plain', snapshot = { text: 'why?', references: [] }, occurrences = [] } = {}) {
  const probe = createPage({ bundles: [CORE] })
  const names = probe.modules[0].exports._internals.UI_EXPORTS
  probe.close()
  const page = createPage({ bundles: [CORE, QUOTE], primitives: fakePrimitives(names) })
  page.document.body.innerHTML = CHAT
  page.window.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  const calls = { setDraft: [], notify: [], sources: [], rules: [], slots: [] }
  const input = {
    state: { getSnapshot: () => ({ phase, occurrences }) },
    draftSnapshot: snapshot,
    setDraft: (draft) => { calls.setDraft.push(draft); input.draftSnapshot = draft },
    notify: (level, text) => calls.notify.push({ level, text }),
    focus() {},
    actions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }) },
  }
  page.start({
    inputTriggers: { registerSource: (src) => { calls.sources.push(src); return () => {} } },
    uiConversation: { userText: { register: (rule) => { calls.rules.push(rule); return () => {} } } },
    slots: { inject: (_name, make) => make(), register: (desc, component) => { calls.slots.push({ desc, component }); return () => {} } },
    sessions: { scope: (id) => (id === 's1' ? { id } : undefined) },
    conversation: { input: { for: () => input } },
  })
  return { page, calls, input }
}

async function selectAndPress(h, label) {
  const node = h.page.document.getElementById('p').firstChild
  selectText(h.page, node, 2, 16)
  await settle(h.page, 160)
  const button = toolbarButtons(h.page).find((b) => b.textContent === label)
  assert.ok(button, label + ' is in the shared toolbar')
  click(h.page, button)
  return popover(h.page)
}

async function quoteSelection(h, note) {
  const pop = await selectAndPress(h, 'quote')
  assert.ok(pop, 'Quote opens the note box')
  assert.equal(pop.getAttribute('data-plugin'), 'dsh-quote')
  assert.equal(pop.querySelector('[data-mode]').getAttribute('data-mode'), 'add')
  const area = pop.querySelector('textarea')
  typeInto(h.page, area, note)
  press(h.page, area, 'Enter')
  assert.equal(popover(h.page), null, 'Enter closes the box')
}

test('apply registers the chip source, user-text rule, node slot and the Quote button', async () => {
  const h = harness()
  assert.equal(h.calls.sources[0].name, 'quote')
  assert.equal(h.calls.rules[0].id, 'quote')
  assert.equal(h.calls.slots[0].desc.key, 'quote')
  selectText(h.page, h.page.document.getElementById('p').firstChild, 2, 16)
  await settle(h.page, 160)
  assert.deepEqual(toolbarButtons(h.page).map((b) => b.getAttribute('data-plugin')), ['dsh-quote'])
  h.page.dispose(); h.page.close()
})

test('codec serializes a chip ref into the <quote> block the rule parses', async () => {
  const h = harness()
  const src = h.calls.sources[0]
  const out = await src.codec.serialize(JSON.stringify({ v: 1, text: 'abc', note: 'n' }))
  assert.equal(out, '<quote>\nabc\n<note>n</note>\n</quote>')
  assert.equal(h.calls.rules[0].match(out + '\nQ', 0).data.text, 'abc')
  await assert.rejects(Promise.resolve().then(() => src.codec.serialize('{}')))
  h.page.dispose(); h.page.close()
})

test('Quote opens the note box; Enter with an empty note adds a plain quote', async () => {
  const h = harness()
  await quoteSelection(h, '   ')
  assert.equal(h.calls.setDraft.length, 1)
  const draft = h.calls.setDraft[0]
  assert.equal(draft.text, '> the retry loop\nwhy?')
  assert.deepEqual(JSON.parse(draft.references[0].ref), { v: 1, text: 'the retry loop' })
  assert.equal(h.calls.notify.length, 0)
  h.page.dispose(); h.page.close()
})

test('a note typed in the box rides in the chip ref', async () => {
  const h = harness()
  await quoteSelection(h, '  is there a cap?  ')
  assert.deepEqual(JSON.parse(h.calls.setDraft[0].references[0].ref), { v: 1, text: 'the retry loop', note: 'is there a cap?' })
  h.page.dispose(); h.page.close()
})

test('Esc and Cancel close the box without a quote', async () => {
  const h = harness()
  let pop = await selectAndPress(h, 'quote')
  press(h.page, pop.querySelector('textarea'), 'Escape')
  assert.equal(popover(h.page), null)
  pop = await selectAndPress(h, 'quote')
  click(h.page, [...pop.querySelectorAll('button')].find((b) => b.textContent === 'cancel'))
  assert.equal(popover(h.page), null)
  assert.equal(h.calls.setDraft.length, 0)
  h.page.dispose(); h.page.close()
})

test('clicking a quote chip opens the editor; Save rewrites only that chip', async () => {
  const ref = JSON.stringify({ v: 1, text: 'same passage', note: 'first' })
  const clip = '> same passage'
  const snapshot = {
    text: clip + '\n' + clip + '\nq',
    references: [
      { source: 'quote', ref, offset: 0, length: clip.length, label: 'a', clipboardText: clip },
      { source: 'quote', ref, offset: clip.length + 1, length: clip.length, label: 'b', clipboardText: clip },
    ],
  }
  const h = harness({ snapshot })
  // Two chips in a composer card; press the SECOND, then DSH calls openReference.
  const card = h.page.document.createElement('div')
  card.setAttribute('data-composer-card', '')
  card.innerHTML = '<span data-composer-chip="quote">a</span><span data-composer-chip="quote">b</span>'
  h.page.document.body.append(card)
  const chips = card.querySelectorAll('[data-composer-chip="quote"]')
  h.page.act(() => { chips[1].dispatchEvent(new h.page.window.MouseEvent('pointerdown', { bubbles: true })) })
  h.page.act(() => { assert.equal(h.calls.sources[0].openReference({ sessionId: 's1' }, { ref }), true) })
  const pop = popover(h.page)
  assert.equal(pop.querySelector('[data-mode]').getAttribute('data-mode'), 'edit')
  const area = pop.querySelector('textarea')
  assert.equal(area.value, 'first')
  typeInto(h.page, area, 'second note')
  click(h.page, [...pop.querySelectorAll('button')].find((b) => b.textContent === 'save'))
  const draft = h.calls.setDraft[0]
  assert.equal(JSON.parse(draft.references[0].ref).note, 'first', 'first chip untouched')
  assert.equal(JSON.parse(draft.references[1].ref).note, 'second note', 'clicked chip updated')
  h.page.dispose(); h.page.close()
})

test('Remove in the editor deletes the chip and its line', async () => {
  const ref = JSON.stringify({ v: 1, text: 'gone' })
  const clip = '> gone'
  const h = harness({ snapshot: { text: clip + '\nask', references: [{ source: 'quote', ref, offset: 0, length: clip.length, label: 'x', clipboardText: clip }] } })
  h.page.act(() => { h.calls.sources[0].openReference({ sessionId: 's1' }, { ref }) })
  click(h.page, [...popover(h.page).querySelectorAll('button')].find((b) => b.textContent === 'remove'))
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.setDraft[0])), { text: 'ask', references: [] })
  h.page.dispose(); h.page.close()
})

test('Save with an unchanged note leaves the draft alone', async () => {
  const ref = JSON.stringify({ v: 1, text: 'p', note: 'n' })
  const h = harness({ snapshot: { text: '> p\n', references: [{ source: 'quote', ref, offset: 0, length: 3, label: 'x', clipboardText: '> p' }] } })
  h.page.act(() => { h.calls.sources[0].openReference({ sessionId: 's1' }, { ref }) })
  press(h.page, popover(h.page).querySelector('textarea'), 'Enter')
  assert.equal(h.calls.setDraft.length, 0)
  h.page.dispose(); h.page.close()
})

test('a busy or command composer refuses with a notice and leaves the draft alone', async () => {
  for (const phase of ['submitting', 'claimed']) {
    const h = harness({ phase })
    await quoteSelection(h, '')
    assert.equal(h.calls.setDraft.length, 0)
    assert.equal(h.calls.notify.length, 1)
    assert.equal(h.calls.notify[0].level, 'error')
    h.page.dispose(); h.page.close()
  }
})

test('a quote chip stacks after a thread chip already at the top', async () => {
  const clip = '> a thread'
  const h = harness({ snapshot: { text: clip + '\nq', references: [{ source: 'comment', ref: 'r', offset: 0, length: clip.length, label: 't', clipboardText: clip }] } })
  h.page.services.get('rsDshCore').composer.claimChipSource('comment')
  await quoteSelection(h, '')
  assert.equal(h.calls.setDraft[0].text, '> a thread\n> the retry loop\nq')
  h.page.dispose(); h.page.close()
})

test('hovering a composer quote chip shows the full quote and note, then restores the host title', async () => {
  const long = 'x'.repeat(300) + ' end of the long passage'
  const occurrences = [
    { source: 'reference', ref: '@a.ts', offset: 0 },
    { source: 'quote', ref: JSON.stringify({ v: 1, text: 'short one' }), offset: 10 },
    { source: 'quote', ref: JSON.stringify({ v: 1, text: long, note: 'a full\nmulti-line note' }), offset: 30 },
  ]
  const h = harness({ occurrences })
  const host = h.page.document.querySelector('[data-conversation-session]')
  host.insertAdjacentHTML('beforeend', '<div data-composer-card><span data-composer-chip="quote"><i title="shortened">a</i></span><span data-composer-chip="quote"><i title="shortened">b</i></span></div>')
  const chips = host.querySelectorAll('[data-composer-chip="quote"]')
  const tip = h.page.document.querySelector('[data-rs-dsh="dsh-quote"][role="tooltip"]')
  assert.ok(tip && tip.hidden, 'card mounted hidden')
  h.page.act(() => { chips[1].dispatchEvent(new h.page.window.MouseEvent('pointerover', { bubbles: true })) })
  assert.equal(chips[1].querySelector('i').hasAttribute('title'), false, 'host title muted at once')
  await settle(h.page, 320)
  assert.equal(tip.hidden, false)
  assert.equal(tip.querySelector('blockquote').textContent, long, 'full passage, not the label')
  assert.equal(tip.querySelector('.q-tip-note').textContent, 'a full\nmulti-line note')
  h.page.act(() => { h.page.document.body.dispatchEvent(new h.page.window.MouseEvent('pointerover', { bubbles: true })) })
  await settle(h.page, 220)
  assert.equal(tip.hidden, true)
  assert.equal(chips[1].querySelector('i').getAttribute('title'), 'shortened')
  h.page.dispose(); h.page.close()
})

test('dispose removes the Quote button, hover card and stylesheet', async () => {
  const h = harness()
  h.page.dispose()
  assert.equal(h.page.document.querySelector('[data-rs-dsh]'), null)
  assert.equal(h.page.document.querySelector('style[data-rs-dsh-style]'), null)
  h.page.close()
})
