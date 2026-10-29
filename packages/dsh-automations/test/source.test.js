import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SourceLoader, normalizeModel, normalizeSchedule, normalizeTask } from '../lib/source.js'
import { tempDir } from './host.mjs'

test('each schedule kind normalizes to the Host input', () => {
  assert.deepEqual(normalizeSchedule({ cron: ' 30  8 * * 1-5 ' }, 'UTC', 'w').create, { cron: { expression: '30 8 * * 1-5', time_zone: 'UTC' } })
  assert.deepEqual(normalizeSchedule('0 9 * * *', 'UTC', 'w').create, { cron: { expression: '0 9 * * *', time_zone: 'UTC' } })
  assert.deepEqual(normalizeSchedule({ daily: '9:00' }, 'UTC', 'w').create, { daily: { time: '09:00:00', time_zone: 'UTC' } })
  assert.deepEqual(
    normalizeSchedule({ weekly: { time: '08:30', weekdays: ['thu', 'mon', 'Mon'] }, timeZone: 'Africa/Cairo' }, 'UTC', 'w').create,
    { weekly: { time: '08:30:00', time_zone: 'Africa/Cairo', weekdays: [1, 4] } },
  )
  assert.deepEqual(normalizeSchedule({ every: '15m' }, 'UTC', 'w').create, { every_seconds: 900 })
  assert.deepEqual(normalizeSchedule({ every: '2h' }, 'UTC', 'w').create, { every_seconds: 7200 })
  assert.deepEqual(normalizeSchedule({ at: '2026-12-01T09:00:00+02:00' }, 'UTC', 'w').create, { at: '2026-12-01T09:00:00+02:00' })
})

test('a schedule needs exactly one kind', () => {
  assert.throws(() => normalizeSchedule({}, 'UTC', 'w'), /exactly one/)
  assert.throws(() => normalizeSchedule({ daily: '09:00', every: '1h' }, 'UTC', 'w'), /exactly one/)
  assert.throws(() => normalizeSchedule({ daily: '9am' }, 'UTC', 'w'), /invalid time/)
  assert.throws(() => normalizeSchedule({ weekly: { time: '09:00', weekdays: ['someday'] } }, 'UTC', 'w'), /invalid weekdays/)
  assert.throws(() => normalizeSchedule({ every: 'often' }, 'UTC', 'w'), /invalid interval/)
})

test('a model is "provider/model" or an object with an optional effort', () => {
  assert.deepEqual(normalizeModel('claude/claude-opus-5-5', 'w'), { provider: 'claude', model: 'claude-opus-5-5' })
  assert.deepEqual(normalizeModel({ provider: 'p', model: 'm', reasoningEffort: 'high' }, 'w'), { provider: 'p', model: 'm', reasoningEffort: 'high' })
  assert.equal(normalizeModel(undefined, 'w'), undefined)
  assert.throws(() => normalizeModel('no-slash', 'w'), /provider\/model/)
})

test('a task takes the defaults under its own fields; a relative cwd resolves against its folder', () => {
  const task = normalizeTask(
    { id: 'digest', prompt: ' Go ', schedule: { daily: '09:00' }, permission: 'workspace-write' },
    { cwd: 'repo', timeZone: 'Africa/Cairo', permission: 'read-only', model: 'p/m' },
    'f#0',
    '/srv/tasks',
  )
  assert.equal(task.title, 'digest')
  assert.equal(task.prompt, 'Go')
  assert.equal(task.cwd, '/srv/tasks/repo')
  assert.equal(task.permission, 'workspace-write')
  assert.equal(task.timeZone, 'Africa/Cairo')
  assert.deepEqual(task.model, { provider: 'p', model: 'm' })
  assert.equal(task.session, 'persistent')
  assert.equal(task.enabled, true)
})

test('a bad task names its file, index and id', () => {
  const ok = { id: 'a', prompt: 'p', cwd: '/', schedule: { daily: '09:00' } }
  assert.throws(() => normalizeTask({ ...ok, id: 'bad id' }, {}, 'f#3'), /^Error: f#3: task id/)
  assert.throws(() => normalizeTask({ ...ok, prompt: '' }, {}, 'f#3'), /f#3 \[a\]: prompt/)
  assert.throws(() => normalizeTask({ ...ok, cwd: undefined }, {}, 'f#3'), /cwd is required/)
  assert.throws(() => normalizeTask({ ...ok, session: 'sometimes' }, {}, 'f#3'), /session must be/)
  assert.throws(() => normalizeTask({ ...ok, title: 'x'.repeat(121) }, {}, 'f#3'), /title must be/)
})

test('the loader reads yaml, json and js files, skips _ and . files, and refuses a duplicate id', async () => {
  const dir = await tempDir()
  await mkdir(join(dir, 'nested'))
  await writeFile(join(dir, 'a.yaml'), `defaults:\n  cwd: ${dir}\ntasks:\n  - id: one\n    prompt: p\n    schedule: { daily: "09:00" }\n`)
  await writeFile(join(dir, 'nested', 'b.json'), JSON.stringify([{ id: 'two', prompt: 'p', cwd: dir, schedule: { every: '1h' } }]))
  await writeFile(join(dir, 'c.mjs'), `export default () => ({ id: 'three', prompt: 'p', cwd: ${JSON.stringify(dir)}, schedule: '0 9 * * *' })\n`)
  await writeFile(join(dir, '_draft.yaml'), 'not: [valid')
  await writeFile(join(dir, '.hidden.json'), '{')
  await writeFile(join(dir, 'notes.txt'), 'ignored')
  const loader = new SourceLoader({ sources: [dir] })
  const { tasks } = await loader.load()
  assert.deepEqual([...tasks.keys()].sort(), ['one', 'three', 'two'])

  await writeFile(join(dir, 'd.json'), JSON.stringify({ id: 'one', prompt: 'p', cwd: dir, schedule: { every: '1h' } }))
  await assert.rejects(loader.load(), /duplicate task id/)
})

test('the loader refuses a cwd that does not exist and a source it cannot read', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, 'a.json'), JSON.stringify({ id: 'a', prompt: 'p', cwd: join(dir, 'missing'), schedule: { every: '1h' } }))
  await assert.rejects(new SourceLoader({ sources: [dir] }).load(), /does not exist/)
  await assert.rejects(new SourceLoader({ sources: [join(dir, 'nope')] }).load(), /not readable/)
  const { tasks } = await new SourceLoader({ sources: [join(dir, 'nope')], usesDefaultSources: true }).load()
  assert.equal(tasks.size, 0)
})
