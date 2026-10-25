import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DEFAULT_CONFIG, linkOptions, resolveConfig } from '../lib/config.js'
import { boardRows, refUrl } from '../lib/rows.js'

test('defaults: tools and route on, no drift command, report mode, no link patterns', () => {
  assert.deepEqual(resolveConfig(), DEFAULT_CONFIG)
  assert.deepEqual(resolveConfig({}), {
    tools: { enabled: true },
    route: { enabled: true },
    drift: { command: '', cwd: '', mode: 'report' },
    links: { issue: '', pr: '' },
  })
})

test('a section given in part keeps the defaults of the rest', () => {
  const c = resolveConfig({ tools: { enabled: false }, drift: { command: 'x' }, links: { pr: 'https://h/{ref}' } })
  assert.equal(c.tools.enabled, false)
  assert.deepEqual(c.route, { enabled: true })
  assert.deepEqual(c.drift, { command: 'x', cwd: '', mode: 'report' })
  assert.deepEqual(c.links, { issue: '', pr: 'https://h/{ref}' })
})

test('a wrong type or drift.mode fails with its path', () => {
  assert.throws(() => resolveConfig({ drift: { mode: 'auto' } }), /drift.mode must be report or apply/)
  assert.throws(() => resolveConfig({ tools: { enabled: 'no' } }), /tools.enabled must be a boolean/)
  assert.throws(() => resolveConfig({ links: { issue: 3 } }), /links.issue must be a string/)
  assert.throws(() => resolveConfig({ links: 'x' }), /links must be an object/)
})

test('cordis.patch.yml restates every default', async () => {
  const text = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  for (const line of ['id: dsh-cockpit', "name: '@romany-saad/dsh-cockpit'", 'enabled: true', "command: ''", "cwd: ''", 'mode: report', "issue: ''", "pr: ''"]) {
    assert.ok(text.includes(line), line)
  }
  for (const section of Object.keys(DEFAULT_CONFIG)) assert.match(text, new RegExp('^        ' + section + ':$', 'm'), section)
})

test('links feed refUrl: empty patterns link only full URLs', () => {
  const none = linkOptions(resolveConfig(), { parent: 'romany-saad/dsh-plugins#1', tasks: [] })
  assert.deepEqual(none, { links: {}, parent: 'romany-saad/dsh-plugins#1' })
  assert.equal(refUrl('#4', 'pr', none), undefined)
  assert.equal(refUrl('https://example.com/pr/4', 'pr', none), 'https://example.com/pr/4')
})

test('links feed refUrl: {repo} and {number} from owner/repo#n, or from #n and the board parent; {ref} as stored', () => {
  const config = resolveConfig({ links: { issue: 'https://github.com/{repo}/issues/{number}', pr: ' https://github.com/{repo}/pull/{number} ' } })
  const opts = linkOptions(config, { parent: 'romany-saad/dsh-plugins#1' })
  assert.equal(refUrl('#4', 'pr', opts), 'https://github.com/romany-saad/dsh-plugins/pull/4')
  assert.equal(refUrl('Romany-Saad/resturants-app#883', 'issue', opts), 'https://github.com/Romany-Saad/resturants-app/issues/883')
  assert.equal(refUrl('PROJ-12', 'issue', opts), undefined, 'PROJ-12 fills neither {repo} nor {number}')
  const jira = linkOptions(resolveConfig({ links: { issue: 'https://example.atlassian.net/browse/{ref}' } }), {})
  assert.equal(refUrl('PROJ-12', 'issue', jira), 'https://example.atlassian.net/browse/PROJ-12')
  const board = { parent: 'o/r#1', tasks: [{ item: '1', what: 'x', status: 'next', issue: '#2', pr: '#3' }] }
  const rows = boardRows(board, linkOptions(config, board))
  assert.deepEqual([rows[0].issueUrl, rows[0].prUrl], ['https://github.com/o/r/issues/2', 'https://github.com/o/r/pull/3'])
})
