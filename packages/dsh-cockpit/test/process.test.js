import test from 'node:test'
import assert from 'node:assert/strict'
import { createProcessStore, validateProcess, PROCESS_PATH, PROCESS_FORMAT } from '../lib/process.js'

const draft = () => ({ kinds: ['feature', 'fix'], stages: [{ id: 'build', exitCheck: 'tests pass', skills: ['dev'], who: 'agent', kinds: ['feature'], when: 'needed', skipIf: 'trivial', readyCommand: 'review {item}' }], sources: [{ path: 'AGENTS.md', hash: 'sha256:' + 'a'.repeat(64) }] })
const codec = { parse: JSON.parse, stringify: (x) => JSON.stringify(x, null, 2) + '\n' } // JSON is YAML 1.2
function fixture(initial = null) {
  let content = initial, version = 0, writes = 0
  const adapter = {
    async read(path) { assert.equal(path, PROCESS_PATH); return { text: content, token: version } },
    async write(path, text, token) { assert.equal(path, PROCESS_PATH); if (token !== version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' }); content = text; version++; writes++ },
  }
  return { store: createProcessStore({ adapter, codec }), change: (value) => { content = value; version++ }, writes: () => writes, content: () => content }
}

test('proposal is read-only; explicit approval saves and revisions advance', async () => {
  const f = fixture()
  assert.equal(await f.store.read(), undefined)
  const p = await f.store.propose(draft())
  assert.equal(p.next.revision, 1)
  await assert.rejects(f.store.save(p), { code: 'approval_required' })
  assert.equal(f.writes(), 0)
  assert.equal((await f.store.save(p, { approved: true })).format, PROCESS_FORMAT)
  assert.deepEqual(await f.store.read(), p.next)
  await assert.rejects(f.store.save(p, { approved: true }), { code: 'invalid_proposal' })
  const p2 = await f.store.propose(draft())
  assert.equal(p2.next.revision, 2)
  assert.deepEqual(p2.current, p.next)
})

test('stale and concurrently created files cannot be clobbered', async () => {
  const f = fixture()
  const p = await f.store.propose(draft())
  f.change('other writer')
  await assert.rejects(f.store.save(p, { approved: true }), { code: 'FS_STALE_VERSION' })
  assert.equal(f.content(), 'other writer')
  assert.equal(f.writes(), 0)
})

test('proposal mutation, invalid file, and invalid drafts never write', async () => {
  const f = fixture()
  const p = await f.store.propose(draft())
  p.next.stages[0].exitCheck = 'changed'
  await assert.rejects(f.store.save(p, { approved: true }), { code: 'invalid_proposal' })
  await assert.rejects(f.store.propose({ ...draft(), kinds: [] }), { code: 'invalid_process' })
  f.change('{')
  await assert.rejects(f.store.propose(draft()), { code: 'process_unreadable' })
  assert.equal(f.writes(), 0)
})

test('schema rejects unknown fields, invalid references, duplicate ids and unsafe sources', () => {
  const valid = { ...draft(), format: PROCESS_FORMAT, version: 1, revision: 1 }
  assert.deepEqual(validateProcess(valid), valid)
  const cases = [
    { ...valid, version: 2 }, { ...valid, revision: 0 }, { ...valid, extra: true },
    { ...valid, stages: [...valid.stages, valid.stages[0]] },
    { ...valid, stages: [{ ...valid.stages[0], kinds: ['unknown'] }] },
    { ...valid, stages: [{ ...valid.stages[0], who: 'robot' }] },
    { ...valid, sources: [{ ...valid.sources[0], path: '../secret' }] },
    { ...valid, sources: [{ ...valid.sources[0], hash: 'fake' }] },
  ]
  for (const value of cases) assert.throws(() => validateProcess(value), { code: 'invalid_process' })
})
