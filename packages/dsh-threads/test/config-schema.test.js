import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, liveConfig } from '../index.js'
import { DEFAULT_CONFIG, MAX_CONFIG, resolveConfig } from '../lib/config.js'

test('host settings schema preserves defaults and nested overrides', () => {
  assert.deepEqual({ ...liveConfig(Config({})) }, DEFAULT_CONFIG)
  const value = liveConfig(Config({ reply: { web: true, maxRounds: 2 }, maxComments: 8 }))
  assert.deepEqual({ ...value }, resolveConfig({ reply: { web: true, maxRounds: 2 }, maxComments: 8 }))
  assert.throws(() => Config({ reply: { maxTokens: 0 } }))
  assert.throws(() => Config({ reply: { timeoutMs: 3600001 } }))
  assert.throws(() => resolveConfig({ reply: { timeoutMs: 3600001 } }))
  for (const field of Object.values(Config.dict.reply.dict)) assert.equal(field.meta.volatile, true)
  assert.equal(Config.dict.maxComments.meta.volatile, true)
})

test('schema and resolver enforce each inclusive numeric boundary', () => {
  for (const [field, max] of Object.entries(MAX_CONFIG)) {
    const make = (value) => field === 'maxComments' ? { maxComments: value } : { reply: { [field]: value } }
    for (const value of [1, max]) {
      assert.doesNotThrow(() => Config(make(value)), `${field}: ${value}`)
      assert.doesNotThrow(() => resolveConfig(make(value)), `${field}: ${value}`)
    }
    for (const value of [0, max + 1, 1.5]) {
      assert.throws(() => Config(make(value)), undefined, `${field}: ${value}`)
      assert.throws(() => resolveConfig(make(value)), undefined, `${field}: ${value}`)
    }
  }
})

test('running config reads current volatile references and plain overrides', () => {
  const parsed = Config({})
  const config = liveConfig(parsed)
  const write = Symbol.for('cosmokit.volatile.write')
  parsed.reply.web[write](true)
  parsed.reply.maxTokens[write](512)
  parsed.maxComments[write](2)
  assert.equal(config.reply.web, true)
  assert.equal(config.reply.maxTokens, 512)
  assert.equal(config.maxComments, 2)
  assert.equal(liveConfig({ reply: { web: true } }).reply.web, true)
})
