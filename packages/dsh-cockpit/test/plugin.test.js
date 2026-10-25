import test from 'node:test'
import assert from 'node:assert/strict'
import { available } from './dsh-resolve.mjs'
import { tempHome } from './helpers.mjs'
import { join } from 'node:path'

// Registers the real definitions through a stub ctx and checks the outputs
// against the declared schemas with dsh-tools' own validator.
test('apply registers four tools whose outputs validate', { skip: !available && 'DSH installation not found' }, async () => {
  const { apply } = await import('../index.js')
  const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools')
  const home = await tempHome()
  const registered = []
  const ctx = { inject: (deps, fn) => { if (deps[0] === 'connection') return; assert.deepEqual(deps, ['tools']); fn({ tools: { register: (d) => { registered.push(d); return () => {} } } }) } }
  apply(ctx, { dataDir: join(home, 'data', 'dsh-cockpit') })
  assert.deepEqual(registered.map((d) => d.name), ['board_open', 'board_read', 'board_add', 'board_update'])
  const byName = Object.fromEntries(registered.map((d) => [d.name, d]))
  const exec = { agent: { session: { id: 's' } }, signal: new AbortController().signal }
  const calls = [
    ['board_read', {}],
    ['board_open', { key: 'k', parent: 'p' }],
    ['board_add', { what: 'x', dependsOn: ['9'], readyCommand: 'echo' }],
    ['board_update', { item: '1', set: { pr: null, status: 'waiting' } }],
    ['board_update', { item: '9', set: {} }],
    ['board_read', { status: ['waiting'] }],
    ['board_update', { item: '1', remove: true }],
  ]
  for (const [name, args] of calls) {
    const value = await byName[name].execute(args, exec)
    assert.deepEqual(validateJsonSchemaValue(byName[name].output.schema, value, ''), [], name)
  }
  assert.deepEqual(byName.board_update.presentCall({ item: '2', set: { status: 'done' } }), { card: 'generic', title: 'update 2 → done', kind: 'edit' })
  const opened = await byName.board_open.execute({ key: 'k' }, exec)
  assert.equal(opened.file.version, 1)
  const meta = byName.board_open.output.presentationMeta({ key: 'k' }, opened)
  assert.deepEqual(byName.board_open.presentResult({ key: 'k' }, { content: [], isError: false, meta }), { card: 'generic', title: 'open k' })
  assert.equal(byName.board_read.isConcurrencySafe({}), true)
  assert.equal(byName.board_read.isConcurrencySafe({ checkDrift: true }), false)
  await assert.rejects(byName.board_add.execute({ what: 'x', status: 'later' }, exec), /status/)
})

test('tools.enabled false registers none', { skip: !available && 'DSH installation not found' }, async () => {
  const { apply } = await import('../index.js')
  const ctx = { inject: (deps) => { if (deps[0] !== 'connection') assert.fail('inject called') } }
  apply(ctx, { tools: { enabled: false }, dataDir: join(await tempHome(), 'd') })
})
