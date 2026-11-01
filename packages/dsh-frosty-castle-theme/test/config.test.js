import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../index.js'

test('edge offsets remain unset for legacy fallback and accept independent values', () => {
  const fields = ['borderOffsetTop', 'borderOffsetRight', 'borderOffsetBottom', 'borderOffsetLeft']
  const legacy = Config({ borderOffset: 12 })
  assert.equal(legacy.borderOffset.get(), 12)
  for (const field of fields) assert.equal(legacy[field].get(), undefined)

  const values = [0, 1, 24, 48]
  const config = Config(Object.fromEntries(fields.map((field, i) => [field, values[i]])))
  for (const [i, field] of fields.entries()) {
    assert.equal(config[field].get(), values[i])
    for (const value of [-1, 49, 1.5]) assert.throws(() => Config({ [field]: value }), undefined, `${field}: ${value}`)
  }
})
