// The core on a jsdom page with real React: the one selection toolbar, the
// popover host, styles and cleanup.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPage, fakePrimitives, selectText, wait } from './dom.mjs'

const CORE = new URL('../client.js', import.meta.url)
const CHAT = '<div data-conversation-region="chat" data-conversation-session="s1"><div data-chat-node-key="14:assistant-step1:1"><p id="p">The cache keeps entries for ten minutes.</p></div></div>'

async function page() {
  const p = createPage({ bundles: [CORE], primitives: null })
  const { _internals } = p.modules[0].exports
  p.close()
  const real = createPage({ bundles: [CORE], primitives: fakePrimitives(_internals.UI_EXPORTS) })
  real.document.body.innerHTML = CHAT
  real.window.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  real.start({ sessions: { scope: () => undefined }, conversation: { input: { for: () => null } } })
  return real
}

const bar = (p) => p.document.querySelector('[data-rs-dsh="dsh-core"][data-part="toolbar"]')

test('the core provides rsDshCore with the DSH components it was given', async () => {
  const p = await page()
  const core = p.services.get('rsDshCore')
  assert.equal(core.version, 1)
  assert.equal(typeof core.ui.Button, 'object') // forwardRef
  assert.equal(typeof core.selection.register, 'function')
  assert.equal(p.document.querySelector('style[data-rs-dsh-style="dsh-core"]') !== null, true)
  p.dispose(); p.close()
})

test('without DSH\'s UI library the core fails at start with one clear message', () => {
  const p = createPage({ bundles: [CORE] })
  assert.throws(() => p.start({ sessions: {}, conversation: {} }), /dsh-client-ui-primitives is not available/)
  p.close()
})

test('one toolbar holds every plugin\'s buttons, in order, and passes the selection', async () => {
  const p = await page()
  const core = p.services.get('rsDshCore')
  const picked = []
  p.act(() => {
    core.selection.register({ plugin: 'dsh-threads', id: 'comment', label: 'Comment', order: 20, onSelect: (s) => picked.push(['comment', s.text, s.sessionId]) })
    core.selection.register({ plugin: 'dsh-quote', id: 'quote', label: 'Quote', order: 10, onSelect: (s) => picked.push(['quote', s.text]) })
    core.selection.register({ plugin: 'dsh-x', id: 'never', label: 'Hidden', when: () => false, onSelect: () => {} })
  })
  selectText(p, p.document.getElementById('p').firstChild, 4, 9)
  await wait(150)
  await p.act(async () => { await wait(5) })
  const el = bar(p)
  assert.equal(el.hidden, false, 'shows for a chat selection')
  const labels = [...el.querySelectorAll('button')].map((b) => b.textContent)
  assert.deepEqual(labels, ['Quote', 'Comment'], 'one container, ordered, the hidden one left out')
  assert.equal(el.querySelector('[data-menu-surface]') !== null, true, 'drawn on DSH\'s MenuSurface')
  assert.deepEqual([...el.querySelectorAll('button')].map((b) => b.getAttribute('data-variant')), ['ghost', 'ghost'])
  p.act(() => { el.querySelectorAll('button')[1].dispatchEvent(new p.window.MouseEvent('click', { bubbles: true })) })
  assert.deepEqual(picked, [['comment', 'cache', 's1']])
  assert.equal(el.hidden, true, 'a click hides the toolbar')
  p.dispose(); p.close()
})

test('no toolbar for selections outside a conversation or inside rs-dsh UI', async () => {
  const p = await page()
  const core = p.services.get('rsDshCore')
  p.act(() => { core.selection.register({ plugin: 'dsh-quote', id: 'quote', label: 'Quote', onSelect: () => {} }) })
  const outside = p.document.createElement('p')
  outside.textContent = 'not in a chat'
  p.document.body.append(outside)
  selectText(p, outside.firstChild, 0, 3)
  await wait(150)
  assert.equal(bar(p).hidden, true)
  const own = p.document.createElement('div')
  own.setAttribute('data-rs-dsh', 'dsh-threads')
  own.textContent = 'our own card'
  p.document.querySelector('[data-chat-node-key]').append(own)
  selectText(p, own.firstChild, 0, 3)
  await wait(150)
  assert.equal(bar(p).hidden, true)
  p.dispose(); p.close()
})

test('a popover opens next to its anchor and closes on outside click, Escape, or another one', async () => {
  const p = await page()
  const core = p.services.get('rsDshCore')
  const h = core.jsx
  const closed = []
  const anchor = { left: 100, top: 300, right: 300, bottom: 320, width: 200, height: 20 }
  const openOne = (name) => p.act(() => core.popover.open({ plugin: 'dsh-threads', anchor, label: name, onClose: (why) => closed.push([name, why]), render: (close) => h('div', { children: [name, h('button', { id: 'x-' + name, onClick: () => close('done') })] }) }))
  openOne('a')
  const host = () => p.document.querySelector('[data-part="popover"]')
  assert.equal(host().getAttribute('data-plugin'), 'dsh-threads')
  assert.equal(host().getAttribute('aria-label'), 'a')
  assert.match(host().textContent, /a/)
  assert.ok(host().querySelector('[data-menu-surface]'), 'on DSH\'s MenuSurface')
  // A click inside keeps it.
  p.act(() => { host().querySelector('div').dispatchEvent(new p.window.MouseEvent('pointerdown', { bubbles: true })) })
  assert.ok(host())
  // Outside closes it.
  p.act(() => { p.document.body.dispatchEvent(new p.window.MouseEvent('pointerdown', { bubbles: true })) })
  assert.equal(host(), null)
  openOne('b')
  p.act(() => { p.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.equal(host(), null)
  openOne('c')
  openOne('d')
  assert.equal(p.document.querySelectorAll('[data-part="popover"]').length, 1, 'one at a time')
  p.act(() => { p.document.getElementById('x-d').dispatchEvent(new p.window.MouseEvent('click', { bubbles: true })) })
  assert.deepEqual(closed, [['a', 'outside'], ['b', 'escape'], ['c', 'replaced'], ['d', 'done']])
  p.dispose(); p.close()
})

test('style() gives each plugin one stylesheet; scope() and selector() agree', async () => {
  const p = await page()
  const core = p.services.get('rsDshCore')
  const off = core.style('dsh-threads', '.a{}')
  core.style('dsh-threads', '.b{}')
  const sheets = p.document.querySelectorAll('style[data-rs-dsh-style="dsh-threads"]')
  assert.equal(sheets.length, 1)
  assert.equal(sheets[0].textContent, '.b{}')
  off()
  assert.equal(p.document.querySelector('style[data-rs-dsh-style="dsh-threads"]'), null)
  assert.deepEqual({ ...core.scope('dsh-quote') }, { 'data-rs-dsh': 'dsh-quote' })
  assert.equal(core.selector('dsh-quote'), '[data-rs-dsh="dsh-quote"]')
  assert.throws(() => core.style('Bad Name', ''), /plugin names/)
  p.dispose(); p.close()
})

test('registering the same button twice is refused; a disposer removes it', async () => {
  const p = await page()
  const core = p.services.get('rsDshCore')
  const off = core.selection.register({ plugin: 'dsh-quote', id: 'quote', label: 'Quote', onSelect: () => {} })
  assert.throws(() => core.selection.register({ plugin: 'dsh-quote', id: 'quote', label: 'Quote', onSelect: () => {} }), /already registered/)
  off()
  core.selection.register({ plugin: 'dsh-quote', id: 'quote', label: 'Quote', onSelect: () => {} })
  p.dispose(); p.close()
})

test('dispose removes the toolbar, popover, stylesheet and listeners', async () => {
  const p = await page()
  const core = p.services.get('rsDshCore')
  p.act(() => core.popover.open({ plugin: 'dsh-threads', anchor: { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }, render: () => 'x' }))
  p.dispose()
  assert.equal(p.document.querySelector('[data-rs-dsh="dsh-core"]'), null)
  assert.equal(p.document.querySelector('style[data-rs-dsh-style]'), null)
  p.close()
})
