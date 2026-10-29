import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// Load the real bundle the way the browser does.
function loadBundle() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let registered
  const window = { __ModuleLoader__: { load: (entry) => { registered = entry } } }
  vm.runInNewContext(source, { window, Intl })
  assert.equal(registered.id, '@rs-dsh/dsh-drafts')
  return registered.factory(() => { throw new Error('no requires at load time') })
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const bundle = loadBundle()
const d = bundle._internals

/** A Storage-like object over a plain record. */
function memoryStorage(entries) {
  const map = new Map(Object.entries(entries))
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  }
}

test('bundle id, name and inject match package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(bundle.name, pkg.name)
  assert.deepEqual([...bundle.inject].sort(), ['conversation', 'locale', 'rsDshCore', 'sessions', 'slots', 'uiWorkspace'])
})

test('the store key is the one DSH ui-conversation persists drafts under', () => {
  // ui-conversation's CONVERSATION_STORE_KEY is "dsh.conversation", suffixed with ".<sessionId>".
  const dsh = readFileSync(new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-conversation/client')), 'utf8')
  assert.match(dsh, /CONVERSATION_STORE_KEY = "dsh\.conversation"/)
  assert.match(dsh, /localStorage\.getItem\(`\$\{CONVERSATION_STORE_KEY\}\.\$\{sessionId\}`\)/)
  assert.equal(d.STORE_PREFIX, 'dsh.conversation.')
})

test('readDrafts keeps non-empty drafts, legacy strings and snapshots alike', () => {
  const storage = memoryStorage({
    'dsh.conversation.a': JSON.stringify({ draft: { text: 'hello', references: [] }, view: null }),
    'dsh.conversation.b': JSON.stringify({ draft: 'legacy text' }),
    'dsh.conversation.c': JSON.stringify({ draft: '   ' }),
    'dsh.conversation.d': '{not json',
    'dsh.conversation.e': JSON.stringify({ view: 'chat' }),
    'other.key': JSON.stringify({ draft: 'x' }),
  })
  const out = d.readDrafts(storage)
  assert.deepEqual([...out.keys()].sort(), ['a', 'b'])
  assert.equal(out.get('a').text, 'hello')
  assert.equal(out.get('b').text, 'legacy text')
})

test('lostDrafts lists blank, listed, unarchived Sessions other than the current one, newest first', () => {
  const drafts = new Map([
    ['old', { text: 'old one', draft: 'old one' }],
    ['new', { text: 'new one', draft: 'new one' }],
    ['cur', { text: 'here', draft: 'here' }],
    ['started', { text: 'sent', draft: 'sent' }],
    ['arch', { text: 'archived', draft: 'archived' }],
    ['gone', { text: 'unlisted', draft: 'unlisted' }],
    ['child', { text: 'sub', draft: 'sub' }],
  ])
  const row = (id, blank, updatedAt, extra = {}) => ({ id, blank, updatedAt, cwd: '/w', ...extra })
  const sessions = {
    ids: ['old', 'new', 'cur', 'started', 'arch', 'child'],
    byId: {
      old: row('old', true, 100),
      new: row('new', true, 200, { projectionValues: { agentPreset: 'coder' } }),
      cur: row('cur', true, 300),
      started: row('started', false, 400),
      arch: row('arch', true, 500),
      child: row('child', true, 600, { origin: 'subagent' }),
    },
  }
  const workspaces = { items: [{ workspaceId: 'w1', title: 'proj', path: '/w', sessionIds: ['old', 'new', 'cur'] }], archivedSessionIds: ['arch'] }
  const out = plain(d.lostDrafts({ drafts, sessions, workspaces, currentId: 'cur' }))
  assert.deepEqual(out.map((i) => i.id), ['new', 'old'])
  assert.equal(out[0].workspaceId, 'w1')
  assert.equal(out[0].workspaceTitle, 'proj')
  assert.equal(out[0].agentPreset, 'coder')
  assert.equal(out[1].agentPreset, undefined)
})

test('withDraft replaces only the draft field', () => {
  const raw = JSON.stringify({ draft: 'x', view: 'chat', viewRequest: null })
  assert.deepEqual(JSON.parse(d.withDraft(raw, '')), { draft: '', view: 'chat', viewRequest: null })
  assert.deepEqual(JSON.parse(d.withDraft(null, { text: 'y', references: [] })), { view: null, viewRequest: null, draft: { text: 'y', references: [] } })
})
