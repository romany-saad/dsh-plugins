// examples/board-drift-gh.sh against a stub gh placed first on PATH: the
// stub answers gh pr view from a table and logs its arguments. No network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec, setup, t } from './helpers.mjs'

const script = fileURLToPath(new URL('../examples/board-drift-gh.sh', import.meta.url))

// The stub: "gh pr view <ref> [-R repo] --json state --jq .state". The state
// comes from STATES ("<ref>[@repo]=<STATE>" lines); a ref not in it fails.
const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_LOG"
[ "$1 $2" = "pr view" ] || { echo "stub gh: unexpected $*" >&2; exit 2; }
ref=$3; repo=
[ "$4" = -R ] && repo=@$5
while IFS='=' read -r k v; do
  [ "$k" = "$ref$repo" ] && { echo "$v"; exit 0; }
done <<<"$STATES"
echo "GraphQL: Could not resolve to a PullRequest ($ref$repo)" >&2
exit 1
`

async function stubGh(home, states) {
  const bin = join(home, 'bin')
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'gh'), STUB)
  await chmod(join(bin, 'gh'), 0o755)
  const log = join(home, 'gh.log')
  await writeFile(log, '')
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, GH_LOG: log, STATES: Object.entries(states).map(([k, v]) => k + '=' + v).join('\n') }
  return { env, log }
}

const STATES = {
  '901': 'MERGED',
  '902@o/r': 'MERGED',
  '903': 'OPEN',
  'https://github.com/o/r/pull/905': 'MERGED',
}

const tasks = [
  t('1', 'waiting', 'merged, short', { pr: '#901' }),
  t('2', 'waiting', 'merged, other repo', { pr: 'o/r#902' }),
  t('3', 'now', 'open', { pr: '903' }),
  t('4', 'waiting', 'gh fails', { pr: '#904' }),
  t('5', 'next', 'merged, URL', { pr: 'https://github.com/o/r/pull/905' }),
  t('6', 'done', 'no pr'),
  t('7', 'done', 'closed: not asked', { pr: '#901' }),
  t('8', 'dropped', 'dropped: not asked', { pr: '#901' }),
]

const run = (env, board) => spawnSync('bash', [script], { env, input: JSON.stringify(board), encoding: 'utf8' })

test('the example reports done for each merged PR of an open task, asks gh once per pr, and skips what gh cannot read', async () => {
  const s = await setup()
  const { env, log } = await stubGh(s.home, STATES)
  const r = execFileSync('bash', [script], { env, input: JSON.stringify({ tasks }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  assert.deepEqual(JSON.parse(r), { items: [
    { item: '1', status: 'done', note: '#901 merged' },
    { item: '2', status: 'done', note: 'o/r#902 merged' },
    { item: '5', status: 'done', note: 'https://github.com/o/r/pull/905 merged' },
  ] })
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), [
    'pr view 901 --json state --jq .state',
    'pr view 902 -R o/r --json state --jq .state',
    'pr view 903 --json state --jq .state',
    'pr view 904 --json state --jq .state',
    'pr view https://github.com/o/r/pull/905 --json state --jq .state',
  ])
})

test('no task with a pr: an empty items list, and gh is not asked', async () => {
  const s = await setup()
  const { env, log } = await stubGh(s.home, STATES)
  const r = execFileSync('bash', [script], { env, input: JSON.stringify({ tasks: [t('1', 'next', 'x'), t('2', 'next', 'y', { pr: '' })] }), encoding: 'utf8' })
  assert.deepEqual(JSON.parse(r), { items: [] })
  assert.equal(await readFile(log, 'utf8'), '')
})

test('an item or pr with backslashes, tabs or quotes comes back as stored', async () => {
  const s = await setup()
  const item = 'a\\b\tc "d"'
  const { env } = await stubGh(s.home, { '901': 'MERGED' })
  const r = run(env, { tasks: [t(item, 'waiting', 'x', { pr: '#901' })] })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout).items, [{ item, status: 'done', note: '#901 merged' }])
})

test('gh or jq missing, or gh reading no PR at all, fails the check instead of reporting nothing', async () => {
  const s = await setup()
  const { env } = await stubGh(s.home, {})
  const failed = run(env, { tasks })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /gh could read none of the 5 PRs/)
  // A PATH with bash but neither gh nor jq.
  const bin = join(s.home, 'bare')
  await mkdir(bin)
  const { symlink } = await import('node:fs/promises')
  await symlink(execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim(), join(bin, 'bash'))
  const bare = spawnSync(join(bin, 'bash'), [script], { env: { PATH: bin }, input: '{"tasks":[]}', encoding: 'utf8' })
  assert.equal(bare.status, 127)
  assert.match(bare.stderr, /gh is not on PATH/)
})

test('as the configured drift command: board_read({ checkDrift }) keeps only the differences', async () => {
  const s = await setup()
  const { env } = await stubGh(s.home, STATES)
  const d = await setup({ home: s.home, env, config: { drift: { command: `bash "${script}"` } } })
  await d.tools.board_open({ key: 'gh' }, exec())
  for (const task of tasks) await d.tools.board_add(task, exec())
  const r = await d.tools.board_read({ checkDrift: true }, exec())
  assert.equal(r.driftCheck, 'ran')
  assert.equal(r.drift.checked, 3)
  assert.deepEqual(r.drift.items.map((e) => [e.item, e.status]), [['1', 'done'], ['2', 'done'], ['5', 'done']])
  assert.match(r.tree, /merged, short +reported: done/)
})
