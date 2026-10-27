import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const plain = (value) => JSON.parse(JSON.stringify(value))

function loadBundle() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let registered
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (entry) => { registered = entry } } } })
  assert.equal(registered.id, '@rs-dsh/dsh-core')
  return registered.factory(() => { throw new Error('no requires at load time') })
}
const bundle = loadBundle()
const c = bundle._internals

test('bundle id, name and inject match package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(bundle.name, pkg.name)
  assert.deepEqual([...bundle.inject].sort(), ['conversation', 'locale', 'sessions'])
})

// The early warning the owner asked for: every component and icon the core
// hands to the plugins exists in DSH's UI library at the pinned version. The
// library needs a browser and React to run, so its export list is read from
// its own type declarations and its bundle's export statement.
test('every UI export the core uses exists in the pinned dsh-client-ui-primitives', () => {
  const require = createRequire(import.meta.url)
  const pkgPath = require.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const ours = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, ours.devDependencies['@deepseek-ai/dsh-client-ui-primitives'], 'tested against the pinned version')
  const dir = pkgPath.slice(0, -'package.json'.length)
  const js = readFileSync(dir + 'lib/index.js', 'utf8')
  const exported = new Set()
  for (const block of js.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) exported.add(name)
    }
  }
  const missing = plain(c.UI_EXPORTS.filter((name) => !exported.has(name)))
  assert.deepEqual(missing, [], 'dsh-client-ui-primitives no longer exports: ' + missing.join(', '))
  assert.ok(exported.size > 100, 'read the export list')
})

test('pickUi takes only the listed exports and names what is missing', () => {
  const lib = Object.fromEntries(c.UI_EXPORTS.map((n) => [n, n]))
  lib.Extra = 'x'
  const ui = c.pickUi(lib)
  assert.deepEqual(Object.keys(ui), [...c.UI_EXPORTS])
  delete lib.Button
  delete lib.MenuSurface
  assert.throws(() => c.pickUi(lib), /lacks Button, MenuSurface/)
  assert.throws(() => c.pickUi(null), /is not available in this DSH build/)
})

test('plugin names are attribute- and selector-safe', () => {
  assert.equal(c.checkPlugin('dsh-threads'), 'dsh-threads')
  for (const bad of ['', 'Threads', 'a b', 'x"]', '1x', null]) assert.throws(() => c.checkPlugin(bad), /plugin names/)
})

test('placeNear keeps a card inside the viewport, above or below its anchor', () => {
  const viewport = { width: 1000, height: 800 }
  const size = { width: 300, height: 200 }
  const middle = { left: 100, top: 300, right: 200, bottom: 320, width: 100, height: 20 }
  assert.deepEqual(plain(c.placeNear(middle, size, viewport)), { top: 328, left: 100, above: false })
  assert.equal(c.placeNear(middle, size, viewport, { prefer: 'above' }).above, true)
  const low = { left: 900, top: 700, right: 950, bottom: 720, width: 50, height: 20 }
  const at = c.placeNear(low, size, viewport)
  assert.equal(at.above, true, 'flips above when there is no room below')
  assert.equal(at.left, 1000 - 300 - 8, 'clamped to the right edge')
  const top = { left: 10, top: 4, right: 60, bottom: 20, width: 50, height: 16 }
  assert.equal(c.placeNear(top, size, viewport, { prefer: 'above' }).above, false, 'below when there is no room above')
  const centered = c.placeNear(middle, { width: 100, height: 30 }, viewport, { align: 'center', prefer: 'above' })
  assert.equal(centered.left, 100)
})

test('toolbar buttons sort by order, then by registration', () => {
  const b = (id, order, seq) => ({ id, order, seq })
  assert.deepEqual(c.sortButtons([b('comment', 20, 0), b('quote', 10, 1), b('later', 20, 2)]).map((x) => x.id), ['quote', 'comment', 'later'])
})

test('selection text is cleaned', () => {
  assert.equal(c.cleanSelection('  a  \r\n\n\n\nb\t \n'), 'a\n\nb')
})

test('oneLine flattens and cuts, and never carries editor placeholders', () => {
  assert.equal(c.oneLine('  a\n b  ', 10), 'a b')
  assert.equal(c.oneLine('abcdef', 4), 'abc\u2026')
  assert.equal(c.oneLine('x\uFFFCy\uE100z', 9), 'xyz')
})

test('stackChip stacks chips of one source at the top and shifts the rest', () => {
  const file = { source: 'reference', ref: '@a.ts', offset: 4, length: 5, label: 'a.ts', clipboardText: '@a.ts' }
  const ins = (t) => ({ source: 'quote', ref: t, label: t, clipboardText: '> ' + t })
  let d = { text: 'see @a.ts', references: [file] }
  d = c.stackChip(d, ins('one'))
  d = c.stackChip(d, ins('two'))
  d = c.stackChip(d, { ...ins('t'), source: 'comment' }, ['quote', 'comment'])
  assert.equal(d.text, '> one\n> two\n> t\nsee @a.ts', 'after every rs-dsh chip at the top, in the order added')
  const own = c.stackChip({ text: '> one\nq', references: [{ source: 'quote', ref: 'one', offset: 0, length: 5, label: 'one', clipboardText: '> one' }] }, { ...ins('t'), source: 'comment' })
  assert.equal(own.text, '> t\n> one\nq', 'by default only after its own source')
  for (const r of d.references) assert.equal(d.text.slice(r.offset, r.offset + r.length), r.clipboardText)
})
