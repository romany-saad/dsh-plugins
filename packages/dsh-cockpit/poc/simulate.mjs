#!/usr/bin/env node
// Step-driven simulation of /tmp/cockpit-design/hub-asks.md, scenarios A to F.
// Each invocation plays ONE ask as the tool calls a hub would make, prints
// them, checks the ask's Pass line, and prints the tree. State lives in
// $DSH_HOME (default /tmp/cockpit-poc-home), so a live profile on the same
// home shares the board file.
//
//   node poc/simulate.mjs list      the asks, their prerequisites, and which ran
//   node poc/simulate.mjs A1        run one ask
//   node poc/simulate.mjs reset     delete the sim-883 board and the sim's state
//   node poc/simulate.mjs all       reset, then every ask in order (for testing)
//
// It calls the plugin's tool bodies (lib/tools.js) directly, without DSH.
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../lib/config.js'
import { bindingFile, createStore } from '../lib/store.js'
import { createBoardTools } from '../lib/tools.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const HOME = resolve(process.env.DSH_HOME?.trim() || '/tmp/cockpit-poc-home')
const DATA = join(HOME, 'data', 'dsh-cockpit')
const STATE_FILE = join(HOME, 'data', 'dsh-cockpit-sim', 'state.json')
const KEY = 'sim-883'
const PARENT = 'Romany-Saad/resturants-app#883'
const DRIFT_COMMAND = `"${process.execPath}" "${join(HERE, 'drift-fixture.mjs')}"`
const SESSIONS = ['sim-hub-1', 'sim-hub-2']

// ---------------------------------------------------------------- state
async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')) } catch { return { ran: {}, session: SESSIONS[0] } }
}
async function saveState(state) {
  await mkdir(join(STATE_FILE, '..'), { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
}

// ---------------------------------------------------------------- a hub's step
function makeStep(state, { drift = '' } = {}) {
  const store = createStore({ dataDir: DATA })
  const tools = createBoardTools({ store, config: resolveConfig({ drift: { command: drift, mode: 'report' } }), dshHome: HOME })
  const calls = []
  const checks = []
  const notes = []
  const call = async (name, args = {}) => {
    const result = await tools[name](args, { agent: { session: { id: state.session } }, signal: new AbortController().signal })
    calls.push({ name, args, result })
    return result
  }
  const check = (label, cond) => { checks.push({ label, pass: !!cond }) }
  const note = (text) => notes.push(text)
  const read = async () => (await call('board_read', {}))
  const itemOf = async (issue) => {
    const board = await store.read(KEY)
    return board?.tasks.find((t) => t.issue === issue)?.item
  }
  return { store, tools, call, check, note, read, itemOf, calls, checks, notes }
}

const summary = (r) => {
  if (!r.ok) return `err ${r.code}: ${r.message}`
  const parts = ['ok']
  if ('created' in r) parts.push(`created=${r.created}`)
  if ('task' in r) parts.push(r.task ? `task ${r.task.item} ${r.task.status}` : 'task null (removed)')
  if (r.revision !== undefined) parts.push(`revision ${r.revision}`)
  if (r.board) parts.push(`revision ${r.board.revision}, ${r.tasks.length} task(s)`)
  if (r.driftCheck) parts.push(`driftCheck=${r.driftCheck}`)
  if (r.flags?.length) parts.push('flags ' + r.flags.map((f) => `${f.item}:${f.code}:${f.ref}`).join(' '))
  return parts.join(', ')
}

// ---------------------------------------------------------------- the asks
const FIVE = [
  ['#884', 'profile and guard'],
  ['#888', 'log reader'],
  ['#885', 'work reports'],
  ['#886', 'nightcost'],
  ['#887', 'live checks and docs'],
]
const SIX_B = { item: '6b', what: 'board rule in Bosla', status: 'next', extra: { startWhen: 'dsh-cockpit 0.1 is released' } }

const ASKS = [
  { id: 'A1', needs: [], ask: 'Open a board for the #883 effort, key sim-883, parent Romany-Saad/resturants-app#883.', async run(s) {
    const r = await s.call('board_open', { key: KEY, parent: PARENT })
    const file = JSON.parse(await readFile(s.store.file(KEY), 'utf8'))
    s.check('board_open with key and parent', r.ok && r.board.key === KEY && r.board.parent === PARENT)
    s.check('created: true', r.created === true)
    s.check('file exists, version 1, no tasks', file.version === 1 && file.tasks.length === 0)
  } },
  { id: 'A2', needs: ['A1'], ask: 'Add the five steps of #883 as tasks (#885, #886 after #888; #887 after #884, #885). All next.', async run(s) {
    const items = {}
    for (const [issue, what] of FIVE) {
      const dependsOn = { '#885': ['#888'], '#886': ['#888'], '#887': ['#884', '#885'] }[issue]?.map((i) => items[i])
      const r = await s.call('board_add', { what, issue, status: 'next', ...(dependsOn ? { dependsOn } : {}) })
      if (r.ok) items[issue] = r.task.item
    }
    const b = await s.read()
    s.check('five tasks with plugin-assigned ids', b.tasks.length === 5 && Object.keys(items).length === 5)
    const t = (i) => b.tasks.find((x) => x.issue === i)
    s.check('dependsOn by item id, not issue number',
      JSON.stringify(t('#885').dependsOn) === JSON.stringify([items['#888']]) &&
      JSON.stringify(t('#887').dependsOn) === JSON.stringify([items['#884'], items['#885']]))
    s.check('five roots (the hub adds #883 itself in A3)', b.tree.split('\n').every((l) => !l.startsWith(' ')))
    s.check('no flags', b.flags.length === 0)
  } },
  { id: 'A3', needs: ['A2'], ask: 'Put all of them under one root task for #883 itself.', async run(s) {
    const root = await s.call('board_add', { item: '0', what: 'DSH hub effort', issue: '#883', status: 'now' })
    for (const [issue] of FIVE) await s.call('board_update', { item: await s.itemOf(issue), set: { parent: root.task.item } })
    s.note('No batch update: one board_update per task (5 calls, 5 revisions).')
    s.note('The root needs an item id; the hub chose "0" so the five keep 1-5 (a root added without item gets 6).')
    const b = await s.read()
    s.check('a root task for #883', b.tasks.some((t) => t.issue === '#883' && t.parent === undefined))
    s.check('the five have parent = its item', FIVE.every(([i]) => b.tasks.find((t) => t.issue === i).parent === '0'))
    s.check('drawn indented under it', b.tree.split('\n').slice(1).every((l) => /^[├└]─ /.test(l)))
  } },
  { id: 'A4', needs: ['A3'], ask: 'Add step 6b, the board rule in Bosla, under #883, depending on #887. Start condition: dsh-cockpit 0.1 released.', async run(s) {
    const r = await s.call('board_add', { ...SIX_B, parent: '0', dependsOn: [await s.itemOf('#887')] })
    s.note('No start-condition field: kept in extra.startWhen. It is in board_read\'s tasks, but not in the tree text.')
    s.check('parent and dependsOn = #887\'s item', r.ok && r.task.parent === '0' && r.task.dependsOn[0] === await s.itemOf('#887'))
    s.check('start condition kept (extra.startWhen)', r.task?.extra?.startWhen === SIX_B.extra.startWhen)
  } },
  { id: 'A5', needs: ['A1'], ask: 'Show me the board.', readOnly: true, async run(s) {
    const b = await s.read()
    const file = JSON.parse(await readFile(s.store.file(KEY), 'utf8'))
    s.check('board_read returns the tree', b.ok && typeof b.tree === 'string')
    s.check('matches the file', JSON.stringify(b.tasks) === JSON.stringify(file.tasks))
  } },
  { id: 'B1', needs: ['A2'], ask: "#888's builder started, on claude-opus-5-5 at high, in worktree .claude/worktrees/agent-888-dshlog, branch agent/888-dshlog.", async run(s) {
    const set = { status: 'now', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', worktree: '.claude/worktrees/agent-888-dshlog', branch: 'agent/888-dshlog' }
    const r = await s.call('board_update', { item: await s.itemOf('#888'), set })
    s.note('The ask names no provider: the hub guessed "claude".')
    s.check('#888 now with provider, model, effort, worktree, branch', r.ok && Object.entries(set).every(([k, v]) => r.task[k] === v))
  } },
  { id: 'B2', needs: ['B1'], ask: "#888 opened PR #889; it's waiting for my merge. The command is gh pr merge 889 --squash --match-head-commit 680b4315.", async run(s) {
    const cmd = 'gh pr merge 889 --squash --match-head-commit 680b4315'
    const r = await s.call('board_update', { item: await s.itemOf('#888'), set: { status: 'waiting', pr: '#889', readyCommand: cmd, nextAction: 'owner merges #889' } })
    s.check('#888 waiting, pr #889', r.ok && r.task.status === 'waiting' && r.task.pr === '#889')
    s.check('readyCommand holds the exact command', r.task?.readyCommand === cmd)
    s.check('nextAction says who acts', /owner/.test(r.task?.nextAction ?? ''))
  } },
  { id: 'B3', needs: ['B2'], ask: "What's waiting on me?", readOnly: true, async run(s) {
    const r = await s.call('board_read', { status: ['waiting'] })
    const mine = r.tasks.filter((t) => /owner/i.test(t.nextAction ?? ''))
    s.note('No "waiting on whom" field: status waiting covers the owner, a reviewer and a builder alike; the hub filtered nextAction for "owner".')
    for (const t of mine) s.note(`hub lists: ${t.item} ${t.what} (${t.pr ?? ''}) → ${t.readyCommand ?? '(no ready command)'}`)
    s.check('#888 listed with its ready command', mine.some((t) => t.issue === '#888' && t.readyCommand))
    s.check('nothing else', mine.length === 1)
  } },
  { id: 'B4', needs: ['B2'], ask: 'I merged #889.', async run(s) {
    const i888 = await s.itemOf('#888')
    await s.call('board_update', { item: i888, set: { status: 'done', readyCommand: null, nextAction: null } })
    const b = await s.read()
    const done = new Set(b.tasks.filter((t) => t.status === 'done').map((t) => t.item))
    const unblocked = b.tasks.filter((t) => t.status === 'next' && t.dependsOn?.includes(i888) && t.dependsOn.every((d) => done.has(d)))
    s.note('The hub derives "unblocked" itself from dependsOn; the read has no ready/blocked view.')
    s.note('hub says: now unblocked: ' + unblocked.map((t) => `${t.item} (${t.issue})`).join(', '))
    s.check('#888 done', b.tasks.find((t) => t.item === i888).status === 'done')
    s.check('#885 and #886 named unblocked', unblocked.map((t) => t.issue).sort().join() === '#885,#886')
    s.check('they stay next', unblocked.every((t) => t.status === 'next'))
  } },
  { id: 'B5', needs: ['B4'], ask: 'Start #885 and #886 at once: both at high, each in its own worktree.', async run(s) {
    for (const [issue, n] of [['#885', 885], ['#886', 886]]) {
      await s.call('board_update', { item: await s.itemOf(issue), set: { status: 'now', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', worktree: `.claude/worktrees/agent-${n}`, branch: `agent/${n}` } })
    }
    s.note('The ask names no model: the hub reused #888\'s (claude-opus-5-5).')
    const b = await s.read()
    const two = b.tasks.filter((t) => ['#885', '#886'].includes(t.issue))
    s.check('both now', two.every((t) => t.status === 'now'))
    s.check('own worktree, model and effort each', new Set(two.map((t) => t.worktree)).size === 2 && two.every((t) => t.model && t.effort))
  } },
  { id: 'B6', needs: ['A2'], ask: "#884's builder hit a blocker that needs my decision: background jobs leave no pitfall line.", async run(s) {
    const r = await s.call('board_update', { item: await s.itemOf('#884'), set: { status: 'waiting', why: 'blocker: background jobs leave no pitfall line', nextAction: 'owner decides how background jobs leave a pitfall line' } })
    s.check('#884 waiting', r.ok && r.task.status === 'waiting')
    s.check('nextAction names the decision', /owner decides/.test(r.task.nextAction))
    s.check('why holds the blocker', /pitfall line/.test(r.task.why))
  } },
  { id: 'C1', needs: ['A1'], ask: '(restart) Continue the #883 effort.', async run(s, state) {
    // This process is already a fresh plugin instance. First the old session,
    // which finds its board through sessions/<id>.json, then a new session.
    const before = state.lastBoard
    const viaBinding = await s.call('board_read', {})
    state.preRestartTree = before?.tree
    state.session = SESSIONS[1]
    const r = await s.call('board_open', { key: KEY })
    s.note('The old session needs no board_open (binding file); a new session must name the key, which the hub has to know.')
    s.check('old session: binding finds the board', viaBinding.ok)
    s.check('new session: board_open, created false', r.ok && r.created === false)
    s.check('same tasks and statuses as before the restart', before && JSON.stringify(r.tasks) === JSON.stringify(before.tasks))
  } },
  { id: 'C2', needs: ['C1'], ask: 'Show me the board as a tree.', readOnly: true, async run(s, state) {
    const r = await s.read()
    s.check('identical to the last tree before the restart', r.tree === state.preRestartTree)
  } },
  { id: 'D1', needs: ['A2'], ask: "Make #887 also depend on a step called 'release notes' that isn't on the board.", async run(s) {
    const item = await s.itemOf('#887')
    const t = (await s.read()).tasks.find((x) => x.item === item)
    const r = await s.call('board_update', { item, set: { dependsOn: [...(t.dependsOn ?? []), 'release notes'] } })
    s.note('set replaces the whole dependsOn array: the hub read it and restated it to "also" add one.')
    s.check('stored', r.ok && r.task.dependsOn.includes('release notes'))
    s.check('unknown-dependency flag', r.flags.some((f) => f.code === 'unknown_dependency' && f.ref === 'release notes'))
  } },
  { id: 'D2', needs: ['A3'], ask: "Make #885's parent #886, and #886's parent #885.", async run(s, state) {
    const a = await s.itemOf('#885')
    const b = await s.itemOf('#886')
    const before = (await s.read()).tasks
    state.parentsBeforeLoop = Object.fromEntries([a, b].map((i) => [i, before.find((t) => t.item === i).parent ?? null]))
    await s.call('board_update', { item: a, set: { parent: b } })
    const r = await s.call('board_update', { item: b, set: { parent: a } })
    const read = await s.read()
    const roots = read.tree.split('\n').filter((l) => !l.startsWith(' ')).map((l) => l.split(/\s+/)[0])
    s.note('Undo (D2b) needs the earlier parents; the board keeps no history, so the hub must remember them.')
    s.check('stored, nothing refused', r.ok)
    s.check('parent loop flagged on both', [a, b].every((i) => read.flags.some((f) => f.item === i && f.code === 'parent_loop')))
    s.check('both drawn as roots', roots.includes(a) && roots.includes(b))
    s.check('nothing lost', read.tasks.length === before.length && read.tree.split('\n').length === before.length)
  } },
  { id: 'D2b', needs: ['D2'], ask: 'Undo that.', async run(s, state) {
    for (const [item, parent] of Object.entries(state.parentsBeforeLoop)) await s.call('board_update', { item, set: { parent } })
    const r = await s.read()
    s.check('parents restored', Object.entries(state.parentsBeforeLoop).every(([i, p]) => (r.tasks.find((t) => t.item === i).parent ?? null) === p))
    s.check('no loop flags', !r.flags.some((f) => f.code === 'parent_loop'))
  } },
  { id: 'D3', needs: ['A2'], ask: 'Add #885 again.', readOnly: true, async run(s) {
    const before = (await s.read()).tasks.length
    const r = await s.call('board_add', { item: await s.itemOf('#885'), what: 'work reports', issue: '#885' })
    s.note('item_exists only fires when the hub passes the item. Without one, the plugin would add a second #885 under a new integer: duplicate issue references are not flagged.')
    s.check('item_exists', r.code === 'item_exists')
    s.check('no duplicate task', (await s.read()).tasks.length === before)
  } },
  { id: 'D4', needs: ['A1'], ask: 'Update a task called 99.', readOnly: true, async run(s) {
    const before = (await s.read()).tasks.length
    const r = await s.call('board_update', { item: '99', set: { status: 'now' } })
    s.check('item_unknown', r.code === 'item_unknown')
    s.check('no task invented', (await s.read()).tasks.length === before)
  } },
  { id: 'D5', needs: ['A4'], ask: 'Delete step 6b.', async run(s, state) {
    const saved = (await s.read()).tasks.find((t) => t.item === '6b')
    state.removed6b = saved
    const r = await s.call('board_update', { item: '6b', remove: true })
    s.note('A removal returns task: null; the hub kept the fields from its earlier read to re-add them (D5b).')
    s.check('removed', r.ok && r.task === null && !(await s.read()).tasks.some((t) => t.item === '6b'))
  } },
  { id: 'D5b', needs: ['D5'], ask: 'Add it back as before.', async run(s, state) {
    const { updatedAt, ...fields } = state.removed6b
    const r = await s.call('board_add', fields)
    const { updatedAt: _, ...now } = r.task ?? {}
    s.check('re-added with the same fields', r.ok && JSON.stringify(now) === JSON.stringify(fields))
  } },
  { id: 'E1', needs: ['A2'], drift: DRIFT_COMMAND, ask: '(drift.command = poc/drift-fixture.mjs) Check whether the board matches reality.', async run(s) {
    const item = await s.itemOf('#886')
    const before = (await s.store.read(KEY)).tasks.find((t) => t.item === item).status
    const r = await s.call('board_read', { checkDrift: true })
    const entry = r.drift?.items.find((e) => e.item === item)
    s.note(`hub proposes: set ${item} (#886) to done, because "${entry?.note}"`)
    s.check('drift ran', r.driftCheck === 'ran')
    s.check('#886 differs', entry?.differs === true)
    s.check('report mode: task unchanged', r.tasks.find((t) => t.item === item).status === before && before !== 'done')
  } },
  { id: 'E2', needs: ['E1'], drift: DRIFT_COMMAND, ask: 'Apply what drift found.', async run(s) {
    const item = await s.itemOf('#886')
    await s.call('board_update', { item, set: { status: 'done', pr: '#891' } })
    const r = await s.call('board_read', { checkDrift: true })
    s.check('#886 done through board_update', r.tasks.find((t) => t.item === item).status === 'done')
    s.check('next drift check: no difference', r.drift.items.every((e) => !e.differs))
  } },
  { id: 'E3', needs: ['A1'], ask: '(drift.command empty) Check drift.', readOnly: true, async run(s) {
    const r = await s.call('board_read', { checkDrift: true })
    s.note('The read says driftCheck: not_configured, so the hub can say so; the last stored drift result still comes back as drift.')
    s.check('no drift check configured, nothing ran', r.driftCheck === 'not_configured')
  } },
  { id: 'F1', needs: ['A1'], ask: '(plain shell) Run the reader one-liner.', readOnly: true, async run(s, state) {
    const reader = new URL('../reader.js', import.meta.url).href
    const out = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import('${reader}').then(r=>r.readBoard('${KEY}').then(b=>console.log(r.boardTree(b).tree)))`],
    { env: { DSH_HOME: HOME, PATH: process.env.PATH }, encoding: 'utf8' }).trimEnd()
    s.calls.push({ name: 'reader (separate node process)', args: { DSH_HOME: HOME }, result: { ok: true } })
    s.note('The asks file\'s one-liner prints boardTree(b), an object { tree, flags }; it needs .tree for the text.')
    s.check('same tree as the last read', out === state.lastBoard?.tree)
  } },
  { id: 'F2', needs: ['A1'], ask: "We're done with #883. Close the board out.", async run(s) {
    const open = (await s.read()).tasks.filter((t) => t.status !== 'done')
    s.note('hub would ask about: ' + (open.map((t) => `${t.item} (${t.status})`).join(', ') || 'nothing'))
    for (const t of open) await s.call('board_update', { item: t.item, set: { status: 'done' } })
    const r = await s.read()
    s.check('every task done', r.tasks.every((t) => t.status === 'done'))
    s.check('board file stays', existsSync(s.store.file(KEY)))
  } },
]

// ---------------------------------------------------------------- runner
async function runAsk(ask, { quiet = false } = {}) {
  const state = await loadState()
  const missing = ask.needs.filter((id) => !state.ran[id])
  if (missing.length) {
    console.log(`${ask.id}: run ${missing.join(', ')} first.`)
    return false
  }
  if (state.ran[ask.id] && !ask.readOnly) {
    console.log(`${ask.id} ran already (${state.ran[ask.id].at}); it changes the board, so it does not run twice. reset starts over.`)
    return false
  }
  const s = makeStep(state, { drift: ask.drift ?? '' })
  console.log(`\n== ${ask.id}  ${ask.ask}`)
  try {
    await ask.run(s, state)
  } catch (error) {
    s.check(`no exception (${error.message})`, false)
  }
  for (const c of s.calls) console.log(`  → ${c.name} ${JSON.stringify(c.args)}\n    ← ${summary(c.result)}`)
  for (const n of s.notes) console.log(`  · ${n}`)
  for (const c of s.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}`)
  const pass = s.checks.every((c) => c.pass)
  console.log(`  ${ask.id}: ${pass ? 'PASS' : 'FAIL'}`)
  const board = await s.store.read(KEY).catch(() => undefined)
  if (board) {
    const { boardTree } = await import('../lib/tree.js')
    const { tree, flags } = boardTree(board)
    if (!quiet) console.log('\n' + tree.split('\n').map((l) => '    ' + l).join('\n'))
    state.lastBoard = { tasks: board.tasks, tree, flags }
  }
  state.ran[ask.id] = { at: new Date().toISOString(), pass }
  await saveState(state)
  return pass
}

async function reset() {
  await rm(join(DATA, 'boards', `${KEY}.json`), { force: true })
  for (const id of SESSIONS) await rm(bindingFile(DATA, id), { force: true })
  await rm(STATE_FILE, { force: true })
  console.log(`reset: removed board ${KEY}, the sim sessions' bindings and the sim state under ${HOME}`)
}

const arg = process.argv[2]
if (!arg || arg === 'list') {
  const state = await loadState()
  console.log(`DSH_HOME=${HOME}  board ${join(DATA, 'boards', KEY + '.json')}`)
  for (const a of ASKS) {
    const r = state.ran[a.id]
    console.log(`  ${a.id.padEnd(4)} ${(r ? (r.pass ? 'ran, pass' : 'ran, FAIL') : 'not run').padEnd(10)} ${a.needs.length ? ('needs ' + a.needs.join(',')).padEnd(12) : ''.padEnd(12)} ${a.ask}`)
  }
} else if (arg === 'reset') {
  await reset()
} else if (arg === 'all') {
  await reset()
  const results = []
  for (const a of ASKS) results.push([a.id, await runAsk(a)])
  console.log('\n' + results.map(([id, p]) => `${id} ${p ? 'pass' : 'FAIL'}`).join('  '))
  process.exitCode = results.every(([, p]) => p) ? 0 : 1
} else {
  const ask = ASKS.find((a) => a.id.toLowerCase() === arg.toLowerCase())
  if (!ask) {
    console.log(`unknown ask ${arg}; try: list`)
    process.exitCode = 2
  } else if (!(await runAsk(ask))) process.exitCode = 1
}
