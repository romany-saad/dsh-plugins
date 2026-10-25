import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { boardTree, dataDirSource, listBoards, readBoard } from '../reader.js'
import { newBoard, setup, t } from './helpers.mjs'

const readerUrl = new URL('../reader.js', import.meta.url).href

async function writeBoard(store, key, tasks) {
  await store.change(key, () => ({ board: { ...newBoard(key, store.now()), tasks }, write: true }))
}

test('a second process reads the last state through the reader alone', async () => {
  const { store, dataDir, home } = await setup()
  await writeBoard(store, 'a/b', [t('1', 'next', 'x')])
  assert.deepEqual(await listBoards(dataDir), ['a/b'])
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import('${readerUrl}').then(async r=>{const b=await r.readBoard('a/b');console.log(r.boardTree(b).tree)})`],
  { env: { DSH_HOME: home }, encoding: 'utf8' })
  assert.match(out, /^1 +next +x/)
})

test('fallback: a board written by plain Node, without the store, reads through the reader', async () => {
  const { dataDir } = await setup()
  const file = join(dataDir, 'boards', 'hand.json')
  await mkdir(join(dataDir, 'boards'), { recursive: true })
  await writeFile(file, JSON.stringify({ format: 'dsh-cockpit.board', version: 1, key: 'hand', revision: 3, tasks: [{ item: '1', what: 'by hand', status: 'dropped', startWhen: 'never' }] }))
  assert.equal((await readBoard(file)).tasks[0].what, 'by hand')
  const board = await readBoard('hand', dataDir)
  assert.equal(boardTree(board).flags.length, 0)
  assert.match(boardTree(board).tree, /^1 +dropped +by hand$/)
})

test('a miss names the folder and where DSH_HOME came from', async () => {
  const { home, dataDir } = await setup()
  const run = (env) => execFileSync(process.execPath, ['--input-type=module', '-e',
    `import('${readerUrl}').then(r=>r.readBoard('sim-883')).catch(e=>console.log(e.code+' '+e.message))`],
  { env, encoding: 'utf8' }).trim()
  assert.equal(run({ DSH_HOME: home }), `board_unknown no board "sim-883" in ${dataDir} (from DSH_HOME=${home})`)
  const fakeHome = join(home, 'user')
  assert.equal(run({ HOME: fakeHome }), `board_unknown no board "sim-883" in ${join(fakeHome, '.dsh', 'data', 'dsh-cockpit')} (DSH_HOME unset: ~/.dsh)`)
  await assert.rejects(readBoard('sim-883', dataDir), { code: 'board_unknown', message: `no board "sim-883" in ${dataDir} (from the dir argument)` })
  await assert.rejects(readBoard(join(dataDir, 'nope.json')), { code: 'board_unknown', message: `no board file ${join(dataDir, 'nope.json')}` })
})

test('dataDirSource: a blank DSH_HOME is unset; ~ expands', () => {
  assert.deepEqual(dataDirSource({ DSH_HOME: '  ' }), { dir: join(homedir(), '.dsh', 'data', 'dsh-cockpit'), source: 'DSH_HOME unset: ~/.dsh' })
  assert.deepEqual(dataDirSource({ DSH_HOME: '~/h' }), { dir: join(homedir(), 'h', 'data', 'dsh-cockpit'), source: 'from DSH_HOME=~/h' })
})

test('listBoards: no folder is no boards; temp files are skipped', async () => {
  const { dataDir } = await setup()
  assert.deepEqual(await listBoards(dataDir), [])
  await mkdir(join(dataDir, 'boards'), { recursive: true })
  await writeFile(join(dataDir, 'boards', '.k.json.1.x.tmp'), '')
  await writeFile(join(dataDir, 'boards', 'b%2Fc.json'), '{}')
  assert.deepEqual(await listBoards(dataDir), ['b/c'])
})

test('unknown version is an error', async () => {
  const { dataDir } = await setup()
  await mkdir(join(dataDir, 'boards'), { recursive: true })
  await writeFile(join(dataDir, 'boards', 'v9.json'), JSON.stringify({ format: 'dsh-cockpit.board', version: 9, tasks: [] }))
  await assert.rejects(readBoard('v9', dataDir), { code: 'board_unreadable', message: /unknown version 9/ })
})
