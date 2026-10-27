// The service over a real dsh-session Session (appendPluginRecord as DSH
// writes it) and the real BlockAssembler, with a scripted model.
import assert from 'node:assert/strict'
import test from 'node:test'
import { BlockAssembler, ReasoningEffortId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, appendPluginRecord } from '@deepseek-ai/dsh-session'
import { resolveConfig } from '../lib/config.js'
import { createRouteHandlers, answer, ROUTES } from '../lib/route.js'
import { createCommentService } from '../lib/service.js'
import { sessionLog } from './fixtures.mjs'

/** A model that plays the given turns: each is { text } or { tools: [{ name, args }] }. */
function scriptedLlm(turns) {
  const calls = []
  return {
    calls,
    async prepareCall(config) {
      calls.push({ prepared: config })
      let used = false
      return {
        config: { ...config },
        async *stream(options) {
          // As in DSH: a prepared call can only be dispatched once.
          if (used) throw new Error('a prepared LLM call can only be dispatched once')
          used = true
          calls.push({ options })
          const turn = turns.shift() ?? { text: 'done' }
          if (turn.fail) { yield { type: 'finish', reason: { kind: 'error', failure: { message: turn.fail, code: 'X' } } }; return }
          if (turn.wait) await new Promise((resolve) => options.signal.addEventListener('abort', resolve))
          let i = 0
          if (turn.text) {
            yield { type: 'block-start', index: i, blockType: 'text' }
            yield { type: 'text-delta', index: i, text: turn.text }
            yield { type: 'block-end', index: i, block: { type: 'text', text: turn.text } }
            i++
          }
          for (const t of turn.tools ?? []) {
            const block = { type: 'tool-call', id: 'call-' + i, name: t.name, arguments: JSON.stringify(t.args) }
            yield { type: 'block-start', index: i, blockType: 'tool-call' }
            yield { type: 'block-end', index: i, block }
            i++
          }
          yield { type: 'finish', reason: { kind: turn.tools ? 'tool-calls' : 'stop' } }
        },
      }
    },
  }
}

// The conversation comes from the fixture log; the plugin's own records go
// into a real Session through appendPluginRecord, and a read returns both.
function harness({ turns = [], config = {}, live = true } = {}) {
  const session = Session.create('s1')
  const conversation = sessionLog()
  const sessions = { get: (id) => (live && id === 's1' ? session : undefined), flush: async () => true }
  const sessionQuery = {
    readSession: async (id) => {
      if (id !== 's1') throw new Error('not found')
      const records = session.log.map((e, i) => ({ ...structuredClone(e), seq: conversation.length + i }))
      return { events: [...conversation, ...records] }
    },
  }
  const llm = scriptedLlm(turns)
  const service = createCommentService({
    config: resolveConfig(config),
    sessions: () => sessions,
    sessionQuery: () => sessionQuery,
    llm: () => llm,
    session: { appendPluginRecord },
    llmLib: { BlockAssembler, ReasoningEffortId, createToolResultMessage },
  })
  return { session, service, llm }
}

const anchor = { kind: 'assistant', turn: 1, step: 2, text: 'Stale entries are refreshed in the background.', prefix: '10minutes.', suffix: '' }

async function settled(service) {
  for (let i = 0; i < 200 && service._replying.size > 0; i++) await new Promise((r) => setTimeout(r, 5))
}

test('a comment is a plugin record; the reply follows on the session\'s model', async () => {
  const { session, service, llm } = harness({ turns: [{ text: 'It keeps serving the stale entry.' }] })
  const created = await service.create('s1', anchor, '  What if the refresh fails?  ')
  assert.equal(created.replying, true)
  assert.equal(created.messages[0].text, 'What if the refresh fails?')
  await settled(service)
  const records = session.log.filter((e) => e.type.startsWith('plugin:dsh-threads/'))
  assert.equal(records.length, 2)
  assert.ok(records.every((e) => e.ignorable === true && e.data.sessionId === 's1'))
  // The session's model: the pending pick (model-b), with a token cap.
  assert.equal(llm.calls[0].prepared.model, 'model-b')
  assert.equal(llm.calls[0].prepared.maxTokens, 8192)
  const opening = llm.calls[1].options.messages[0].content[0].text
  assert.match(opening, /The user prompt of that turn:\n<prompt>\nAdd a cache to the fetcher\.\n<\/prompt>/)
  assert.match(opening, /<passage>\nStale entries are refreshed in the background\.\n<\/passage>/)
  assert.match(opening, /<comment>\nWhat if the refresh fails\?\n<\/comment>/)
  const { threads, canWrite } = await service.list('s1')
  assert.equal(canWrite, true)
  assert.equal(threads.length, 1)
  assert.deepEqual(threads[0].messages.map((m) => [m.role, m.text]), [['user', 'What if the refresh fails?'], ['ai', 'It keeps serving the stale entry.']])
  assert.equal(threads[0].messages[1].model, 'model-b')
  assert.equal(threads[0].replying, false)
  // Plugin records never enter the model's history.
  assert.ok(!JSON.stringify(session.deriveMessages()).includes('refresh fails'))
})

test('the replier reads the session through its tools, and the last round has none', async () => {
  const { service, llm } = harness({
    config: { reply: { maxRounds: 3 } },
    turns: [
      { tools: [{ name: 'find_in_session', args: { text: 'fetchJson' } }] },
      { tools: [{ name: 'read_event', args: { seq: 6 } }, { name: 'write_file', args: {} }] },
      { text: 'It wraps fetchJson.' },
    ],
  })
  await service.create('s1', anchor, 'Where is the fetcher?')
  await settled(service)
  const streams = llm.calls.filter((c) => c.options).map((c) => c.options)
  assert.equal(streams.length, 3)
  assert.deepEqual(streams[0].tools.map((t) => t.name), ['session_outline', 'find_in_session', 'read_event'])
  assert.equal(streams[2].tools, undefined)
  const results = streams[2].messages.filter((m) => m.role === 'tool')
  assert.match(results[0].content[0].text, /seq 6 · turn 1 · tool result/)
  assert.match(results[1].content[0].text, /^seq 6/)
  assert.equal(results[2].isError, true)
  assert.match(results[2].content[0].text, /unknown tool write_file/)
  assert.equal((await service.list('s1')).threads[0].messages.at(-1).text, 'It wraps fetchJson.')
})

test('a failed reply is shown, and can be retried', async () => {
  const { service } = harness({ turns: [{ fail: 'overloaded' }, { text: 'Second try.' }] })
  const t = await service.create('s1', anchor, 'Why?')
  await settled(service)
  let [thread] = (await service.list('s1')).threads
  assert.match(thread.failure, /The model failed: overloaded/)
  await service.retry('s1', t.id)
  await settled(service)
  ;[thread] = (await service.list('s1')).threads
  assert.equal(thread.failure, undefined)
  assert.equal(thread.messages.at(-1).text, 'Second try.')
  await assert.rejects(service.retry('s1', t.id), /already has its reply/)
})

test('follow-ups wait for the reply, and a thread holds maxComments of yours', async () => {
  const { service } = harness({ config: { maxComments: 2 }, turns: [{ wait: true }] })
  const t = await service.create('s1', anchor, 'One')
  await assert.rejects(service.comment('s1', t.id, 'Two'), /Wait for the reply/)
  await service.remove('s1', t.id) // also stops the reply
  const u = await service.create('s1', anchor, 'One')
  await settled(service)
  await service.comment('s1', u.id, 'Two')
  await settled(service)
  await assert.rejects(service.comment('s1', u.id, 'Three'), (e) => e.code === 'thread_full')
})

test('deleting a thread while it is replying drops the reply', async () => {
  const { service } = harness({ turns: [{ wait: true }] })
  const t = await service.create('s1', anchor, 'Slow?')
  await service.remove('s1', t.id)
  await settled(service)
  assert.deepEqual((await service.list('s1')).threads, [])
})

test('a session that is not running can be read, not written', async () => {
  const { service } = harness({ live: false })
  assert.deepEqual(await service.list('s1'), { threads: [], canWrite: false })
  await assert.rejects(service.create('s1', anchor, 'Hi'), (e) => e.code === 'inactive' && e.status === 409)
  await assert.rejects(service.list('nope'), (e) => e.code === 'no_session' && e.status === 404)
})

test('routes answer JSON, with expected failures as { error, message }', async () => {
  const { service } = harness({ turns: [{ text: 'ok' }] })
  const handlers = createRouteHandlers(service)
  const post = (path, body) => answer(handlers[path], new Request('http://x' + path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))
  let r = await post(ROUTES.create, { sessionId: 's1', anchor, text: 'Hi' })
  assert.equal(r.status, 200)
  const thread = await r.json()
  r = await post(ROUTES.create, { sessionId: 's1', anchor: { kind: 'x' }, text: 'Hi' })
  assert.equal(r.status, 400)
  assert.equal((await r.json()).error, 'bad_anchor')
  r = await post(ROUTES.comment, 'not json')
  assert.deepEqual(await r.json(), { error: 'bad_request', message: 'The request is not JSON' })
  r = await post(ROUTES.delete, { sessionId: 's1', threadId: 'nope' })
  assert.equal(r.status, 404)
  await settled(service)
  r = await answer(handlers[ROUTES.threads], new Request('http://x' + ROUTES.threads + '?sessionId=s1'))
  assert.equal((await r.json()).threads[0].id, thread.id)
  r = await answer(() => { throw Object.assign(new Error('/secret/path'), { code: 'EACCES' }) }, new Request('http://x'))
  assert.deepEqual(await r.json(), { error: 'failed', message: 'Something went wrong: EACCES' })
})
