// dsh-frosty-castle-theme on a jsdom page with real React and the real @rs-dsh/dsh-core:
// the frame follows the accepted width live, and the Plugins page edits it
// through DSH's staged form, writing only on Save.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createPage, fakePrimitives, click, typeInto, settle } from '../../dsh-core/test/dom.mjs'

const CORE = new URL('../../dsh-core/client.js', import.meta.url)
const FROST = new URL('../client.js', import.meta.url)
const require = createRequire(new URL('../../dsh-core/test/dom.mjs', import.meta.url))

/**
 * A shared config form like ui-settings', with a Host that validates the range.
 * A class with prototype methods that use `this`, as the real one is, so a
 * detached `form.subscribe` fails here the way it fails in the browser.
 */
class FakeForm {
  constructor(initial) {
    this.snap = { status: 'ready', value: { borderWidth: initial, borderOffset: 0, compatibilityInset: true, compatibilityInsetTop: 0, compatibilityInsetRight: 0, compatibilityInsetBottom: 0, compatibilityInsetLeft: 0 }, base: undefined, user: {}, revision: 1, writable: true }
    this.listeners = new Set()
    this.writes = []
  }
  getSnapshot() { return this.snap }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  notify() { for (const fn of this.listeners) fn() }
  accept(value) { this.snap = { ...this.snap, value: { ...this.snap.value, borderWidth: value }, revision: this.snap.revision + 1 }; this.notify() }
  async mutate(ops, revision) {
    this.writes.push({ ops, revision })
    const value = { ...this.snap.value }, user = { ...this.snap.user }
    for (const op of ops) {
      const field = op.path[0], adjustment = /^compatibilityInset(Top|Right|Bottom|Left)$/.test(field), min = field === 'borderWidth' ? 12 : adjustment ? -48 : 0
      const next = op.op === 'unset' ? (field === 'borderWidth' ? 30 : field === 'compatibilityInset' ? true : 0) : op.value
      if (field === 'compatibilityInset' ? typeof next !== 'boolean' : !Number.isInteger(next) || next < min || next > (adjustment ? 96 : 48)) return false
      value[field] = next
      if (op.op === 'unset') delete user[field]; else user[field] = next
    }
    this.snap = { ...this.snap, value, user, revision: this.snap.revision + 1 }
    this.notify()
    return true
  }
  listenerCount() { return this.listeners.size }
}
const fakeForm = (initial) => new FakeForm(initial)


function harness(initial = 30) {
  const probe = createPage({ bundles: [CORE] })
  const names = probe.modules[0].exports._internals.UI_EXPORTS
  probe.close()
  const page = createPage({ bundles: [CORE, FROST], primitives: fakePrimitives(names) })
  const form = fakeForm(initial)
  const slots = new Map()
  let dict = {}
  const served = []
  page.ctx.locale = {
    register: (_ns, dicts) => { dict = dicts.en; return () => {} },
    bind: () => (key, vars = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k]),
  }
  page.start({
    theme: { overrideTokens: () => () => {} },
    sessions: { scope: () => undefined },
    conversation: { input: { for: () => null } },
    slots: { inject: (_n, make) => make(), register: (desc, component) => { slots.set(desc.name, { desc, component }); return () => slots.delete(desc.name) } },
    configForms: { get: (id) => { assert.equal(id, 'dsh-frosty-castle-theme'); return form }, whileServed: (ns, register) => { served.push(ns); return register(new Set(ns)) } },
  })
  const React = page.services.get('rsDshCore').React
  const t = (key, vars = {}) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k])
  const mount = (name, props = {}) => {
    const host = page.document.createElement('div')
    page.document.body.append(host)
    const root = require('react-dom/client').createRoot(host)
    const slot = slots.get(name)
    const injected = slot.desc.inject ? slot.desc.inject() : {}
    const hooks = Object.fromEntries(Object.entries(injected.hooks ?? {}).map(([k, store]) => ['use' + k[0].toUpperCase() + k.slice(1), (select) => select(React.useSyncExternalStore(store.subscribe, store.getSnapshot))]))
    const { hooks: _h, ...actions } = injected
    page.act(() => root.render(React.createElement(slot.component, { t, ...actions, ...hooks, ...props })))
    return { host, unmount: () => page.act(() => root.unmount()) }
  }
  return { page, form, slots, served, mount, close: () => { page.dispose(); page.close() } }
}

const widthOf = (host) => host.querySelector('.fr-frame').style.getPropertyValue('--fr-width')

test('the frame draws the accepted width and follows a change without reload', () => {
  const h = harness(36)
  const frame = h.mount('shell.overlay')
  assert.equal(widthOf(frame.host), '36px')
  assert.equal(frame.host.querySelector('.fr-frame').getAttribute('aria-hidden'), 'true')
  for (const pos of ['top', 'bottom', 'left', 'right']) assert.ok(frame.host.querySelector('.fr-rail.fr-' + pos), pos)
  for (const pos of ['tl', 'tr', 'bl', 'br']) assert.ok(frame.host.querySelector('.fr-junction.fr-' + pos), pos)
  assert.equal(frame.host.querySelectorAll('.fr-rail.fr-top').length, 1)
  assert.ok(frame.host.querySelector('.fr-crest'))
  h.page.act(() => h.form.accept(44))
  assert.equal(widthOf(frame.host), '44px')
  frame.unmount()
  h.close()
})

test('the page registers on the Frost row while its entry is served', () => {
  const h = harness()
  const entry = h.slots.get('plugins.row.config')
  assert.equal(entry.desc.key, '@rs-dsh/dsh-frosty-castle-theme#dsh-frosty-castle-theme')
  assert.deepEqual(h.served.map((ns) => [...ns]), [['dsh-frosty-castle-theme']])
  const summary = h.mount('plugins.row.config', { view: 'summary' })
  assert.equal(summary.host.textContent, 'Icy frame and cool palette for DSH Web.')
  summary.unmount()
  h.close()
})

test('saving a width writes once, fenced by the revision, and the frame follows', async () => {
  const h = harness()
  const frame = h.mount('shell.overlay')
  const page = h.mount('plugins.row.config', { view: 'page' })
  const input = page.host.querySelector('#rs-dsh-frost-border-width')
  assert.equal(input.value, '30')
  typeInto(h.page, input, '40')
  assert.equal(h.form.writes.length, 0, 'typing alone writes nothing')
  assert.equal(widthOf(frame.host), '30px', 'an unsaved draft does not move the frame')
  click(h.page, page.host.querySelector('[data-action="save"]'))
  await settle(h.page, 0)
  assert.deepEqual(h.form.writes, [{ ops: [{ op: 'set', path: ['borderWidth'], value: 40 }], revision: 1 }])
  assert.equal(widthOf(frame.host), '40px')
  page.unmount(); frame.unmount()
  h.close()
})

test('an out-of-range draft is flagged and cannot be saved', () => {
  const h = harness()
  const page = h.mount('plugins.row.config', { view: 'page' })
  const input = page.host.querySelector('#rs-dsh-frost-border-width')
  typeInto(h.page, input, '80')
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  assert.match(page.host.textContent, /whole number from 12 to 48/)
  assert.equal(page.host.querySelector('[data-action="save"]').disabled, true)
  assert.equal(h.form.writes.length, 0)
  page.unmount()
  h.close()
})

test('reset clears the override so the default returns', async () => {
  const h = harness(40)
  const page = h.mount('plugins.row.config', { view: 'page' })
  typeInto(h.page, page.host.querySelector('#rs-dsh-frost-border-width'), '')
  click(h.page, page.host.querySelector('[data-action="save"]'))
  await settle(h.page, 0)
  assert.deepEqual(h.form.writes.at(-1).ops, [{ op: 'unset', path: ['borderWidth'] }])
  assert.equal(h.form.getSnapshot().value.borderWidth, 30)
  page.unmount()
  h.close()
})

test('offset saves live, rejects invalid drafts, and resets independently', async () => {
  const h = harness()
  const frame = h.mount('shell.overlay')
  const page = h.mount('plugins.row.config', { view: 'page' })
  const input = page.host.querySelector('#rs-dsh-frost-offset-top')
  const offset = () => frame.host.querySelector('.fr-frame').style.getPropertyValue('--fr-offset-top')
  assert.equal(input.type, 'number')
  assert.equal(input.placeholder, '0')
  typeInto(h.page, input, '49')
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  assert.equal(page.host.querySelector('[data-action="save"]').disabled, true)
  typeInto(h.page, input, '8')
  assert.equal(offset(), '0px')
  click(h.page, page.host.querySelector('[data-action="save"]'))
  await settle(h.page, 0)
  assert.deepEqual(h.form.writes.at(-1).ops, [{ op: 'set', path: ['borderOffsetTop'], value: 8 }])
  assert.equal(offset(), '8px')
  typeInto(h.page, input, '')
  click(h.page, page.host.querySelector('[data-action="save"]'))
  await settle(h.page, 0)
  assert.deepEqual(h.form.writes.at(-1).ops, [{ op: 'unset', path: ['borderOffsetTop'] }])
  assert.equal(offset(), '0px')
  page.unmount(); frame.unmount(); h.close()
})

test('compatibility inset stages, saves, discards and resets independently', async () => {
  const h = harness()
  const page = h.mount('plugins.row.config', { view: 'page' })
  const checkbox = page.host.querySelector('#rs-dsh-frost-compatibility-inset')
  assert.equal(checkbox.checked, true)
  click(h.page, checkbox)
  assert.equal(checkbox.checked, false)
  assert.equal(h.form.writes.length, 0)
  click(h.page, page.host.querySelector('[data-action="save"]'))
  await settle(h.page, 0)
  assert.deepEqual(h.form.writes.at(-1).ops, [{ op: 'set', path: ['compatibilityInset'], value: false }])
  assert.equal(h.form.getSnapshot().value.compatibilityInset, false)
  click(h.page, checkbox)
  click(h.page, page.host.querySelector('[data-action="discard"]'))
  assert.equal(checkbox.checked, false)
  const reset = [...page.host.querySelectorAll('button')].find((button) => button.textContent === 'Reset to default')
  click(h.page, reset)
  click(h.page, page.host.querySelector('[data-action="save"]'))
  await settle(h.page, 0)
  assert.deepEqual(h.form.writes.at(-1).ops, [{ op: 'unset', path: ['compatibilityInset'] }])
  assert.equal(checkbox.checked, true)
  page.unmount(); h.close()
})

test('inset adjustment drafts show with checkbox and save independently', async () => {
  const h = harness()
  const page = h.mount('plugins.row.config', { view: 'page' })
  const checkbox = page.host.querySelector('#rs-dsh-frost-compatibility-inset')
  const input = (edge) => page.host.querySelector('#rs-dsh-frost-inset-' + edge)
  const details = () => page.host.querySelector('details.fr-inset-details')
  assert.equal(details().open, false)
  click(h.page, details().querySelector('summary'))
  assert.equal(details().open, true)
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    assert.equal(input(edge).value, '0')
    assert.equal(input(edge).type, 'number')
    assert.equal(input(edge).min, '-48')
    assert.equal(input(edge).max, '96')
    assert.equal(input(edge).step, '1')
  }
  typeInto(h.page, input('top'), '-49')
  assert.equal(input('top').getAttribute('aria-invalid'), 'true')
  assert.equal(page.host.querySelector('[data-action="save"]').disabled, true)
  typeInto(h.page, input('top'), '-48')
  typeInto(h.page, input('right'), '96')
  click(h.page, checkbox)
  assert.equal(input('top'), null)
  click(h.page, checkbox)
  // The toggle lives inside the same section, which stays open while the draft is kept.
  assert.equal(details().open, true)
  assert.ok(details().contains(checkbox))
  assert.equal(input('top').value, '-48')
  click(h.page, page.host.querySelector('[data-action="save"]'))
  await settle(h.page, 0)
  assert.deepEqual(h.form.writes.at(-1).ops, [{ op: 'set', path: ['compatibilityInsetTop'], value: -48 }, { op: 'set', path: ['compatibilityInsetRight'], value: 96 }, { op: 'set', path: ['compatibilityInset'], value: true }])
  typeInto(h.page, input('top'), '')
  click(h.page, page.host.querySelector('[data-action="save"]'))
  await settle(h.page, 0)
  assert.deepEqual(h.form.writes.at(-1).ops, [{ op: 'unset', path: ['compatibilityInsetTop'] }])
  assert.equal(h.form.getSnapshot().value.compatibilityInsetRight, 96)
  page.unmount(); h.close()
})

test('turning Frost off releases the form subscription', () => {
  const h = harness()
  assert.ok(h.form.listenerCount() >= 1)
  h.page.dispose()
  assert.equal(h.form.listenerCount(), 0)
  h.page.close()
})
