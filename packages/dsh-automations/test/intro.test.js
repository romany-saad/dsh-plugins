import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as plugin from '../index.js'
import { describeSchedule, introPrompt } from '../lib/intro.js'
import { normalizeSchedule, normalizeTask } from '../lib/source.js'
import { createHost, quiet, tempDir } from './host.mjs'

process.env.DSH_HOME = await tempDir('dsh-automations-home-')

async function setup(tasks, extra) {
  const dir = await tempDir()
  const file = join(dir, 'tasks.json')
  const write = (list) => writeFile(file, JSON.stringify({ defaults: { cwd: dir, timeZone: 'UTC' }, tasks: list }))
  await write(tasks)
  const host = createHost()
  const fork = host.ctx.plugin(plugin, quiet({ sources: [dir], ...extra }))
  await fork
  return { ...host, dir, file, write, fork }
}

const digest = { id: 'digest', title: 'Daily digest', prompt: 'Summarize the repo', schedule: { weekly: { time: '08:30', weekdays: ['mon', 'thu'] } } }

test('a schedule is described in plain words', () => {
  const d = (raw) => describeSchedule(normalizeSchedule(raw, 'UTC', 'x').spec)
  assert.equal(d({ daily: '09:00' }), 'every day at 09:00 (UTC)')
  assert.equal(d({ weekly: { time: '08:30', weekdays: ['mon', 'thu'] } }), 'every Monday, Thursday at 08:30 (UTC)')
  assert.equal(d({ every: '2h' }), 'every 2 hours')
  assert.equal(d({ every: '1d' }), 'every day')
  assert.equal(d({ cron: '30 8 * * 1-5' }), 'cron "30 8 * * 1-5" (UTC)')
  assert.match(d({ at: '2026-12-01T09:00:00+02:00' }), /^once, at 2026-12-01/)
})

test('the intro is short, says what a persistent and a fresh task do, and leaves the task prompt out', () => {
  const task = (extra) => normalizeTask({ id: 'a', title: 'Digest', prompt: 'SECRET PROMPT BODY', schedule: { daily: '09:00' }, cwd: '/tmp', ...extra }, {}, 'f#0', '/tmp')
  const persistent = introPrompt(task(), { sessionTitlePrefix: '⏱ ' })
  assert.match(persistent, /scheduled task "Digest" \(every day at 09:00/)
  assert.match(persistent, /Each run arrives here as a new message/)
  assert.match(persistent, /pinning this conversation/)
  assert.match(persistent, /with no tools/)
  assert.doesNotMatch(persistent, /SECRET PROMPT BODY/)
  assert.ok(persistent.length < 420, `intro is ${persistent.length} characters`)
  assert.ok(!persistent.includes('\n'))
  const fresh = introPrompt(task({ session: 'fresh' }), { sessionTitlePrefix: '⏱ ' })
  assert.match(fresh, /its own conversation, titled "⏱ Digest · <date and time>"; nothing runs in this one/)
})

test('a new task conversation starts with the intro, once, so it is not blank', async () => {
  const h = await setup([digest, { ...digest, id: 'audit', title: 'Audit', session: 'fresh' }])
  await h.run()
  assert.equal(h.sessionController.prompts.length, 2)
  const catalog = await h.schedule.catalog()
  for (const entry of catalog) {
    const mine = h.sessionController.prompts.filter((p) => p.sessionId === entry.target.sessionId)
    assert.equal(mine.length, 1)
    assert.equal(mine[0].requestId, `dsh-automations:intro:${entry.target.sessionId}`)
    assert.match(mine[0].text, /scheduled task/)
  }
  assert.match(h.sessionController.prompts.find((p) => /Audit/.test(p.text)).text, /nothing runs in this one/)

  const again = await h.run()
  assert.equal(h.sessionController.prompts.length, 2)
  assert.match(again.text, /0 changed/)
  await h.fork.dispose()
})

test('the intro is sent after the schedule exists, and a task that fails to sync gets none', async () => {
  const h = await setup([digest, { ...digest, id: 'bad', title: 'Bad', schedule: { cron: 'not a cron' } }])
  await h.run()
  const catalog = await h.schedule.catalog()
  assert.deepEqual(catalog.map((e) => e.title), ['Daily digest'])
  // 'bad' was never scheduled, so its conversation was not introduced either.
  assert.deepEqual(h.sessionController.prompts.map((p) => p.sessionId), [catalog[0].target.sessionId])
  await h.fork.dispose()
})

test('a failed intro does not fail the sync, and is retried at the next one', async () => {
  const h = await setup([digest])
  h.sessionController.promptError = new Error('no model')
  const first = await h.run()
  assert.equal(first.kind, 'success')
  assert.match(first.text, /0 errors/)
  assert.equal(h.sessionController.prompts.length, 0)

  h.sessionController.promptError = undefined
  const second = await h.run()
  assert.equal(h.sessionController.prompts.length, 1)
  assert.match(second.text, /digest: introduced/)
  await h.fork.dispose()
})

test('intro: false sends none, a conversation that already has a message gets none, and a disabled task waits', async () => {
  const off = await setup([digest], { intro: false })
  await off.run()
  assert.equal(off.sessionController.prompts.length, 0)
  await off.fork.dispose()

  const h = await setup([{ ...digest, enabled: false }])
  await h.run()
  assert.equal(h.sessionController.prompts.length, 0)
  await h.write([{ ...digest, enabled: true }])
  await h.run()
  assert.equal(h.sessionController.prompts.length, 1)
  await h.fork.dispose()
})

test('a task synced by an earlier version, with no intro state, is left alone', async () => {
  const h = await setup([digest])
  await h.run()
  const state = h.storageDomain.domains.get('automation_sync').get('tasks')
  const row = structuredClone(state.get('digest'))
  delete row.introduced
  state.set('digest', row)
  h.sessionController.prompts.length = 0
  await h.run()
  assert.equal(h.sessionController.prompts.length, 0)
  await h.fork.dispose()
})
