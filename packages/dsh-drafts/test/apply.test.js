// dsh-drafts on a jsdom page with real React and the real @rs-dsh/dsh-core:
// the card renders in a blank conversation, Open resumes the Session, and
// Discard clears the saved draft, with Undo.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPage, fakePrimitives, click, settle } from '../../dsh-core/test/dom.mjs'

const CORE = new URL('../../dsh-core/client.js', import.meta.url)
const DRAFTS = new URL('../client.js', import.meta.url)

const hook = (value) => (select) => select(value)

function harness({ current = { blank: true, promptAttempted: false, running: false }, createResult } = {}) {
  const probe = createPage({ bundles: [CORE] })
  const names = probe.modules[0].exports._internals.UI_EXPORTS
  probe.close()
  const page = createPage({ bundles: [CORE, DRAFTS], primitives: fakePrimitives(names) })
  const storage = page.window.localStorage
  storage.clear()
  storage.setItem('dsh.conversation.lost', JSON.stringify({ draft: { text: 'refactor the retry loop', references: [] }, view: null, viewRequest: null }))
  storage.setItem('dsh.conversation.cur', JSON.stringify({ draft: '', view: null, viewRequest: null }))
  // jsdom's localStorage belongs to this window; the bundle reads the global.
  globalThis.localStorage = storage
  const calls = { create: [], open: [], setDraft: [] }
  const loaded = { setDraft: (draft) => calls.setDraft.push(draft) }
  let slot = null
  // A dictionary-backed t, so the row's time label is checked as the user reads it.
  let dict = {}
  page.ctx.locale = {
    register: (_ns, dicts) => { dict = dicts.en; return () => {} },
    bind: () => (key, vars = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k]),
  }
  page.start({
    slots: { inject: (_n, make) => make(), register: (desc, component) => { slot = { desc, component }; return () => {} } },
    sessions: {
      scope: (id) => (id === 'lost' ? { id } : undefined),
      create: async (req) => { calls.create.push(req); return createResult ?? req.sessionId },
    },
    conversation: { input: { for: () => loaded } },
    uiWorkspace: { openSession: (id) => calls.open.push(id) },
  })
  const sessions = {
    ids: ['lost', 'cur'],
    byId: {
      lost: { id: 'lost', blank: true, updatedAt: Date.now() - 120_000, cwd: '/w' },
      cur: { id: 'cur', blank: true, updatedAt: Date.now(), cwd: '/w' },
    },
  }
  const workspaces = { items: [{ workspaceId: 'w1', title: 'proj', path: '/w', sessionIds: ['lost', 'cur'] }], archivedSessionIds: [] }
  const host = page.document.createElement('div')
  page.document.body.append(host)
  const React = page.services.get('rsDshCore').React
  const root = require('react-dom/client').createRoot(host)
  const render = (session = current) => page.act(() => {
    root.render(React.createElement(slot.component, {
      sessionId: 'cur',
      useSession: hook(session),
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaces),
    }))
  })
  render()
  return { page, host, calls, storage, render, slot, close: () => { page.act(() => root.unmount()); page.dispose(); page.close() } }
}

import { createRequire } from 'node:module'
const require = createRequire(new URL('../../dsh-core/test/dom.mjs', import.meta.url))

const buttons = (host) => [...host.querySelectorAll('button')]
const byText = (host, text) => buttons(host).find((b) => b.textContent === text)

test('registers one dock entry above the composer', () => {
  const h = harness()
  assert.equal(h.slot.desc.name, 'conversation.input.dock')
  assert.equal(h.slot.desc.id, 'rs-dsh-drafts')
  h.close()
})

test('a blank conversation lists the other blank Session\'s draft', () => {
  const h = harness()
  const rows = h.host.querySelectorAll('[data-draft-session]')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].getAttribute('data-draft-session'), 'lost')
  assert.match(rows[0].textContent, /refactor the retry loop/)
  assert.match(rows[0].textContent, /proj · 2min ago/, 'dated like the sidebar hover card')
  h.close()
})

test('a started conversation shows nothing', () => {
  const h = harness({ current: { blank: false, promptAttempted: true, running: false } })
  assert.equal(h.host.querySelector('[data-rs-dsh="dsh-drafts"]'), null)
  h.close()
})

test('Open resumes the blank Session through the Host and opens it', async () => {
  const h = harness()
  click(h.page, byText(h.host, 'Open'))
  await settle(h.page, 10)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.create)), [{ sessionId: 'lost', workspaceId: 'w1' }])
  assert.deepEqual(h.calls.open, ['lost'])
  h.close()
})

test('Open copies the draft when the Host gives a new Session instead', async () => {
  const h = harness({ createResult: 'fresh' })
  click(h.page, byText(h.host, 'Open'))
  await settle(h.page, 10)
  assert.deepEqual(h.calls.open, ['fresh'])
  assert.equal(JSON.parse(h.storage.getItem('dsh.conversation.fresh')).draft.text, 'refactor the retry loop')
  assert.equal(JSON.parse(h.storage.getItem('dsh.conversation.lost')).draft, '')
  h.close()
})

test('Discard clears the saved and loaded draft; Undo puts it back', () => {
  const h = harness()
  const before = h.storage.getItem('dsh.conversation.lost')
  click(h.page, byText(h.host, 'Discard'))
  assert.equal(JSON.parse(h.storage.getItem('dsh.conversation.lost')).draft, '')
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.setDraft)), [{ text: '', references: [] }])
  h.render()
  assert.ok(byText(h.host, 'Undo'), 'the row stays with Undo')
  click(h.page, byText(h.host, 'Undo'))
  assert.equal(h.storage.getItem('dsh.conversation.lost'), before)
  h.render()
  assert.ok(byText(h.host, 'Open'), 'the draft is listed again')
  h.close()
})
