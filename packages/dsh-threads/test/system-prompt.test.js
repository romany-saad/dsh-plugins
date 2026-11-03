// The host registers one system-prompt section that explains sent threads.
import assert from 'node:assert/strict'
import test from 'node:test'
import { THREAD_PROMPT, apply } from '../index.js'

function fakeCtx(services) {
  const effects = []
  const ctx = {
    fiber: {},
    get: () => undefined,
    effect: (fn) => { effects.push(fn) },
    inject: (names, fn) => { if (names.every((n) => n in services)) fn({ ...ctx, ...services }) },
  }
  return { ctx, effects }
}

test('apply registers the comment-thread system prompt section', () => {
  const sections = []
  const { ctx } = fakeCtx({ systemPrompt: { section: (s) => { sections.push(s) } } })
  apply(ctx, {})
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'plugin:dsh-threads/comment-thread')
  assert.equal(sections[0].text, THREAD_PROMPT)
  assert.equal(sections[0].interpolate, false)
  assert.ok(Number.isFinite(sections[0].order))
  for (const tag of ['<comment-thread>', '<anchor>', '<passage>', '<comment>', '<reply>']) assert.ok(THREAD_PROMPT.includes(tag), tag)
  assert.ok(!THREAD_PROMPT.includes('{{'), 'no prompt variables')
})

test('apply runs without the prompt registry', () => {
  const { ctx } = fakeCtx({})
  assert.doesNotThrow(() => apply(ctx, {}))
})
