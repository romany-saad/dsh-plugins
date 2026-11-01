import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROCESS_PATH } from '../lib/process.js'
import { exec, setup, tempHome } from './helpers.mjs'

const freshExec = async (sessionId = 's1') => {
  const dir = await tempHome()
  return { agent: { session: { id: sessionId }, workingDirectory: dir }, cwd: dir, signal: new AbortController().signal }
}

test('board_process: read when file is absent returns exists: false, map: null', async () => {
  const { tools } = await setup()
  const e = await freshExec('s1')
  const r = await tools.board_process({ action: 'read' }, e)
  assert.equal(r.ok, true)
  assert.equal(r.exists, false)
  assert.equal(r.map, null)
  assert.equal(r.path, PROCESS_PATH)
})

test('board_process: propose validates draft without saving to disk', async () => {
  const { tools } = await setup()
  const e = await freshExec('s1')
  const draft = {
    kinds: ['feature', 'fix'],
    stages: [
      { id: 'design', exitCheck: 'spec approved', skills: ['cockpit-refine'], who: 'agent' },
      { id: 'build', exitCheck: 'tests green', skills: ['dsh-plugin-dev'], who: 'agent' },
      { id: 'merge', exitCheck: 'PR merged', skills: [], who: 'owner', readyCommand: 'gh pr merge' },
    ],
    sources: [
      { path: 'CONTRIBUTING.md', hash: 'sha256:' + 'a'.repeat(64) },
    ],
  }
  const prop = await tools.board_process({ action: 'propose', map: draft }, e)
  assert.equal(prop.ok, true)
  assert.equal(prop.proposal.next.revision, 1)
  assert.equal(prop.proposal.next.stages.length, 3)

  // Verify it did not write to disk
  const r = await tools.board_process({ action: 'read' }, e)
  assert.equal(r.exists, false)
})

test('board_process: save requires approved: true, saves YAML and bumps revision', async () => {
  const home = await tempHome()
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { tools, store } = await setup()
    const e = await freshExec('s1')
    await tools.board_open({ key: 'test-board' }, e)

    const draft = {
      kinds: ['feature'],
      stages: [
        { id: 'spec', exitCheck: 'done', skills: [], who: 'agent' },
        { id: 'ship', exitCheck: 'released', skills: [], who: 'owner' },
      ],
      sources: [
        { path: 'README.md', hash: 'sha256:' + '0'.repeat(64) },
      ],
    }

    // Refuses save without approved: true
    const unapproved = await tools.board_process({ action: 'save', map: draft }, e)
    assert.equal(unapproved.ok, false)
    assert.equal(unapproved.code, 'approval_required')

    // Propose then save
    const prop = await tools.board_process({ action: 'propose', map: draft }, e)
    assert.equal(prop.ok, true)

    const saved = await tools.board_process({ action: 'save', proposal: prop.proposal, approved: true }, e)
    assert.equal(saved.ok, true)
    assert.equal(saved.saved, true)
    assert.equal(saved.map.revision, 1)

    // Read back
    const readBack = await tools.board_process({ action: 'read' }, e)
    assert.equal(readBack.ok, true)
    assert.equal(readBack.exists, true)
    assert.equal(readBack.map.revision, 1)
    assert.deepEqual(readBack.map.kinds, ['feature'])

    // Board recorded process info
    const b = await tools.board_read({}, e)
    assert.equal(b.board.process?.revision, 1)
    assert.equal(b.board.process?.stagesCount, 2)
  } finally {
    if (prevHome !== undefined) process.env.DSH_HOME = prevHome
    else delete process.env.DSH_HOME
  }
})

test('flow validation: refuses expansion if skipped stage lacks a reason', async () => {
  const { tools } = await setup()
  const e = exec('s1')
  await tools.board_open({ key: 'b1' }, e)

  // Invalid flow: empty reason in skipped
  const badFlow1 = {
    revision: 1,
    stages: [
      { id: 'refine', title: 'Refine' },
      { id: 'build', title: 'Build' },
    ],
    skipped: { refine: '' },
  }
  const r1 = await tools.board_add({ what: 'Feature', flow: badFlow1 }, e)
  assert.equal(r1.ok, false)
  assert.equal(r1.code, 'invalid_input')
  assert.match(r1.message, /Skipped stage refine must have a non-empty reason/)

  // Unknown stage in skipped
  const badFlow2 = {
    revision: 1,
    stages: [{ id: 'build', title: 'Build' }],
    skipped: { unknownStage: 'not needed' },
  }
  const r2 = await tools.board_add({ what: 'Feature', flow: badFlow2 }, e)
  assert.equal(r2.ok, false)
  assert.equal(r2.code, 'invalid_input')
  assert.match(r2.message, /Unknown stage unknownStage in flow.skipped/)

  // Valid flow succeeds
  const goodFlow = {
    revision: 1,
    stages: [
      { id: 'refine', title: 'Refine' },
      { id: 'build', title: 'Build' },
      { id: 'docs', title: 'Docs' },
    ],
    at: 'build',
    skipped: { refine: 'already specified in issue' },
  }
  const r3 = await tools.board_add({ what: 'Feature', flow: goodFlow }, e)
  assert.equal(r3.ok, true)
  assert.equal(r3.task.flow.at, 'build')

  // Child with stage referencing parent flow
  const rChild = await tools.board_add({ what: 'Build implementation', parent: '1', stage: 'build' }, e)
  assert.equal(rChild.ok, true)
  assert.equal(rChild.task.stage, 'build')

  // Child with stage unknown to parent flow fails
  const rBadChild = await tools.board_add({ what: 'Invalid stage', parent: '1', stage: 'unknown' }, e)
  assert.equal(rBadChild.ok, false)
  assert.equal(rBadChild.code, 'invalid_input')
  assert.match(rBadChild.message, /Parent task 1 flow does not have stage "unknown"/)
})
