import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

let entry
vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { entry = value } } } })
const plugin = entry.factory()

test('embedded assembly images and textures match packaged assets', () => {
  const css = plugin._internals.STYLE('[data-rs-dsh="dsh-frosty-castle-theme"]')
  const images = [...css.matchAll(/data:image\/png;base64,([^"\)]+)/g)]
  assert.equal(images.length, 6)
  for (const [i, asset] of ['rail.png', 'side-rail.png', 'junction.png', 'panel.png', 'panel.png', 'crest.png'].entries())
    assert.deepEqual(Buffer.from(images[i][1], 'base64'), readFileSync(new URL('../assets/' + asset, import.meta.url)))
  const values = plugin._internals.TOKENS['--dsw-specific-input-major']
  for (const [mode, asset] of [['light', 'rime.webp'], ['dark', 'night.webp']]) {
    const embedded = values[mode].match(/data:image\/webp;base64,([^"\)]+)/)
    assert.ok(embedded, mode)
    assert.deepEqual(Buffer.from(embedded[1], 'base64'), readFileSync(new URL('../assets/' + asset, import.meta.url)))
  }
})

test('overrides give both palettes, and only for DSH design tokens', () => {
  assert.equal(plugin.name, '@rs-dsh/dsh-frosty-castle-theme')
  assert.equal(plugin._internals.TOKENS['--dsw-alias-bg-base'].dark, '#09111c')
  for (const [key, pair] of Object.entries(plugin._internals.TOKENS)) {
    // DSH's own variables only: no private class names, no invented tokens.
    assert.match(key, /^--dsw-(alias|specific|menu|focus|corner)-[a-z0-9-]+$/, key)
    assert.equal(typeof pair.light, 'string', key)
    assert.equal(typeof pair.dark, 'string', key)
    assert.ok(pair.light && pair.dark, key)
  }
})

test('the controls DSH draws pick up the frost palette', () => {
  const t = plugin._internals.TOKENS
  // Buttons, fields, menus, dialogs, tooltips and focus each read one of these.
  for (const key of ['--dsw-alias-button-primary-fill', '--dsw-alias-interactive-bg-hover', '--dsw-alias-bg-layer-1',
    '--dsw-specific-input-major', '--dsw-alias-tooltip-bg', '--dsw-focus-ring-color', '--dsw-corner-shape']) {
    assert.ok(t[key], key + ' is themed')
  }
  // The primary fill is also a chip's border colour in DSH, so it must stay a plain colour.
  for (const v of Object.values(t['--dsw-alias-button-primary-fill'])) assert.match(v, /^#[0-9a-f]{6}$/)
  assert.deepEqual({ ...t['--dsw-corner-shape'] }, { light: 'bevel', dark: 'bevel' })
  // Shared base and sidebar tokens are also consumed as colors.
  for (const key of ['--dsw-alias-bg-base', '--dsw-specific-sidebar-fill'])
    for (const value of Object.values(t[key])) assert.match(value, /^#[0-9a-f]{6}$/)
  // Image values must remain restricted to the audited background consumers.
  const textured = Object.entries(t).filter(([, v]) => /url\(/.test(v.light + v.dark)).map(([k]) => k).sort()
  assert.deepEqual(textured, ['--dsw-alias-button-elevated-fill', '--dsw-alias-settings-card-fill', '--dsw-specific-input-major'])
})

test('host and client agree on the width range, and the schema enforces it', async () => {
  const host = await import('../index.js')
  // The client runs in its own realm; compare the values, not the prototypes.
  assert.deepEqual({ ...host.BORDER_WIDTH }, { ...plugin._internals.WIDTH })
  // A volatile field resolves to a live reference, read with get().
  assert.equal(host.Config({}).borderWidth.get(), 48)
  assert.equal(host.Config({ borderWidth: 40 }).borderWidth.get(), 40)
  for (const bad of [11, 49, 30.5, -1]) assert.throws(() => host.Config({ borderWidth: bad }), undefined, String(bad))
})

test('offset host and client agree and clamp accepted values', async () => {
  const host = await import('../index.js')
  assert.deepEqual({ ...host.BORDER_OFFSET }, { ...plugin._internals.OFFSET })
  assert.equal(host.Config({}).borderOffset.get(), undefined)
  assert.equal(host.Config({ borderOffset: 12 }).borderOffset.get(), 12)
  for (const bad of [-1, 49, 2.5]) assert.throws(() => host.Config({ borderOffset: bad }))
  const { frameOffset } = plugin._internals
  assert.equal(frameOffset(), 0)
  for (const [edge, expected] of Object.entries({ Top: 9, Right: 12, Bottom: 9, Left: 12 })) {
    assert.equal(frameOffset(undefined, edge), expected)
    assert.equal(frameOffset({ value: { borderOffset: 6 } }, edge), 6)
    assert.equal(frameOffset({ value: { borderOffset: 6, ['borderOffset' + edge]: 0 } }, edge), 0)
  }
  assert.equal(frameOffset({ value: { borderOffset: 12 } }), 12)
  assert.equal(frameOffset({ value: { borderOffset: 99 } }), 48)
  assert.equal(frameOffset({ value: { borderOffset: -1 } }), 0)
})

test('inset adjustment schema accepts only signed integers in range', async () => {
  const host = await import('../index.js')
  assert.deepEqual({ ...host.INSET_ADJUSTMENT }, { ...plugin._internals.INSET_ADJUSTMENT })
  for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
    const field = 'compatibilityInset' + edge
    assert.equal(host.Config({})[field].get(), ['Top', 'Bottom'].includes(edge) ? -16 : 0)
    for (const value of [-48, 0, 96]) assert.equal(host.Config({ [field]: value })[field].get(), value)
    for (const value of [-49, 97, 1.5]) assert.throws(() => host.Config({ [field]: value }))
  }
})

test('the drawn width is the accepted value, clamped, else the default', () => {
  const { frameWidth } = plugin._internals
  assert.equal(frameWidth(undefined), 48)
  assert.equal(frameWidth({ status: 'loading', value: undefined }), 48)
  assert.equal(frameWidth({ value: { borderWidth: 40 } }), 40)
  assert.equal(frameWidth({ value: { borderWidth: 999 } }), 48)
  assert.equal(frameWidth({ value: { borderWidth: 2 } }), 12)
  assert.equal(frameWidth({ value: { borderWidth: 'wide' } }), 48)
})

test('a draft outside the range blocks the save instead of reaching the Host', () => {
  const base = { field: 'borderWidth', format: String, parse: (t) => (t === '' ? { kind: 'clear' } : Number.isFinite(Number(t)) ? { kind: 'set', value: Number(t) } : undefined) }
  const f = plugin._internals.widthField(base)
  assert.deepEqual(f.parse('36'), { kind: 'set', value: 36 })
  assert.deepEqual(f.parse(''), { kind: 'clear' })
  for (const bad of ['8', '60', '30.5', 'abc']) assert.equal(f.parse(bad), undefined, bad)
})

test('frame pieces share width and displacement and reserve the crest', () => {
  const style = plugin._internals.STYLE('[data-rs-dsh="dsh-frosty-castle-theme"]')
  assert.match(style, /\.fr-frame\{--fr-width:48px;/)
  assert.match(style, /pointer-events:none/)
  for (const edge of ['top', 'right', 'bottom', 'left']) assert.ok(style.includes('var(--fr-offset-' + edge + ')'))
  assert.match(style, /background-repeat:round no-repeat/)
  assert.ok(style.includes(".fr-top{top:0;left:0;right:0}"))
  assert.doesNotMatch(style, /fr-top-left|fr-top-right/)
  for (const name of ['top', 'bottom', 'left', 'right', 'tl', 'tr', 'bl', 'br', 'crest']) assert.ok(style.includes('.fr-' + name + '{'), name)
  assert.doesNotMatch(style, /drop-shadow/)
  // The main frame uses explicit rails and corners; the collapsible section uses a stone border-image.
  assert.match(style, /\.fr-inset-details:is\(details\)\{[^}]*border-image:/)
})

test('the crest moves and scales on its own, clamped, without touching the rails', async () => {
  const host = await import('../index.js')
  assert.deepEqual({ ...host.CREST_Y }, { ...plugin._internals.CREST_Y })
  assert.deepEqual({ ...host.CREST_SIZE }, { ...plugin._internals.CREST_SIZE })
  const { crestY, crestSize } = plugin._internals
  assert.equal(crestY(undefined), 0)
  assert.equal(crestSize(undefined), 100)
  assert.equal(crestY({ value: { crestOffsetY: 12 } }), 12)
  assert.equal(crestY({ value: { crestOffsetY: 999 } }), 96)
  assert.equal(crestY({ value: { crestOffsetY: -999 } }), -48)
  assert.equal(crestSize({ value: { crestSize: 150 } }), 150)
  assert.equal(crestSize({ value: { crestSize: 1 } }), 50)
  assert.equal(crestSize({ value: { crestSize: 'big' } }), 100)
  for (const bad of [-49, 97, 1.5]) assert.throws(() => host.Config({ crestOffsetY: bad }))
  for (const bad of [49, 201, 1.5]) assert.throws(() => host.Config({ crestSize: bad }))
  const style = plugin._internals.STYLE('[data-rs-dsh="dsh-frosty-castle-theme"]')
  // The crest is positioned only by its own variables; rails never read them.
  assert.match(style, /\.fr-crest\{[^}]*--fr-crest-k:calc\(var\(--fr-crest-scale\)[^}]*var\(--fr-crest-y\)/)
  for (const rule of style.split('\n').filter((l) => /\.fr-(top|bottom|left|right|rail|tl|tr|bl|br)\b/.test(l))) assert.doesNotMatch(rule, /fr-crest-(y|scale)/)
})
