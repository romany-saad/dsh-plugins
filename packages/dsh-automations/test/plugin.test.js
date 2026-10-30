import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as plugin from '../index.js'
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

const digest = { id: 'digest', title: 'Daily digest', prompt: 'Summarize', schedule: { daily: '09:00' } }

test('the config defaults to $DSH_HOME/automations and refuses a bad sources list', () => {
  const cfg = plugin.resolveConfig({})
  assert.equal(cfg.baseDir, process.env.DSH_HOME)
  assert.deepEqual(cfg.sources, ['automations'])
  assert.equal(cfg.statusFile, join(process.env.DSH_HOME, 'data', 'dsh-automations', 'status.json'))
  assert.equal(plugin.resolveConfig({ statusFile: false }).statusFile, undefined)
  assert.throws(() => plugin.resolveConfig({ sources: 'automations' }), /sources must be a list/)
})

test('a sync creates each task in its own Session, then changes nothing', async () => {
  const h = await setup([digest, { ...digest, id: 'hourly', title: 'Hourly', schedule: { every: '1h' }, permission: 'read-only' }])
  const first = await h.run()
  assert.equal(first.kind, 'success')
  assert.match(first.text, /2 changed, 0 removed, 0 unchanged, 0 errors/)
  const catalog = await h.schedule.catalog()
  assert.equal(catalog.length, 2)
  assert.notEqual(catalog[0].sessionId, catalog[1].sessionId)
  const session = h.sessionController.sessions.get(catalog.find((e) => e.title === 'Hourly').sessionId)
  assert.equal(session.title, '⏱ Hourly')
  assert.equal(session.permission, 'read-only')

  h.schedule.calls.length = 0
  const second = await h.run()
  assert.match(second.text, /0 changed, 0 removed, 2 unchanged/)
  assert.deepEqual(h.schedule.calls, [])
  await h.fork.dispose()
})

test('a changed schedule is updated in place, keeping its id', async () => {
  const h = await setup([digest])
  await h.run()
  const [before] = await h.schedule.catalog()
  await h.write([{ ...digest, schedule: { daily: '10:30' }, prompt: 'Summarize more' }])
  const report = await h.run()
  assert.match(report.text, /digest: schedule updated/)
  const [after] = await h.schedule.catalog()
  assert.equal(after.id, before.id)
  assert.equal(after.time, '10:30:00')
  assert.equal(after.prompt, 'Summarize more')
  await h.fork.dispose()
})

test('a renamed task retitles its Session', async () => {
  const h = await setup([digest])
  await h.run()
  await h.write([{ ...digest, title: 'Morning digest' }])
  assert.match((await h.run()).text, /digest: session retitled, schedule updated/)
  const [entry] = await h.schedule.catalog()
  assert.equal(h.sessionController.sessions.get(entry.sessionId).title, '⏱ Morning digest')
  await h.fork.dispose()
})

test('an edit made in the Schedule page is reverted to the file', async () => {
  const h = await setup([digest])
  await h.run()
  const [entry] = await h.schedule.catalog()
  h.schedule.records.get(entry.id).record.title = 'Edited in the UI'
  await h.run()
  const [after] = await h.schedule.catalog()
  assert.equal(after.title, 'Daily digest')
  await h.fork.dispose()
})

test('enabled: false and a removed task delete the schedule; the Session stays unless archiving is on', async () => {
  const h = await setup([digest, { ...digest, id: 'other', title: 'Other' }], { archiveRemovedSessions: true })
  await h.run()
  await h.write([{ ...digest, enabled: false }])
  const report = await h.run()
  assert.match(report.text, /digest: disabled \(schedule deleted\)/)
  assert.match(report.text, /other: removed/)
  assert.equal((await h.schedule.catalog()).length, 0)
  assert.equal(h.archived.length, 1)
  await h.fork.dispose()
})

test('a source error aborts the sync and deletes nothing', async () => {
  const h = await setup([digest])
  await h.run()
  await writeFile(h.file, '{ not json')
  const report = await h.run()
  assert.equal(report.kind, 'error')
  assert.match(report.text, /aborted: source error, nothing changed/)
  assert.equal((await h.schedule.catalog()).length, 1)
  await h.fork.dispose()
})

test('an empty source does not delete every task unless allowEmpty is set', async () => {
  const h = await setup([digest])
  await h.run()
  await h.write([])
  assert.match((await h.run()).text, /aborted: empty source/)
  assert.equal((await h.schedule.catalog()).length, 1)
  await h.fork.dispose()

  const h2 = await setup([digest], { allowEmpty: true })
  await h2.run()
  await h2.write([])
  assert.match((await h2.run()).text, /1 removed/)
  assert.equal((await h2.schedule.catalog()).length, 0)
  await h2.fork.dispose()
})

test('a task the Host rejects is reported and not retried until its declaration changes', async () => {
  const h = await setup([{ ...digest, schedule: { cron: '0 9 * *' } }])
  const first = await h.run()
  assert.match(first.text, /ERROR digest: invalid_rule/)
  h.schedule.calls.length = 0
  const second = await h.run()
  assert.match(second.text, /previously rejected/)
  assert.deepEqual(h.schedule.calls, [])
  await h.write([{ ...digest, schedule: { cron: '0 9 * * *' } }])
  assert.match((await h.run()).text, /schedule created/)
  await h.fork.dispose()
})

test('a model is selected for the task Session only', async () => {
  const h = await setup([{ ...digest, model: { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' } }])
  await h.run()
  const [entry] = await h.schedule.catalog()
  assert.deepEqual(h.sessionController.selections, [[entry.sessionId, { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' }]])
  await h.fork.dispose()
})

test('/automations status shows the last result without syncing; the status file is written', async () => {
  const dir = await tempDir()
  const statusFile = join(dir, 'status.json')
  const h = await setup([digest], { statusFile })
  await h.run()
  h.schedule.calls.length = 0
  await rm(h.file)
  const status = await h.run('status')
  assert.match(status.text, /1 changed/)
  assert.deepEqual(h.schedule.calls, [])
  const written = JSON.parse(await readFile(statusFile, 'utf8'))
  assert.equal(written.ok, true)
  await h.fork.dispose()
})

test('a missing default folder is no tasks, not an error', async () => {
  const host = createHost()
  const fork = host.ctx.plugin(plugin, quiet({}))
  await fork
  const report = await host.run()
  assert.equal(report.kind, 'success')
  assert.match(report.text, /0 changed, 0 removed, 0 unchanged, 0 errors/)
  await fork.dispose()
})
