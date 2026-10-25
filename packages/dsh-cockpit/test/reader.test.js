import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listBoards, readBoard, boardTree } from '../reader.js'
import { setup } from './helpers.mjs'

const readerUrl = new URL('../reader.js', import.meta.url).href

test('a second process reads the last state through the reader alone', async () => {
  const { tools, exec, dataDir, home } = await setup()
  await tools.board_open({ key: 'a/b' }, exec())
  await tools.board_add({ what: 'x' }, exec())
  assert.deepEqual(await listBoards(dataDir), ['a/b'])
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import('${readerUrl}').then(async r=>{const b=await r.readBoard('a/b');console.log(r.boardTree(b).tree)})`],
  { env: { DSH_HOME: home }, encoding: 'utf8' })
  assert.match(out, /^1 +next +x/)
})

test('fallback: a board written without the plugin is read, then continued', async () => {
  const { tools, exec, dataDir } = await setup()
  const file = join(dataDir, 'boards', 'hand.json')
  await mkdir(join(dataDir, 'boards'), { recursive: true })
  await writeFile(file, JSON.stringify({ format: 'dsh-cockpit.board', version: 1, key: 'hand', revision: 3, tasks: [{ item: '1', what: 'by hand', status: 'now', updatedAt: 'x' }] }))
  assert.equal((await readBoard(file)).tasks[0].what, 'by hand')
  assert.equal(boardTree(await readBoard('hand', dataDir)).flags.length, 0)
  const r = await tools.board_open({ key: 'hand' }, exec())
  assert.equal(r.tasks.length, 1)
  assert.equal((await tools.board_add({ what: 'next' }, exec())).task.item, '2')
})

test('unknown version is an error', async () => {
  const { dataDir } = await setup()
  await mkdir(join(dataDir, 'boards'), { recursive: true })
  await writeFile(join(dataDir, 'boards', 'v9.json'), JSON.stringify({ format: 'dsh-cockpit.board', version: 9, tasks: [] }))
  await assert.rejects(readBoard('v9', dataDir), /unknown version/)
})
