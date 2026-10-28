// The acceptance tests of design section 9. Number 7 (no network) is
// test/network.test.js and the --import setup file.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as plugin from '../index.js'
import { createHost, load } from './cordis-host.mjs'
import { exec, tempHome } from './helpers.mjs'

const home = await tempHome()
process.env.DSH_HOME = home
const dataDir = join(home, 'data', 'dsh-cockpit')
const readerUrl = new URL('../reader.js', import.meta.url).href
const fileOf = async (key) => JSON.parse(await readFile(join(dataDir, 'boards', encodeURIComponent(key) + '.json'), 'utf8'))

async function start(config = {}) {
  const { ctx, tools } = createHost()
  const fork = await load(ctx, plugin, config)
  const call = (name, args, session = 'hub-1') => tools.get(name).execute(args, exec(session))
  return { fork, call }
}

test('1. build a board, dispose the plugin, start a new instance, open the same key: the tasks deep-equal', async () => {
  const a = await start()
  await a.call('board_open', { key: 'acc-1', parent: 'o/r#883' })
  await a.call('board_add', { item: '1', what: 'Live run', status: 'now', issue: '#883' })
  await a.call('board_add', { item: '2', what: 'Log reader', parent: '1', pr: '#889', status: 'done' })
  await a.call('board_add', { item: '3', what: 'Work reports', parent: '1', dependsOn: ['2'], waitingOn: 'owner', readyCommand: 'gh pr merge 890', startWhen: 'after #889' })
  await a.call('board_update', { item: ['2', '3'], set: { model: 'opus' } })
  const before = await a.call('board_read', {})
  await a.fork.dispose()

  const b = await start()
  const opened = await b.call('board_open', { key: 'acc-1' }, 'another-session')
  assert.equal(opened.created, false)
  assert.deepEqual(opened.tasks, before.tasks)
  assert.equal(opened.tree, before.tree)
  assert.deepEqual(opened.flags, before.flags)
  // The resumed hub session finds its board without reopening it.
  assert.deepEqual((await b.call('board_read', {})).tasks, before.tasks)
  await b.fork.dispose()
})

test('2. after every board_add and board_update resolves, the file holds the change', async () => {
  const { fork, call } = await start()
  await call('board_open', { key: 'acc-2' })
  const steps = [
    ['board_add', { what: 'a' }],
    ['board_add', { item: 'b', what: 'b', dependsOn: ['1'] }],
    ['board_update', { item: '1', set: { status: 'now', branch: 'x' } }],
    ['board_update', { item: ['1', 'b'], set: { waitingOn: 'CI', status: 'waiting' } }],
    ['board_update', { item: 'b', set: { waitingOn: null } }],
    ['board_update', { item: '1', remove: true }],
  ]
  for (const [name, args] of steps) {
    const r = await call(name, args)
    assert.equal(r.ok, true, name)
    const file = await fileOf('acc-2')
    assert.equal(file.revision, r.revision, name)
    const changed = r.task ? [r.task] : r.tasks
    for (const t of changed) assert.deepEqual(file.tasks.find((f) => f.item === t.item), t, name)
    if (args.remove) assert.equal(file.tasks.some((f) => f.item === args.item), false)
  }
  await fork.dispose()
})

test('3. a child node that uses only the reader sees the last state with the plugin disposed', async () => {
  const { fork, call } = await start()
  await call('board_open', { key: 'acc-3' })
  await call('board_add', { what: 'first' })
  await call('board_update', { item: '1', set: { status: 'done' } })
  await call('board_add', { what: 'last', status: 'waiting' })
  const expected = (await call('board_read', {})).tree
  await fork.dispose()
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    'import(' + JSON.stringify(readerUrl) + ').then(async r => { const b = await r.readBoard("acc-3"); process.stdout.write(JSON.stringify({ revision: b.revision, tree: r.boardTree(b).tree })) })'],
  { env: { DSH_HOME: home }, encoding: 'utf8' })
  const seen = JSON.parse(out)
  assert.equal(seen.revision, (await fileOf('acc-3')).revision)
  assert.equal(seen.tree, expected)
})

test('4. parents, dependencies, a loop and an unknown reference give the expected tree and flags, with no row moved', async () => {
  const { fork, call } = await start()
  await call('board_open', { key: 'acc-4' })
  await call('board_add', { item: '883', what: 'Live run', status: 'now', issue: '#883' })
  await call('board_add', { item: '888', what: 'Log reader', status: 'done', issue: '#888', parent: '883', pr: '#889' })
  // A reference must name a task already on the board, so the loop is built in two steps.
  assert.equal((await call('board_add', { item: '885', what: 'Work reports', status: 'now', issue: '#885', parent: '886' })).code, 'unknown_reference')
  await call('board_add', { item: '885', what: 'Work reports', status: 'now', issue: '#885' })
  await call('board_add', { item: '886', what: 'Checks', status: 'waiting', issue: '#886', parent: '885', waitingOn: 'CI', nextAction: 'CI on #886' })
  await call('board_update', { item: '885', set: { parent: '886' } })
  // A removed task leaves the references to it, flagged.
  await call('board_add', { item: 'release notes', what: 'Release notes' })
  await call('board_add', { item: '887', what: 'Docs', status: 'next', issue: '#887', parent: '883', dependsOn: ['885', 'release notes'] })
  await call('board_update', { item: 'release notes', remove: true })
  const r = await call('board_read', {})
  assert.deepEqual(r.flags.map((f) => [f.item, f.code, f.ref]), [
    ['885', 'parent_loop', '886'],
    ['886', 'parent_loop', '885'],
    ['887', 'unknown_dependency', 'release notes'],
  ])
  const lines = r.tree.split('\n')
  assert.deepEqual(lines.slice(0, 4), ['Problems:', '  Parent loop: #885 ↔ #886', "  Unknown dependency: 'release notes' on #887", ''])
  const rows = lines.slice(4).map((l) => l.replace(/\s+$/, ''))
  assert.match(rows[0], /^883 +now +#883 Live run/)
  assert.match(rows[1], /^├─ 888 +done +#888 Log reader .*PR #889/)
  assert.match(rows[2], /^├─ 885 +now +#885 Work reports .*! parent loop: #885 → #886 → #885/)
  assert.match(rows[3], /^├─ 886 +waiting +#886 Checks +CI on #886 +! parent loop: #886 → #885 → #886$/)
  assert.match(rows[4], /^└─ 887 +next +#887 Docs .*blocked by #885 \(now\).*! blocked by 'release notes' \(not on the board\)/)
  assert.equal(rows.length, 5, 'every task is drawn once')
  // The data is stored as given.
  const file = await fileOf('acc-4')
  assert.deepEqual(file.tasks.map((t) => [t.item, t.parent]), [['883', undefined], ['888', '883'], ['885', '886'], ['886', '885'], ['887', '883']])
  await fork.dispose()
})

test('5. a board written by plain Node reads through the reader, and the plugin continues it', async () => {
  const file = join(dataDir, 'boards', 'acc-5.json')
  await mkdir(join(dataDir, 'boards'), { recursive: true })
  const hand = {
    format: 'dsh-cockpit.board', version: 1, key: 'acc-5', parent: 'o/r#1', revision: 4, updatedBy: 'another-harness',
    tasks: [
      { item: 'a', what: 'by hand', status: 'done' },
      { item: 'b', what: 'next one', status: 'next', dependsOn: ['a'], color: 'kept' },
    ],
  }
  await writeFile(file + '.tmp', JSON.stringify(hand))
  const { rename } = await import('node:fs/promises')
  await rename(file + '.tmp', file)
  const read = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    'import(' + JSON.stringify(readerUrl) + ').then(async r => process.stdout.write(JSON.stringify(await r.readBoard("acc-5"))))'],
  { env: { DSH_HOME: home }, encoding: 'utf8' }))
  assert.deepEqual(read, hand)

  const { fork, call } = await start()
  const opened = await call('board_open', { key: 'acc-5' }, 'hub-5')
  assert.equal(opened.created, false)
  assert.deepEqual(opened.tasks, hand.tasks)
  const add = await call('board_add', { what: 'continued' }, 'hub-5')
  assert.deepEqual([add.task.item, add.revision], ['1', 5])
  const u = await call('board_update', { item: 'b', set: { status: 'now' } }, 'hub-5')
  assert.equal(u.tasks[0].color, 'kept', 'a field the plugin does not know is kept')
  const after = await fileOf('acc-5')
  assert.deepEqual([after.revision, after.updatedBy, after.tasks.length], [6, 'hub-5', 3])
  await fork.dispose()
})

test('6. a fixture drift command\'s difference shows in the result and in the file', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/drift-report.mjs', import.meta.url))
  const command = JSON.stringify(process.execPath) + ' ' + JSON.stringify(fixture)
  for (const mode of ['report', 'apply']) {
    const key = 'acc-6-' + mode
    const { fork, call } = await start({ drift: { command, cwd: '', mode } })
    await call('board_open', { key })
    await call('board_add', { item: '1', what: 'Log reader', status: 'done', issue: '#888' })
    await call('board_add', { item: '2', what: 'Checks', status: 'waiting', issue: '#886', pr: '#891' })
    await call('board_add', { item: '3', what: 'Docs', status: 'next', issue: '#887', dependsOn: ['2'] })
    const before = await fileOf(key)
    const r = await call('board_read', { checkDrift: true })
    const file = await fileOf(key)
    const difference = [{ item: '2', status: 'done', note: '#891 merged' }]
    assert.equal(r.driftCheck, 'ran', mode)
    assert.deepEqual([r.drift.checked, r.drift.items], [3, difference], mode)
    assert.deepEqual(file.drift, r.drift, mode)
    if (mode === 'report') {
      assert.deepEqual([file.revision, file.tasks], [before.revision, before.tasks], 'report changes no task and keeps revision')
      assert.match(r.tree, /#886 Checks .*reported: done/)
    } else {
      assert.equal(file.revision, before.revision + 1, 'apply bumps revision')
      assert.equal(file.tasks.find((t) => t.item === '2').status, 'done')
      assert.deepEqual(r.tasks, file.tasks)
      assert.doesNotMatch(r.tree, /reported/)
    }
    // A second process reads the same drift result through the reader.
    const seen = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
      'import(' + JSON.stringify(readerUrl) + ').then(async r => process.stdout.write(JSON.stringify((await r.readBoard(' + JSON.stringify(key) + ')).drift)))'],
    { env: { DSH_HOME: home }, encoding: 'utf8' }))
    assert.deepEqual(seen, file.drift, mode)
    await fork.dispose()
  }
})
