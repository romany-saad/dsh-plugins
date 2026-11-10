import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import * as plugin from '../index.js'
import { GUIDANCE, scheduleOfRecord } from '../lib/agent.js'
import { createHost, quiet, tempDir } from './host.mjs'

process.env.DSH_HOME = await tempDir('dsh-automations-home-')

async function setup(extra = {}, hostOpts = {}) {
  const base = await tempDir()
  const userDir = join(base, 'automations')
  await mkdir(userDir)
  const defaultWorkspace = join(base, 'default-workspace')
  await mkdir(defaultWorkspace)
  const host = createHost({ defaultWorkspace, ...hostOpts })
  const fork = host.ctx.plugin(plugin, quiet({ baseDir: base, sources: [userDir], ...extra }))
  await fork
  return { ...host, base, userDir, agentDir: join(base, 'automations', 'agent'), defaultWorkspace: await realpath(defaultWorkspace), fork }
}

const digest = {
  id: 'team-digest',
  title: 'Team digest',
  timeZone: 'Africa/Cairo',
  schedule: { weekly: { time: '09:00', weekdays: ['tue', 'fri'] } },
  prompt: 'Summarize the channel since your previous run.',
}

test('the tools, the prompt section and the automations skill come and go with the plugin', async () => {
  const h = await setup()
  for (let i = 0; h.tools.size < 5 && i < 100; i++) await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual([...h.tools.keys()], ['automation_list', 'automation_upsert', 'automation_remove', 'automation_sync', 'automation_adopt'])
  const section = h.sections.get('rs-dsh:automations').text
  assert.equal(section, GUIDANCE)
  assert.match(section, /automation_upsert/)
  assert.match(section, /schedule_create only for a reminder that belongs in the current conversation/)
  assert.match(section, /automation plugin/)
  const skill = h.skills.get('automations')
  assert.ok(skill.description.length <= 500)
  assert.match(skill.content, /## Example: summarise a channel twice a week/)
  await h.fork.dispose()
  assert.equal(h.tools.size + h.sections.size + h.skills.size, 0)
})

test('tools: false registers no agent surface', async () => {
  const h = await setup({ tools: false })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(h.tools.size + h.sections.size + h.skills.size, 0)
})

test('the skill example names no tool the run might lack', async () => {
  const h = await setup()
  const content = h.skills.get('automations').content
  const example = content.slice(content.indexOf('## Example'), content.indexOf('## Change'))
  assert.doesNotMatch(example, /slack_|mcp__|web_fetch|web_search|bash|read_channel/)
  await h.fork.dispose()
})

test('automation_upsert writes a read-only YAML task, syncs it into the Default workspace and returns its next run', async () => {
  const h = await setup()
  const result = await h.call('automation_upsert', digest)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.created, true)
  assert.equal(result.file, join(h.agentDir, 'team-digest.yaml'))
  assert.ok(result.scheduleId)
  assert.ok(result.actions.includes('schedule created'))
  const written = parseYaml(await readFile(result.file, 'utf8'))
  assert.equal(written.permission, 'read-only')
  assert.equal(written.cwd, undefined)
  const [entry] = await h.schedule.catalog()
  assert.deepEqual(entry.weekdays, [2, 5])
  assert.equal(entry.timeZone, 'Africa/Cairo')
  assert.equal(h.sessionController.sessions.get(entry.target.sessionId).cwd, h.defaultWorkspace)

  const list = await h.call('automation_list')
  assert.equal(list.tasks.length, 1)
  assert.equal(list.tasks[0].agentOwned, true)
  assert.equal(list.tasks[0].sessionId, entry.target.sessionId)
  assert.deepEqual(list.reminders, [])

  // Same id again: replaced in place, not a second task.
  const again = await h.call('automation_upsert', { ...digest, schedule: { daily: '08:00' } })
  assert.equal(again.ok, true)
  assert.equal(again.created, false)
  assert.equal(again.scheduleId, result.scheduleId)
  assert.equal((await h.schedule.catalog()).length, 1)
  await h.fork.dispose()
})

test('a bad task is refused before anything is written', async () => {
  const h = await setup()
  const bad = await h.call('automation_upsert', { ...digest, schedule: { weekly: { time: '9am', weekdays: ['tue'] } } })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'invalid_task')
  assert.match(bad.message, /invalid time/)
  await assert.rejects(readdir(h.agentDir))
  await h.fork.dispose()
})

test('a task DSH rejects is undone: no file, no schedule', async () => {
  const h = await setup()
  const result = await h.call('automation_upsert', { ...digest, schedule: { cron: '0 9 * *' } })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'refused')
  assert.match(result.message, /invalid_rule/)
  assert.deepEqual(await readdir(h.agentDir), [])
  assert.equal((await h.schedule.catalog()).length, 0)
  await h.fork.dispose()
})

test('a task from a user file is not changed or removed by the tools', async () => {
  const h = await setup()
  await writeFile(join(h.userDir, 'mine.yaml'), 'id: team-digest\nprompt: p\nschedule: { daily: "09:00" }\n')
  const upsert = await h.call('automation_upsert', digest)
  assert.equal(upsert.ok, false)
  assert.match(upsert.message, /a file the user keeps/)
  const remove = await h.call('automation_remove', { id: 'team-digest' })
  assert.equal(remove.code, 'not_agent_owned')
  await h.fork.dispose()
})

test('automation_remove deletes an agent task, even the last one', async () => {
  const h = await setup()
  await h.call('automation_upsert', digest)
  const removed = await h.call('automation_remove', { id: 'team-digest' })
  assert.equal(removed.ok, true, JSON.stringify(removed))
  assert.equal((await h.schedule.catalog()).length, 0)
  assert.deepEqual(await readdir(h.agentDir), [])
  assert.equal((await h.call('automation_remove', { id: 'team-digest' })).code, 'not_found')
  await h.fork.dispose()
})

test('more than read-only asks the user first; read-only does not', async () => {
  const h = await setup()
  const asked = await h.call('automation_upsert', { ...digest, permission: 'workspace-write' })
  assert.equal(asked.gate.kind, 'ask')
  assert.match(asked.gate.displayReason.en, /team-digest.*workspace-write/)
  assert.ok(asked.gate.displayReason.zh)
  assert.equal((await h.call('automation_upsert', digest)).ok, true)
  assert.equal((await h.call('automation_list')).gate, undefined)
  await h.fork.dispose()
})

test('automation_adopt turns a reminder into a task and deletes the reminder', async () => {
  const h = await setup()
  h.sessionController.sessions.set('session-chat', { cwd: h.defaultWorkspace })
  const reminder = await h.schedule.create({
    title: 'Summarize Slack channel updates',
    prompt: 'Summarize the channel.',
    timing: { kind: 'weekly', weekly: { time: '09:00:00', time_zone: 'Africa/Cairo', weekdays: [2, 5] } },
    target: { kind: 'session', sessionId: 'session-chat' },
  })
  const list = await h.call('automation_list')
  assert.deepEqual(list.reminders.map((r) => r.scheduleId), [reminder.id])

  const adopted = await h.call('automation_adopt', { scheduleId: reminder.id, id: 'channel-digest' })
  assert.equal(adopted.ok, true, JSON.stringify(adopted))
  assert.equal(adopted.adoptedFrom, reminder.id)
  const catalog = await h.schedule.catalog()
  assert.equal(catalog.length, 1, 'the reminder is gone, the task is there')
  assert.notEqual(catalog[0].id, reminder.id)
  assert.equal(catalog[0].title, 'Summarize Slack channel updates')
  assert.deepEqual(catalog[0].weekdays, [2, 5])
  assert.equal(catalog[0].timeZone, 'Africa/Cairo')
  const written = parseYaml(await readFile(adopted.file, 'utf8'))
  assert.deepEqual(written.schedule, { weekly: { time: '09:00', weekdays: ['tue', 'fri'] } })
  assert.equal(written.prompt, 'Summarize the channel.')

  assert.equal((await h.call('automation_adopt', { scheduleId: catalog[0].id, id: 'again' })).code, 'already_a_task')
  assert.equal((await h.call('automation_adopt', { scheduleId: 'nope', id: 'x' })).code, 'not_found')
  await h.fork.dispose()
})

test('a reminder record maps back to each schedule form', () => {
  assert.deepEqual(scheduleOfRecord({ kind: 'cron', expression: '0 9 * * *', timeZone: 'UTC' }), { schedule: { cron: '0 9 * * *' }, timeZone: 'UTC' })
  assert.deepEqual(scheduleOfRecord({ kind: 'daily', time: '09:30:00', timeZone: 'UTC' }), { schedule: { daily: '09:30' }, timeZone: 'UTC' })
  assert.deepEqual(scheduleOfRecord({ kind: 'every', everySeconds: 7200 }), { schedule: { every: '2h' } })
  assert.deepEqual(scheduleOfRecord({ kind: 'after', scheduledAt: '2026-12-01T07:00:00.000Z' }), { schedule: { at: '2026-12-01T07:00:00.000Z' } })
})

test('without a Default workspace, a task with no cwd reports an error and other tasks still sync', async () => {
  const h = await setup({}, { defaultWorkspace: undefined })
  await writeFile(join(h.userDir, 'a.yaml'), 'tasks:\n  - id: nocwd\n    prompt: p\n    schedule: { daily: "09:00" }\n  - id: withcwd\n    prompt: p\n    cwd: ' + h.userDir + '\n    schedule: { daily: "09:00" }\n')
  const report = await h.run()
  assert.match(report.text, /ERROR nocwd: this profile has no Default workspace; give the task a cwd/)
  assert.match(report.text, /withcwd: session created/)
  await h.fork.dispose()
})
