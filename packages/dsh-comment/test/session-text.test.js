import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anchorSource, around, currentRoute, findAnchorEvent, replyAfter, sessionTitle, sessionTools, turnPrompt,
} from '../lib/session-text.js'
import { sessionLog } from './fixtures.mjs'

test('the route is the pending pick, else the last request', () => {
  const events = sessionLog()
  assert.deepEqual(currentRoute(events), { provider: 'claude', model: 'model-b' })
  const withoutPick = events.filter((e) => e.type !== 'model/selection')
  assert.deepEqual(currentRoute(withoutPick), { provider: 'claude', model: 'model-a', reasoningEffort: 'low' })
  // A request that used the pick consumes it.
  const used = [...events, { type: 'request/header', seq: 99, data: { header: { config: { provider: 'claude', model: 'model-b' } } } },
    { type: 'request/header', seq: 100, data: { header: { config: { provider: 'claude', model: 'model-c' } } } }]
  assert.equal(currentRoute(used).model, 'model-c')
  assert.equal(currentRoute([]), undefined)
})

test('anchors find their message and its text', () => {
  const events = sessionLog()
  const user = findAnchorEvent(events, { kind: 'user', messageId: 'u2' })
  assert.equal(anchorSource(user, { kind: 'user' }), 'Why 10 minutes?')
  const reply = findAnchorEvent(events, { kind: 'assistant', turn: 1, step: 2 })
  assert.equal(anchorSource(reply, { kind: 'assistant' }), 'The cache keeps entries for 10 minutes. Stale entries are refreshed in the background.')
  assert.equal(anchorSource(reply, { kind: 'reasoning', block: 0 }), 'Ten minutes is a fair TTL.')
  assert.equal(findAnchorEvent(events, { kind: 'assistant', turn: 9, step: 9 }), undefined)
  assert.equal(sessionTitle(events), 'Fetcher cache')
  assert.equal(turnPrompt(events, 1, reply.seq), 'Add a cache to the fetcher.')
  assert.equal(replyAfter(events, user.seq), 'Because the upstream data changes hourly.')
})

test('around keeps the part of a long text near the passage', () => {
  const long = 'a'.repeat(5000) + 'NEEDLE' + 'b'.repeat(5000)
  const cut = around(long, 'NEEDLE', 200)
  assert.ok(cut.includes('NEEDLE'))
  assert.ok(cut.length <= 202)
  assert.equal(around('short', 'x', 100), 'short')
})

test('tools: outline, find and read', () => {
  const tool = sessionTools(sessionLog())
  const outline = tool('session_outline', {})
  assert.match(outline, /Turn 1 \(seq 1–9\): Add a cache to the fetcher\./)
  assert.match(outline, /Turn 2 .*Why 10 minutes\?/)
  const found = tool('find_in_session', { text: 'TTL' })
  assert.match(found, /seq 5 · turn 1 · assistant/)
  assert.match(found, /seq 8 · turn 1 · assistant/)
  assert.match(tool('find_in_session', { text: 'fetchJson' }), /tool result/)
  assert.match(tool('find_in_session', { text: 'nowhere' }), /No event contains/)
  assert.match(tool('read_event', { seq: 6 }), /^seq 6 · turn 1 · tool result\nexport function fetchJson/)
  assert.throws(() => tool('read_event', { seq: 999 }), /no event with seq 999/)
  assert.throws(() => tool('find_in_session', {}), /text is required/)
  assert.throws(() => tool('write_file', {}), /unknown tool/)
})
