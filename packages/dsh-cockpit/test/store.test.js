import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { boardFile, writeJsonAtomic } from '../lib/store.js'
import { setup } from './helpers.mjs'

test('keys stay inside boards/', async () => {
  const { dataDir } = await setup()
  for (const key of ['../x', 'a/b', 'CON', '..']) {
    const file = boardFile(dataDir, key)
    assert.equal(dirname(file), join(dataDir, 'boards'), key)
  }
})

test('unparseable or unknown-version file: board_unreadable, bytes unchanged', async () => {
  const { tools, store, exec } = await setup()
  for (const [key, text] of [['bad', '{not json'], ['newer', JSON.stringify({ format: 'dsh-cockpit.board', version: 2, tasks: [] })]]) {
    await mkdir(dirname(store.file(key)), { recursive: true })
    await writeFile(store.file(key), text)
    const r = await tools.board_open({ key, parent: 'p' }, exec())
    assert.equal(r.ok, false)
    assert.equal(r.code, 'board_unreadable')
    assert.equal(await readFile(store.file(key), 'utf8'), text)
  }
})

test('a leftover temp file is removed on the next write; the old file survives a crash', async () => {
  const { dataDir } = await setup()
  const file = join(dataDir, 'boards', 'k.json')
  await writeJsonAtomic(file, { a: 1 })
  // Simulate a crash after the temp write, before the rename.
  await writeFile(join(dataDir, 'boards', '.k.json.999.dead.tmp'), '{"a":2')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { a: 1 })
  await writeJsonAtomic(file, { a: 3 })
  assert.deepEqual(await readdir(join(dataDir, 'boards')), ['k.json'])
})

test('a filesystem error is write_failed and leaves the old file', async () => {
  const { tools, store, exec } = await setup()
  await tools.board_open({ key: 'k' }, exec())
  const before = await readFile(store.file('k'), 'utf8')
  const { chmod } = await import('node:fs/promises')
  await chmod(dirname(store.file('k')), 0o500)
  try {
    const r = await tools.board_add({ what: 'x' }, exec())
    if (process.getuid?.() === 0) return // root ignores permissions
    assert.equal(r.code, 'write_failed')
  } finally {
    await chmod(dirname(store.file('k')), 0o700)
  }
  assert.equal(await readFile(store.file('k'), 'utf8'), before)
})
