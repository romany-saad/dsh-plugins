import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as plugin from '../index.js'
import { METHODS, ROUTES, createRouteHandlers, driftConfigured } from '../lib/route.js'
import { resolveConfig } from '../lib/config.js'
import { boardTree } from '../lib/tree.js'
import { createConnectionHost, guestPeer } from './connection-host.mjs'
import { createHost, load } from './cordis-host.mjs'
import { exec, tempHome } from './helpers.mjs'

const BOARD = {
  format: 'dsh-cockpit.board', version: 1, key: 'bosla-883', parent: 'Romany-Saad/resturants-app#883',
  revision: 8, createdAt: '2026-10-24T17:55:40Z', updatedAt: '2026-10-25T07:04:30Z',
  tasks: [
    { item: '2', what: 'dsh-cockpit board', status: 'now', updatedAt: '2026-10-25T07:04:30Z' },
    { item: '2a', what: 'Read DSH sessions', status: 'waiting', parent: '2', dependsOn: ['1'], pr: '#902', waitingOn: 'owner', readyCommand: 'gh pr merge 902', updatedAt: '2026-10-25T07:04:30Z' },
  ],
  drift: { checkedAt: '2026-10-25T07:04:30Z', checked: 2, items: [{ item: '2a', status: 'done', note: '#902 merged' }] },
}

/** A DSH_HOME with two boards and one session bound to bosla-883. */
async function home() {
  const h = await tempHome()
  const dataDir = join(h, 'data', 'dsh-cockpit')
  await mkdir(join(dataDir, 'boards'), { recursive: true })
  await mkdir(join(dataDir, 'sessions'), { recursive: true })
  const text = JSON.stringify(BOARD, null, 2) + '\n'
  await writeFile(join(dataDir, 'boards', 'bosla-883.json'), text)
  await writeFile(join(dataDir, 'boards', 'other.json'), JSON.stringify({ ...BOARD, key: 'other', tasks: [] }))
  await writeFile(join(dataDir, 'sessions', 's1.json'), JSON.stringify({ version: 1, key: 'bosla-883' }))
  return { home: h, dataDir, text, routes: createRouteHandlers(dataDir) }
}
const get = (path, query = '') => new Request('http://127.0.0.1' + path + query)

/** Every file under dir with its mtime, to show the routes write nothing. */
async function snapshot(dir) {
  const out = {}
  for (const name of await readdir(dir, { recursive: true })) {
    const s = await stat(join(dir, name))
    if (s.isFile()) out[name] = s.mtimeMs + ':' + (await readFile(join(dir, name), 'utf8'))
  }
  return out
}

test('board: the file as stored, uncached; an unknown key is 404; no key is 400', async () => {
  const { routes, text } = await home()
  const ok = await routes[ROUTES.board](get(ROUTES.board, '?key=bosla-883'))
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  assert.equal(await ok.text(), text)
  const miss = await routes[ROUTES.board](get(ROUTES.board, '?key=nope'))
  assert.equal(miss.status, 404)
  assert.deepEqual(await miss.json(), { error: 'no such board' })
  for (const query of ['', '?key=']) assert.equal((await routes[ROUTES.board](get(ROUTES.board, query))).status, 400, query)
})

test('board: a key is percent-encoded into the file name, so ../ cannot leave boards/', async () => {
  const { routes, dataDir } = await home()
  await writeFile(join(dataDir, 'secret.json'), '{"secret":true}')
  for (const key of ['../secret', '..%2Fsecret', '../sessions/s1']) {
    const r = await routes[ROUTES.board](get(ROUTES.board, '?key=' + encodeURIComponent(key)))
    assert.equal(r.status, 404, key)
  }
  await writeFile(join(dataDir, 'boards', encodeURIComponent('a/b c') + '.json'), JSON.stringify({ ...BOARD, key: 'a/b c' }))
  assert.equal((await routes[ROUTES.board](get(ROUTES.board, '?key=' + encodeURIComponent('a/b c')))).status, 200)
})

test('boards: the keys in the folder; none when the folder does not exist', async () => {
  const { routes } = await home()
  assert.deepEqual(await (await routes[ROUTES.boards](get(ROUTES.boards))).json(), { boards: ['bosla-883', 'other'] })
  const empty = createRouteHandlers(join(await tempHome(), 'data', 'dsh-cockpit'))
  assert.deepEqual(await (await empty[ROUTES.boards](get(ROUTES.boards))).json(), { boards: [] })
})

test('view: a bound session gets its board, tree, flags, problems and whether drift is configured', async () => {
  const { routes, dataDir } = await home()
  const v = await (await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s1'))).json()
  assert.deepEqual(Object.keys(v), ['key', 'board', 'tree', 'flags', 'problems', 'driftConfigured'])
  assert.equal(v.key, 'bosla-883')
  assert.deepEqual(v.board, BOARD)
  const expected = boardTree(BOARD)
  assert.equal(v.tree, expected.tree)
  assert.deepEqual(v.flags, [{ item: '2a', code: 'unknown_dependency', ref: '1' }])
  assert.deepEqual(v.problems, expected.problems)
  assert.match(v.tree, /^Problems:\n  Unknown dependency: '1' on 2a\n/)
  assert.equal(v.driftConfigured, false)
  const on = createRouteHandlers(dataDir, { driftConfigured: true })
  assert.equal((await (await on[ROUTES.view](get(ROUTES.view, '?sessionId=s1'))).json()).driftConfigured, true)
})

test('view: an unbound session gets the board list; no sessionId is 400', async () => {
  const { routes, dataDir } = await home()
  assert.deepEqual(await (await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s2'))).json(), { key: null, boards: ['bosla-883', 'other'] })
  await writeFile(join(dataDir, 'sessions', 's3.json'), '{bad')
  assert.deepEqual(await (await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s3'))).json(), { key: null, boards: ['bosla-883', 'other'] })
  for (const query of ['', '?sessionId=']) assert.equal((await routes[ROUTES.view](get(ROUTES.view, query))).status, 400, query)
})

test('view: a bound board that is missing or unreadable is reported, not thrown', async () => {
  const { routes, dataDir } = await home()
  await writeFile(join(dataDir, 'sessions', 's4.json'), JSON.stringify({ version: 1, key: 'gone' }))
  assert.deepEqual(await (await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s4'))).json(), { key: 'gone', error: 'no such board', boards: ['bosla-883', 'other'] })
  await writeFile(join(dataDir, 'boards', 'bosla-883.json'), '{bad')
  const bad = await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s1'))
  assert.equal(bad.status, 200)
  const v = await bad.json()
  assert.equal(v.key, 'bosla-883')
  assert.match(v.error, /not JSON/)
  await writeFile(join(dataDir, 'boards', 'bosla-883.json'), JSON.stringify({ ...BOARD, version: 2 }))
  assert.match((await (await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s1'))).json()).error, /unknown version 2/)
})

test('driftConfigured: true only for a drift command that is not blank', () => {
  assert.equal(driftConfigured(resolveConfig()), false)
  assert.equal(driftConfigured(resolveConfig({ drift: { command: '   ' } })), false)
  assert.equal(driftConfigured(resolveConfig({ drift: { command: './drift.sh' } })), true)
})

// Through the plugin and DSH's own host connection service.

async function mounted(config = {}) {
  const h = await home()
  process.env.DSH_HOME = h.home
  const host = createConnectionHost()
  const fork = await load(host.ctx, plugin, config)
  return { ...h, ...host, fork }
}

test('the plugin registers the three routes on the host connection, GET and HEAD, and never on the raw web server', async () => {
  const { service, webRoutes, fork } = await mounted()
  assert.deepEqual([...service().fetchRoutes.keys()].sort(), Object.values(ROUTES).sort())
  for (const r of service().fetchRoutes.values()) assert.deepEqual([...r.methods], METHODS)
  assert.deepEqual(METHODS, ['GET', 'HEAD'])
  assert.deepEqual(webRoutes, [])
  await fork.dispose()
  assert.equal(service().fetchRoutes.size, 0)
})

test('the owner reads the view through the connection; HEAD gives the status and headers with no body', async () => {
  const { request, text, fork } = await mounted({ drift: { command: './drift.sh' } })
  const v = await (await request(ROUTES.view + '?sessionId=s1')).json()
  assert.equal(v.key, 'bosla-883')
  assert.equal(v.driftConfigured, true)
  assert.equal(await (await request(ROUTES.board + '?key=bosla-883')).text(), text)
  const head = await request(ROUTES.board + '?key=bosla-883', { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(await head.text(), '')
  assert.equal((await request(ROUTES.board + '?key=nope', { method: 'HEAD' })).status, 404)
  await fork.dispose()
})

test('refusals: a Peer that is not the owner gets 403 on every route and method, with no board data', async () => {
  const { request, fork } = await mounted()
  for (const path of Object.values(ROUTES)) {
    for (const method of METHODS) {
      const r = await request(path + '?key=bosla-883&sessionId=s1', { method, peer: guestPeer })
      assert.equal(r.status, 403, method + ' ' + path)
      assert.doesNotMatch(await r.text(), /bosla|dsh-cockpit/, method + ' ' + path)
    }
  }
  await fork.dispose()
})

test('refusals: POST is not a method of the routes, so it never reaches them (404); a path under the prefix is 404', async () => {
  const { request, fork } = await mounted()
  for (const path of Object.values(ROUTES)) assert.equal((await request(path, { method: 'POST' })).status, 404, path)
  assert.equal((await request('/api/dsh-cockpit/boards/x')).status, 404)
  assert.equal((await request('/api/dsh-cockpit/write')).status, 404)
  await fork.dispose()
})

test('refusals: route.enabled false registers no routes, and the tools still register', async () => {
  const { request, service, fork } = await mounted({ route: { enabled: false } })
  assert.equal(service().fetchRoutes.size, 0)
  assert.equal((await request(ROUTES.view + '?sessionId=s1')).status, 404)
  await fork.dispose()
  const { ctx: toolsCtx, tools } = createHost()
  await load(toolsCtx, plugin, { route: { enabled: false } })
  assert.equal(tools.size, 4)
})

test('tools.enabled false keeps the routes; a bad config registers neither', async () => {
  const a = await mounted({ tools: { enabled: false } })
  assert.equal(a.service().fetchRoutes.size, 3)
  await a.fork.dispose()
  const b = createConnectionHost()
  await load(b.ctx, plugin, { route: { enabled: 'yes' } }).catch(() => {})
  assert.equal(b.service().fetchRoutes.size, 0)
})

test('the routes only read: a round of every route and method leaves every file as it was', async () => {
  const { request, dataDir, fork } = await mounted()
  const before = await snapshot(dataDir)
  for (const path of Object.values(ROUTES)) {
    for (const query of ['', '?key=bosla-883', '?sessionId=s1', '?sessionId=new', '?key=new']) {
      for (const method of METHODS) await request(path + query, { method })
    }
  }
  assert.deepEqual(await snapshot(dataDir), before)
  await fork.dispose()
})

test('the view follows the tools: a board the hub opens and changes shows on the next read', async () => {
  const h = await home()
  process.env.DSH_HOME = h.home
  const conn = createConnectionHost()
  const { ctx, tools } = createHost()
  await load(conn.ctx, plugin, {})
  await load(ctx, plugin, {})
  assert.equal((await (await conn.request(ROUTES.view + '?sessionId=hub')).json()).key, null)
  await tools.get('board_open').execute({ key: 'live' }, exec('hub'))
  await tools.get('board_add').execute({ what: 'first', waitingOn: 'owner' }, exec('hub'))
  const v = await (await conn.request(ROUTES.view + '?sessionId=hub')).json()
  assert.equal(v.key, 'live')
  assert.equal(v.board.revision, 2)
  assert.deepEqual(v.board.tasks.map((t) => t.what), ['first'])
  assert.deepEqual((await (await conn.request(ROUTES.boards)).json()).boards, ['bosla-883', 'live', 'other'])
})

test('an error while reading is a 500 with its message, not a thrown request', async () => {
  const { request, dataDir, fork } = await mounted()
  await mkdir(join(dataDir, 'boards', 'dir.json'))
  const r = await request(ROUTES.board + '?key=dir')
  assert.equal(r.status, 500)
  assert.match((await r.json()).error, /EISDIR/)
  await fork.dispose()
})
