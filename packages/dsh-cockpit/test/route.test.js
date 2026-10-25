import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTES, createRouteHandlers, registerRoutes } from '../lib/route.js'

globalThis.fetch = () => { throw new Error('network access in a test') }

const BOARD = {
  format: 'dsh-cockpit.board', version: 1, key: 'bosla-883', parent: 'Romany-Saad/resturants-app#883',
  revision: 8, createdAt: '2026-10-24T17:55:40Z', updatedAt: '2026-10-25T07:04:30Z',
  tasks: [
    { item: '2', what: 'dsh-cockpit board', status: 'now', updatedAt: 'x' },
    { item: '2a', what: 'Read DSH sessions', status: 'waiting', parent: '2', dependsOn: ['1'], pr: '#902', readyCommand: 'gh pr merge 902', updatedAt: 'x' },
  ],
  drift: { checkedAt: '2026-10-25T07:04:30Z', items: [{ item: '2a', status: 'done', note: '#902 merged', differs: true }] },
}

async function home() {
  const h = await mkdtemp(join(tmpdir(), 'cockpit-route-'))
  const dataDir = join(h, 'data', 'dsh-cockpit')
  await mkdir(join(dataDir, 'boards'), { recursive: true })
  await mkdir(join(dataDir, 'sessions'), { recursive: true })
  const text = JSON.stringify(BOARD, null, 2) + '\n'
  await writeFile(join(dataDir, 'boards', 'bosla-883.json'), text)
  await writeFile(join(dataDir, 'boards', 'other.json'), JSON.stringify({ ...BOARD, key: 'other', tasks: [] }))
  await writeFile(join(dataDir, 'sessions', 's1.json'), JSON.stringify({ version: 1, key: 'bosla-883' }))
  return { dataDir, text, routes: createRouteHandlers(dataDir) }
}
const get = (path, query = '') => new Request(`http://127.0.0.1${path}${query}`)

test('board returns the file bytes; an unknown key is 404', async () => {
  const { routes, text } = await home()
  const ok = await routes[ROUTES.board](get(ROUTES.board, '?key=bosla-883'))
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), text)
  assert.equal((await routes[ROUTES.board](get(ROUTES.board, '?key=nope'))).status, 404)
  assert.equal((await routes[ROUTES.board](get(ROUTES.board))).status, 400)
})

test('boards lists the keys in the folder', async () => {
  const { routes } = await home()
  assert.deepEqual(await (await routes[ROUTES.boards](get(ROUTES.boards))).json(), { boards: ['bosla-883', 'other'] })
})

test('view: a bound session gets its board, tree, flags and drift', async () => {
  const { routes, dataDir } = await home()
  const v = await (await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s1'))).json()
  assert.equal(v.key, 'bosla-883')
  assert.equal(v.board.revision, 8)
  assert.deepEqual(v.flags, [{ item: '2a', code: 'unknown_dependency', ref: '1' }])
  assert.match(v.tree, /^2 +now +dsh-cockpit board +0 of 1 done\n└─ 2a +waiting +Read DSH sessions +after 1 +! unknown dependency 1$/)
  assert.equal(v.board.drift.items[0].differs, true)
  assert.equal(v.driftConfigured, false)
  const on = createRouteHandlers(dataDir, { driftConfigured: true })
  assert.equal((await (await on[ROUTES.view](get(ROUTES.view, '?sessionId=s1'))).json()).driftConfigured, true)
})

test('view: an unbound session gets the board list', async () => {
  const { routes } = await home()
  assert.deepEqual(await (await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s2'))).json(), { key: null, boards: ['bosla-883', 'other'] })
})

test('view: an unreadable board is reported, not thrown', async () => {
  const { routes, dataDir } = await home()
  await writeFile(join(dataDir, 'boards', 'bosla-883.json'), '{bad')
  const v = await (await routes[ROUTES.view](get(ROUTES.view, '?sessionId=s1'))).json()
  assert.equal(v.key, 'bosla-883')
  assert.match(v.error, /not JSON/)
})

test('registerRoutes registers three GET/HEAD routes; HEAD has no body', async () => {
  const { dataDir } = await home()
  const registered = []
  const disposed = []
  const ctx = {
    effect: (fn) => disposed.push(fn()),
    connection: { fetch: { register: (route) => { registered.push(route); return async () => {} } } },
  }
  registerRoutes(ctx, dataDir)
  assert.deepEqual(registered.map((r) => r.path).sort(), Object.values(ROUTES).sort())
  for (const r of registered) assert.deepEqual(r.methods, ['GET', 'HEAD'])
  const board = registered.find((r) => r.path === ROUTES.board)
  const head = await board.fetch(new Request('http://127.0.0.1/api/dsh-cockpit/board?key=bosla-883', { method: 'HEAD' }))
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal(disposed.length, 3)
})
