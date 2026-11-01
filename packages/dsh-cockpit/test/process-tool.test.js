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


test('source drift: changing a recorded source file reports processDrift', async () => {
  const { tools } = await setup()
  const e = await freshExec('s1')
  const contribPath = join(e.cwd, 'CONTRIBUTING.md')
  await writeFile(contribPath, 'Original content', 'utf8')

  // Calculate actual hash
  const { createHash } = await import('node:crypto')
  const originalHash = 'sha256:' + createHash('sha256').update('Original content').digest('hex')

  const draft = {
    kinds: ['feature'],
    stages: [{ id: 'build', exitCheck: 'pass', skills: [], who: 'agent' }],
    sources: [{ path: 'CONTRIBUTING.md', hash: originalHash }],
  }
  const prop = await tools.board_process({ action: 'propose', map: draft }, e)
  await tools.board_process({ action: 'save', proposal: prop.proposal, approved: true }, e)

  // Before file changes: read reports no drift
  const r1 = await tools.board_process({ action: 'read' }, e)
  assert.equal(r1.processDrift, undefined)

  // Modify source file
  await writeFile(contribPath, 'Modified content! New rules added.', 'utf8')

  // Now read detects source drift
  const r2 = await tools.board_process({ action: 'read' }, e)
  assert.ok(r2.processDrift)
  assert.deepEqual(r2.processDrift.changed, ['CONTRIBUTING.md'])
  assert.match(r2.processDrift.message, /Process may be out of date: CONTRIBUTING\.md changed/)

  // board_open and board_read flag it too
  await tools.board_open({ key: 'drift-board' }, e)
  const bRead = await tools.board_read({}, e)
  assert.ok(bRead.processDrift)
  assert.match(bRead.tree, /Warning: Process may be out of date/)
})

test('diffProcess: propose computes stage addition, modification and reordering diff', async () => {
  const { tools } = await setup()
  const e = await freshExec('s1')

  const v1 = {
    kinds: ['feature'],
    stages: [
      { id: 'spec', exitCheck: 'spec done', skills: ['refine'], who: 'agent' },
      { id: 'build', exitCheck: 'tests pass', skills: [], who: 'agent' },
    ],
    sources: [{ path: 'README.md', hash: 'sha256:' + '1'.repeat(64) }],
  }
  const prop1 = await tools.board_process({ action: 'propose', map: v1 }, e)
  await tools.board_process({ action: 'save', proposal: prop1.proposal, approved: true }, e)

  // Now propose v2 with a new stage security-review before build, and updated build exit check
  const v2 = {
    kinds: ['feature', 'release'],
    stages: [
      { id: 'spec', exitCheck: 'spec done', skills: ['refine'], who: 'agent' },
      { id: 'security-review', exitCheck: 'audit clean', skills: ['audit-tool'], who: 'owner', readyCommand: 'audit' },
      { id: 'build', exitCheck: 'tests & linter pass', skills: [], who: 'agent' },
    ],
    sources: [{ path: 'README.md', hash: 'sha256:' + '1'.repeat(64) }],
  }
  const prop2 = await tools.board_process({ action: 'propose', map: v2 }, e)
  assert.equal(prop2.ok, true)
  assert.equal(prop2.proposal.next.revision, 2)
  assert.ok(prop2.diff.some(d => d.includes('Added stage security-review')))
  assert.ok(prop2.diff.some(d => d.includes('Modified stage build')))
  assert.ok(prop2.diff.some(d => d.includes('Kinds changed')))
})

test('adopt: adopts new process revision into open items, leaving done stages alone', async () => {
  const { tools } = await setup()
  const e = await freshExec('s1')
  await tools.board_open({ key: 'adopt-board' }, e)

  const v1 = {
    kinds: ['feature'],
    stages: [
      { id: 'spec', exitCheck: 'spec done', skills: [], who: 'agent' },
      { id: 'build', exitCheck: 'tests pass', skills: [], who: 'agent' },
      { id: 'pr', exitCheck: 'merged', skills: [], who: 'owner' },
    ],
    sources: [{ path: 'README.md', hash: 'sha256:' + '1'.repeat(64) }],
  }
  const p1 = await tools.board_process({ action: 'propose', map: v1 }, e)
  await tools.board_process({ action: 'save', proposal: p1.proposal, approved: true }, e)

  // Add tasks:
  // Item 1: in-progress feature. Stage 'spec' is already done!
  const flowTask1 = {
    what: 'In-progress feature',
    flow: {
      revision: 1,
      stages: [
        { id: 'spec', title: 'spec', status: 'done' },
        { id: 'build', title: 'build', status: 'now' },
        { id: 'pr', title: 'pr', status: 'next' },
      ],
      at: 'build',
      skipped: {},
    },
  }
  await tools.board_add(flowTask1, e)

  // Item 2: closed task (status: 'done')
  const closedTask = {
    what: 'Already completed work',
    status: 'done',
    flow: {
      revision: 1,
      stages: [
        { id: 'spec', title: 'spec', status: 'done' },
        { id: 'build', title: 'build', status: 'done' },
        { id: 'pr', title: 'pr', status: 'done' },
      ],
    },
  }
  await tools.board_add(closedTask, e)

  // Save new process map v2 with 'security-review' between build and pr
  const v2 = {
    kinds: ['feature'],
    stages: [
      { id: 'spec', exitCheck: 'spec done', skills: [], who: 'agent' },
      { id: 'build', exitCheck: 'tests pass', skills: [], who: 'agent' },
      { id: 'security-review', exitCheck: 'clean', skills: [], who: 'owner' },
      { id: 'pr', exitCheck: 'merged', skills: [], who: 'owner' },
    ],
    sources: [{ path: 'README.md', hash: 'sha256:' + '1'.repeat(64) }],
  }
  const p2 = await tools.board_process({ action: 'propose', map: v2 }, e)
  await tools.board_process({ action: 'save', proposal: p2.proposal, approved: true }, e)

  // Adopt new revision on the board
  const adoptRes = await tools.board_process({ action: 'adopt' }, e)
  assert.equal(adoptRes.ok, true)
  assert.equal(adoptRes.adopted, true)
  assert.equal(adoptRes.revision, 2)
  assert.deepEqual(adoptRes.items, ['1'], 'only open task 1 was updated, closed task 2 untouched')

  // Verify task 1 stages: 'spec' remains 'done', 'security-review' was inserted as 'next'!
  const b = await tools.board_read({}, e)
  const updatedTask1 = b.tasks.find(t => t.item === '1')
  assert.equal(updatedTask1.flow.revision, 2)
  const stageIds = updatedTask1.flow.stages.map(s => s.id)
  assert.deepEqual(stageIds, ['spec', 'build', 'security-review', 'pr'])
  assert.equal(updatedTask1.flow.stages.find(s => s.id === 'spec').status, 'done', 'done stage left alone')
  assert.equal(updatedTask1.flow.stages.find(s => s.id === 'security-review').status, 'next')

  // Closed task 2 remains at revision 1
  const task2 = b.tasks.find(t => t.item === '2')
  assert.equal(task2.flow.revision, 1)
})
