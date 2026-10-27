import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConfig } from '../lib/config.js'
import {
  CommentError, RECORD_DELETE, RECORD_THREAD, cleanAnchor, cleanComment, deleteRecord, foldThreads, threadRecord, validThread,
} from '../lib/threads.js'

const anchor = { kind: 'assistant', turn: 2, step: 1, text: 'the passage', prefix: 'before ', suffix: ' after' }
const thread = (id, extra = {}) => ({
  id, createdAt: 1, anchor, messages: [{ id: 'm1', role: 'user', text: 'why?', time: 1 }], ...extra,
})
const record = (type, data, seq) => ({ type, seq, time: 1, data, ignorable: true })

test('cleanAnchor keeps what each kind needs and drops the rest', () => {
  assert.deepEqual(cleanAnchor({ ...anchor, extra: 1, block: 3 }), anchor)
  assert.deepEqual(cleanAnchor({ kind: 'user', messageId: 'abc', text: 'x' }), { kind: 'user', messageId: 'abc', text: 'x', prefix: '', suffix: '' })
  assert.equal(cleanAnchor({ kind: 'reasoning', turn: 1, step: 2, block: 0, text: 'x' }).block, 0)
})

test('cleanAnchor cuts the surrounding text to 64 characters, nearest the passage', () => {
  const a = cleanAnchor({ ...anchor, prefix: 'p'.repeat(100) + 'END', suffix: 'START' + 's'.repeat(100) })
  assert.equal(a.prefix.length, 64)
  assert.ok(a.prefix.endsWith('END'))
  assert.ok(a.suffix.startsWith('START'))
})

test('cleanAnchor refuses bad anchors', () => {
  for (const bad of [
    null, {}, { ...anchor, kind: 'tool' }, { ...anchor, text: '  ' }, { ...anchor, turn: -1 }, { ...anchor, step: 1.5 },
    { kind: 'user', text: 'x' }, { kind: 'reasoning', turn: 1, step: 1, text: 'x' }, { ...anchor, prefix: 3 },
  ]) {
    assert.throws(() => cleanAnchor(bad), CommentError, JSON.stringify(bad))
  }
  assert.throws(() => cleanAnchor({ ...anchor, text: 'x'.repeat(2001) }), /at most 2000/)
})

test('cleanComment trims and limits', () => {
  assert.equal(cleanComment('  hi \n'), 'hi')
  assert.throws(() => cleanComment(' '), /empty/)
  assert.throws(() => cleanComment('x'.repeat(4001)), /at most 4000/)
})

test('foldThreads keeps the latest version of each thread in creation order', () => {
  const s = 'session-a'
  const events = [
    { type: 'user/message', seq: 0, data: {} },
    record(RECORD_THREAD, threadRecord(s, thread('t1')), 1),
    record(RECORD_THREAD, threadRecord(s, thread('t2')), 2),
    record(RECORD_THREAD, threadRecord(s, thread('t1', { messages: [...thread('t1').messages, { id: 'm2', role: 'ai', text: 'because', time: 2 }] })), 3),
  ]
  const threads = foldThreads(events, s)
  assert.deepEqual([...threads.keys()], ['t1', 't2'])
  assert.equal(threads.get('t1').messages.length, 2)
})

test('foldThreads drops deleted threads, and a fork does not see its parent\'s', () => {
  const events = [
    record(RECORD_THREAD, threadRecord('parent', thread('t1')), 1),
    record(RECORD_THREAD, threadRecord('child', thread('t2')), 2),
    record(RECORD_THREAD, threadRecord('child', thread('t3')), 3),
    record(RECORD_DELETE, deleteRecord('child', 't2'), 4),
  ]
  assert.deepEqual([...foldThreads(events, 'child').keys()], ['t3'])
  assert.deepEqual([...foldThreads(events, 'parent').keys()], ['t1'])
})

test('foldThreads skips records that are not ignorable, of another version, or malformed', () => {
  const s = 'x'
  const events = [
    { ...record(RECORD_THREAD, threadRecord(s, thread('a')), 1), ignorable: false },
    record(RECORD_THREAD, { ...threadRecord(s, thread('b')), v: 2 }, 2),
    record(RECORD_THREAD, threadRecord(s, { ...thread('c'), messages: [] }), 3),
    record(RECORD_THREAD, threadRecord(s, { ...thread('d'), anchor: { kind: 'tool' } }), 4),
    record(RECORD_THREAD, threadRecord(s, thread('e')), 5),
  ]
  assert.deepEqual([...foldThreads(events, s).keys()], ['e'])
  assert.equal(validThread(thread('ok')), true)
})

// Threads saved by 0.1.0-rc.1, when the plugin was dsh-comment, keep showing.
test('foldThreads reads records saved under the old name, dsh-comment', () => {
  const s = 'x'
  const events = [
    record('plugin:dsh-comment/thread', threadRecord(s, thread('old')), 1),
    record('plugin:dsh-comment/thread', threadRecord(s, thread('gone')), 2),
    record('plugin:dsh-comment/thread-delete', deleteRecord(s, 'gone'), 3),
    // A later change to an old thread is written under the new name and wins.
    record(RECORD_THREAD, threadRecord(s, thread('old', { createdAt: 9 })), 4),
    record('plugin:someone-else/thread', threadRecord(s, thread('foreign')), 5),
  ]
  const threads = foldThreads(events, s)
  assert.deepEqual([...threads.keys()], ['old'])
  assert.equal(threads.get('old').createdAt, 9)
  assert.equal(RECORD_THREAD, 'plugin:dsh-threads/thread')
})

test('config: defaults, overrides and refusals', () => {
  const d = resolveConfig()
  assert.equal(d.reply.enabled, true)
  assert.equal(d.maxComments, 5)
  const c = resolveConfig({ reply: { maxRounds: 2 }, maxComments: 9 })
  assert.equal(c.reply.maxRounds, 2)
  assert.equal(c.reply.maxTokens, d.reply.maxTokens)
  assert.equal(c.maxComments, 9)
  assert.throws(() => resolveConfig({ replies: {} }), /unknown config key replies/)
  assert.throws(() => resolveConfig({ reply: { tokens: 1 } }), /unknown config key reply.tokens/)
  assert.throws(() => resolveConfig({ reply: { maxTokens: 0 } }), /reply.maxTokens/)
  assert.throws(() => resolveConfig({ reply: { enabled: 'yes' } }), /reply.enabled/)
})
