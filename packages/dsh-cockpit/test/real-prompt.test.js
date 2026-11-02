import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../index.js'
import { createStore } from '../lib/store.js'
import { tempHome } from './helpers.mjs'

// DSH's own prompt assembly, not a stand-in: it resolves a context's text synchronously and
// interpolates it, which is what failed every turn in 0.6.0-rc.1 (an async text function).
test('through the real DSH system prompt: the board context renders, with its problems', async () => {
  const home = await tempHome()
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ctx = new Context()
    class Tools extends Service { constructor(c) { super(c, 'tools') } register() { return () => {} } restrict() { return () => {} } }
    class Skills extends Service { constructor(c) { super(c, 'skills') } register() { return () => {} } }
    ctx.plugin(Tools)
    ctx.plugin(Skills)
    ctx.plugin(SystemPrompt)
    const fork = ctx.plugin(plugin, {})
    await fork
    const store = createStore({ dataDir: home + '/data/dsh-cockpit' })
    await store.writeBinding('real-s1', 'k')
    await store.change('k', () => ({ write: true, board: { format: 'dsh-cockpit.board', version: 1, key: 'k', revision: 1, createdAt: 't', updatedAt: 't', tasks: [
      { item: 'a', what: 'Parent', status: 'done', pr: '#62' },
      { item: 'b', what: 'Child', status: 'done', parent: 'a', pr: '#62' },
    ] } }), {})
    // What DSH itself resolves for the context, before any assemble listener can replace it:
    // a Promise here (an async text function) is what made every turn fail with
    // "text.indexOf is not a function" once the text was interpolated.
    let resolved
    ctx.on('system-prompt/assemble', async (_a, _c, next) => { resolved = (await next()).contexts.map((c) => c.text); return next() })
    const assembled = await ctx.systemPrompt.assemble({ scope: { id: 'real-s1' } })
    assert.ok(resolved.every((t) => typeof t === 'string'), 'every context text DSH resolved is a string, not a Promise: ' + resolved.map((t) => typeof t))
    const rendered = renderContextSnapshot(assembled)
    assert.match(rendered, /Cockpit board 'k':/)
    assert.match(rendered, /- Duplicate pr: #62 \(items a, b\)/)
    assert.match(rendered, /fix only what is actually wrong/)
    await fork.dispose()
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  }
})
