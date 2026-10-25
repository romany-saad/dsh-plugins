import test from 'node:test'
import assert from 'node:assert/strict'

test('fetch throws in tests', () => {
  assert.throws(() => fetch('https://example.com'), /network access in a test/)
})
