import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, tempHome } from './helpers.mjs'

async function fixture(home, body) {
  const file = join(home, 'drift.mjs')
  await writeFile(file, body)
  return `"${process.execPath}" "${file}"`
}

const REPORT = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);
process.stdout.write(JSON.stringify({items:[{item:'2a',status:'done',note:'#902 merged',env:[process.env.DSH_COCKPIT_KEY,!!process.env.DSH_COCKPIT_FILE,!!process.env.DSH_HOME]},{item:'1',status:b.tasks[0].status}]}))})`

async function board(config) {
  const home = await tempHome()
  const s = await setup({ drift: { command: await fixture(home, config.script ?? REPORT), mode: config.mode ?? 'report' } }, { home })
  await s.tools.board_open({ key: 'k' }, s.exec())
  await s.tools.board_add({ item: '1', what: 'one', status: 'done' }, s.exec())
  await s.tools.board_add({ item: '2a', what: 'two', status: 'waiting' }, s.exec())
  return s
}

test('no command configured: checkDrift runs nothing', async () => {
  const { tools, exec } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const r = await tools.board_read({ checkDrift: true }, exec())
  assert.equal(r.ok, true)
  assert.equal(r.driftCheck, 'not_configured')
  assert.equal(r.drift, undefined)
})

test('report: differs only where status differs; tasks unchanged; file holds it', async () => {
  const { tools, store, exec } = await board({})
  const r = await tools.board_read({ checkDrift: true }, exec())
  assert.equal(r.driftCheck, 'ran')
  assert.deepEqual(r.drift.items.map((e) => [e.item, e.differs]), [['2a', true], ['1', false]])
  assert.equal(r.tasks.find((t) => t.item === '2a').status, 'waiting')
  const file = JSON.parse(await readFile(store.file('k'), 'utf8'))
  assert.equal(file.drift.items[0].note, '#902 merged')
})

test('apply sets the status', async () => {
  const { tools, exec } = await board({ mode: 'apply' })
  const r = await tools.board_read({ checkDrift: true }, exec())
  assert.equal(r.tasks.find((t) => t.item === '2a').status, 'done')
})

test('the command gets stdin and the variables', async () => {
  const script = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);
process.stdout.write(JSON.stringify({items:[{item:'1',note:[b.key,process.env.DSH_COCKPIT_KEY,process.env.DSH_COCKPIT_FILE.endsWith('k.json'),!!process.env.DSH_HOME].join(' ')}]}))})`
  const { tools, exec } = await board({ script })
  const r = await tools.board_read({ checkDrift: true }, exec())
  assert.equal(r.drift.items[0].note, 'k k true true')
})

test('non-zero exit and bad JSON give drift.error with tasks unchanged', async () => {
  for (const script of ['console.error("boom"); process.exit(3)', 'console.log("not json")']) {
    const { tools, exec } = await board({ script })
    const r = await tools.board_read({ checkDrift: true }, exec())
    assert.equal(r.ok, true)
    assert.equal(r.driftCheck, 'failed')
    assert.ok(r.drift.error)
    assert.equal(r.tasks.find((t) => t.item === '2a').status, 'waiting')
  }
})

test('an aborted signal stops the command', async () => {
  const { tools } = await board({ script: 'setTimeout(()=>{}, 60000)' })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 200)
  const started = Date.now()
  await assert.rejects(tools.board_read({ checkDrift: true }, { agent: { session: { id: 'sess-1' } }, signal: ac.signal }))
  assert.ok(Date.now() - started < 5000)
})
