// dsh-threads on a jsdom page with real React and the real @rs-dsh/dsh-core:
// the Comment button in the shared toolbar, the comment box, the thread card
// drawn with DSH's components, highlights, Send to chat and cleanup. The host
// routes are a fake fetch; the browser half is under test.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPage, fakePrimitives, selectText, settle, typeInto, press, click, toolbarButtons, popover } from '../../dsh-core/test/dom.mjs'

const CORE = new URL('../../dsh-core/client.js', import.meta.url)
const THREADS = new URL('../client.js', import.meta.url)
const CHAT = `<div data-conversation-region="chat" data-conversation-session="s1">
  <div data-chat-node-key="13:input-messageu1" data-chat-flow-kind="user"><p id="u">Why ten minutes?</p></div>
  <div data-chat-node-key="14:assistant-step1:1" data-chat-flow-kind="assistant-step">
    <div data-tool="bash"><p id="tool">ls -la</p></div>
    <p id="a">The cache keeps entries for ten minutes. Stale entries refresh.</p>
  </div>
</div>`

/** A server holding threads in memory, answering like lib/route.js. */
function fakeServer({ canWrite = true } = {}) {
  const threads = []
  const requests = []
  const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(value)) })
  const fetch = async (url, init = {}) => {
    const path = String(url).replace('api/dsh-threads/', '')
    const body = init.body ? JSON.parse(init.body) : undefined
    requests.push({ path, body })
    if (path.startsWith('threads')) return json({ threads, canWrite })
    if (path === 'create') {
      const thread = { id: 't' + (threads.length + 1), createdAt: 1, anchor: body.anchor, messages: [{ id: 'm1', role: 'user', text: body.text.trim(), time: 1 }], replying: true }
      threads.push(thread)
      return json(thread)
    }
    if (path === 'comment') {
      const thread = threads.find((x) => x.id === body.threadId)
      thread.messages.push({ id: 'm' + (thread.messages.length + 1), role: 'user', text: body.text, time: 2 })
      thread.replying = true
      return json(thread)
    }
    if (path === 'delete') {
      threads.splice(threads.findIndex((x) => x.id === body.threadId), 1)
      return json({ deleted: body.threadId })
    }
    return json({ error: 'no', message: 'unknown ' + path }, 404)
  }
  const reply = (id, text) => {
    const thread = threads.find((x) => x.id === id)
    thread.messages.push({ id: 'ai' + thread.messages.length, role: 'ai', text, time: 3, model: 'm' })
    thread.replying = false
  }
  return { fetch, threads, requests, reply }
}

/** jsdom has no CSS Custom Highlight API; a minimal one records the ranges. */
function installHighlights(window) {
  const map = new Map()
  window.Highlight = class { constructor(...ranges) { this.ranges = ranges; this.size = ranges.length } }
  window.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&'), highlights: { set: (k, v) => map.set(k, v), get: (k) => map.get(k), delete: (k) => map.delete(k) } }
  return map
}

async function harness(options) {
  const probe = createPage({ bundles: [CORE] })
  const names = probe.modules[0].exports._internals.UI_EXPORTS
  probe.close()
  const page = createPage({ bundles: [CORE, THREADS], primitives: fakePrimitives(names) })
  page.document.body.innerHTML = CHAT
  page.window.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  page.window.cancelAnimationFrame = (id) => clearTimeout(id)
  const server = fakeServer(options)
  page.window.fetch = server.fetch
  globalThis.fetch = server.fetch
  const highlights = installHighlights(page.window)
  globalThis.Highlight = page.window.Highlight
  const calls = { setDraft: [], sources: [] }
  const input = {
    state: { getSnapshot: () => ({ phase: 'plain' }) },
    draftSnapshot: { text: 'q', references: [] },
    setDraft: (d) => { calls.setDraft.push(d); input.draftSnapshot = d },
    notify() {},
    focus() {},
  }
  page.start({
    inputTriggers: { registerSource: (src) => { calls.sources.push(src); return () => {} } },
    uiConversation: { userText: { register: () => () => {} } },
    slots: { inject: (_n, make) => make(), register: () => () => {} },
    sessions: { scope: (id) => (id === 's1' ? { id } : undefined) },
    conversation: { input: { for: () => input } },
  })
  await settle(page, 30)
  return { page, server, highlights, calls }
}

const close = (h) => { h.page.dispose(); h.page.close() }

async function selectIn(h, id, from, to) {
  selectText(h.page, h.page.document.getElementById(id).firstChild, from, to)
  await settle(h.page, 160)
}

test('Comment is in the shared toolbar for replies and your messages, not for tool output', async () => {
  const h = await harness()
  await selectIn(h, 'a', 4, 9)
  assert.deepEqual(toolbarButtons(h.page).map((b) => b.getAttribute('data-plugin') + '/' + b.getAttribute('data-action')), ['dsh-threads/comment'])
  assert.ok(toolbarButtons(h.page)[0].querySelector('[data-icon="IconNewChatOutlineRegular"]'), 'DSH bubble icon on the button')
  await selectIn(h, 'u', 0, 3)
  assert.equal(toolbarButtons(h.page).length, 1)
  await selectIn(h, 'tool', 0, 2)
  assert.equal(toolbarButtons(h.page).length, 0, 'no Comment on tool output')
  close(h)
})

test('posting a comment creates the thread, highlights the passage and opens the thread card', async () => {
  const h = await harness()
  await selectIn(h, 'a', 41, 63)
  click(h.page, toolbarButtons(h.page)[0])
  let pop = popover(h.page)
  assert.equal(pop.querySelector('[data-mode]').getAttribute('data-mode'), 'new')
  assert.equal(pop.querySelector('blockquote').textContent, 'Stale entries refresh.')
  typeInto(h.page, pop.querySelector('textarea'), 'What if it fails?')
  press(h.page, pop.querySelector('textarea'), 'Enter')
  await settle(h.page, 30)
  const create = h.server.requests.find((r) => r.path === 'create')
  assert.equal(create.body.sessionId, 's1')
  assert.deepEqual(JSON.parse(JSON.stringify(create.body.anchor)), { kind: 'assistant', turn: 1, step: 1, text: 'Stale entries refresh.', prefix: 'Thecachekeepsentriesfortenminutes.', suffix: '' })
  pop = popover(h.page)
  assert.equal(pop.querySelector('[data-mode]').getAttribute('data-mode'), 'thread')
  assert.match(pop.textContent, /What if it fails\?/)
  assert.ok(pop.querySelector('[data-shimmer]'), 'Thinking… shimmers while the reply is on its way')
  const open = h.highlights.get('dsh-threads-open')
  assert.equal(open.size, 1)
  assert.equal(open.ranges[0].toString(), 'Stale entries refresh.')
  close(h)
})

test('the reply arrives by polling and renders as Markdown; a follow-up is sent', async () => {
  const h = await harness()
  await selectIn(h, 'a', 4, 9)
  click(h.page, toolbarButtons(h.page)[0])
  typeInto(h.page, popover(h.page).querySelector('textarea'), 'Why?')
  press(h.page, popover(h.page).querySelector('textarea'), 'Enter')
  await settle(h.page, 30)
  h.server.reply('t1', 'Because **ten** is enough.')
  await settle(h.page, 1700)
  const pop = popover(h.page)
  assert.equal(pop.querySelector('[data-shimmer]'), null)
  assert.equal(pop.querySelector('[data-role="ai"] [data-markdown]').textContent, 'Because **ten** is enough.')
  typeInto(h.page, pop.querySelector('textarea'), 'And an hour?')
  click(h.page, [...pop.querySelectorAll('button')].find((b) => b.textContent === 'send'))
  await settle(h.page, 30)
  assert.equal(h.server.requests.filter((r) => r.path === 'comment').length, 1)
  assert.match(popover(h.page).textContent, /And an hour\?/)
  close(h)
})

test('Send to chat puts the thread chip in the composer and closes the card', async () => {
  const h = await harness()
  await selectIn(h, 'a', 4, 9)
  click(h.page, toolbarButtons(h.page)[0])
  typeInto(h.page, popover(h.page).querySelector('textarea'), 'Note')
  press(h.page, popover(h.page).querySelector('textarea'), 'Enter')
  await settle(h.page, 30)
  click(h.page, [...popover(h.page).querySelectorAll('button')].find((b) => b.textContent === 'toChat'))
  assert.equal(popover(h.page), null)
  assert.equal(h.calls.setDraft.length, 1)
  assert.equal(h.calls.setDraft[0].references[0].source, 'comment')
  assert.equal(h.calls.setDraft[0].text, '> cache\nq')
  close(h)
})

test('a badge sits beside the highlight; clicking it reopens the thread', async () => {
  const h = await harness()
  await selectIn(h, 'a', 4, 9)
  click(h.page, toolbarButtons(h.page)[0])
  typeInto(h.page, popover(h.page).querySelector('textarea'), 'Hm')
  press(h.page, popover(h.page).querySelector('textarea'), 'Enter')
  await settle(h.page, 30)
  press(h.page, h.page.document.body, 'Escape')
  await settle(h.page, 10)
  assert.equal(popover(h.page), null)
  assert.equal(h.highlights.get('dsh-threads').size, 1, 'back to the plain highlight')
  // jsdom has no layout: give the range and the region boxes so the badge is placed.
  const region = h.page.document.querySelector('[data-conversation-region]')
  region.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 })
  h.page.window.Range.prototype.getClientRects = function () { return [{ left: 120, top: 300, right: 180, bottom: 320, width: 60, height: 20 }] }
  h.page.window.Range.prototype.getBoundingClientRect = function () { return { left: 120, top: 300, right: 180, bottom: 320, width: 60, height: 20 } }
  h.page.act(() => { h.page.window.dispatchEvent(new h.page.window.Event('resize')) })
  await settle(h.page, 30)
  const badge = h.page.document.querySelector('[data-rs-dsh="dsh-threads"] .th-badge')
  assert.ok(badge, 'badge placed')
  assert.equal(badge.textContent, '1')
  click(h.page, badge)
  assert.equal(popover(h.page).querySelector('[data-mode]').getAttribute('data-mode'), 'thread')
  close(h)
})

test('a session that is not running shows threads read-only', async () => {
  const h = await harness({ canWrite: false })
  h.server.threads.push({ id: 'old', createdAt: 1, anchor: { kind: 'user', messageId: 'u1', text: 'ten minutes', prefix: 'Why', suffix: '?' }, messages: [{ id: 'm', role: 'user', text: 'note', time: 1 }], replying: false })
  h.page.act(() => { h.page.window.dispatchEvent(new h.page.window.Event('focus')) })
  await settle(h.page, 30)
  assert.equal(h.highlights.get('dsh-threads').ranges[0].toString(), 'ten minutes')
  close(h)
})

test('dispose removes the Comment button, badges, highlights and stylesheet', async () => {
  const h = await harness()
  h.page.dispose()
  assert.equal(h.page.document.querySelector('[data-rs-dsh]'), null)
  assert.equal(h.page.document.querySelector('style[data-rs-dsh-style]'), null)
  assert.equal(h.highlights.size, 0)
  h.page.close()
})
