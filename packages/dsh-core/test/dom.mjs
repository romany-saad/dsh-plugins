// A browser-like page for the client bundles: jsdom, real React 19 and
// react-dom/client, and the DSH UI library stood in by plain React
// components with the same names and props (jsdom cannot load its CSS
// modules). Exported for the other rs-dsh packages' tests too.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)

// react-dom decides once, when it loads, whether it runs in a browser. One
// shared jsdom window is the global DOM for the whole test process, and each
// page is a fresh document swapped into it.
const shared = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true, url: 'http://127.0.0.1/' })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLIFrameElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { value: shared.window[key], configurable: true, writable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = require('react')
const jsxRuntime = require('react/jsx-runtime')
const ReactDOMClient = require('react-dom/client')
const { act } = React

/** Stand-ins for the dsh-client-ui-primitives exports, by the props DSH documents. */
export function fakePrimitives(names) {
  const h = React.createElement
  const named = {
    Button: React.forwardRef(({ variant, size, icon, children, ...rest }, ref) =>
      h('button', { ref, type: 'button', 'data-variant': variant ?? 'ghost', 'data-size': size ?? 'md', ...rest }, icon ?? null, children)),
    MenuSurface: React.forwardRef(({ compact, children, ...rest }, ref) => h('div', { ref, 'data-menu-surface': compact ? 'compact' : '', ...rest }, children)),
    InlineEditor: ({ value, label, onChange, onSave, onCancel }) => h('textarea', {
      'aria-label': label,
      value,
      onChange: (e) => onChange(e.currentTarget.value),
      onKeyDown: (e) => {
        if (e.key === 'Escape') { onCancel(); return }
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSave() }
      },
    }),
    TextShimmer: ({ children }) => h('span', { 'data-shimmer': '' }, children),
    MarkdownText: ({ text }) => h('div', { 'data-markdown': '' }, text),
    Tooltip: ({ children }) => children,
    Toast: ({ text }) => h('div', { role: 'status' }, text),
    // The library's bucketing, as DSH 0.2.1-rc.2 ships it.
    relativeTime: (at, now) => {
      const diff = Math.max(0, now - at)
      if (diff < 60e3) return { unit: 'now', n: 0 }
      if (diff < 36e5) return { unit: 'minutes', n: Math.floor(diff / 60e3) }
      if (diff < 864e5) return { unit: 'hours', n: Math.floor(diff / 36e5) }
      const days = Math.floor(diff / 864e5)
      if (days < 30) return { unit: 'days', n: days }
      if (days < 365) return { unit: 'months', n: Math.floor(days / 30) }
      return { unit: 'years', n: Math.floor(days / 365) }
    },
  }
  const out = {}
  for (const name of names) out[name] = named[name] ?? ((props) => h('svg', { 'data-icon': name, width: props?.size ?? 16 }))
  return out
}

/**
 * A page with the given bundles loaded, in order, through a module loader
 * like DSH's, and a minimal plugin context with ctx.provide / ctx.get.
 * @param {{ bundles: URL[], primitives?: object, html?: string }} options
 */
export function createPage({ bundles, primitives, html = '<!doctype html><html><head></head><body></body></html>' }) {
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://127.0.0.1/' })
  const { window } = dom
  // jsdom has no layout: ranges get one flat box, so placement code runs.
  const box = { left: 120, top: 300, right: 180, bottom: 320, width: 60, height: 20 }
  window.Range.prototype.getClientRects ??= function () { return [box] }
  window.Range.prototype.getBoundingClientRect ??= function () { return box }
  window.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const registered = []
  window.__ModuleLoader__ = { load: (entry) => registered.push(entry) }
  const context = vm.createContext(window)
  for (const url of bundles) vm.runInContext(readFileSync(url, 'utf8'), context, { filename: url.pathname })

  // React renders into this window's document.
  const saved = {}
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
    saved[key] = globalThis[key]
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true })
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }

  const services = new Map()
  const disposers = []
  const ctx = {
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); else if (d && typeof d[Symbol.iterator] === 'function') for (const x of d) if (typeof x === 'function') disposers.push(x) },
    locale: { register: () => () => {}, bind: () => (key) => key },
    provide: (name, value) => { services.set(name, value) },
    get: (name) => services.get(name),
  }
  const requireFor = (id) => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === 'react-dom/client') return ReactDOMClient
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      if (primitives === undefined) throw new Error('not in the module table')
      return primitives
    }
    throw new Error('unexpected require ' + id)
  }
  const modules = registered.map((entry) => ({ id: entry.id, exports: entry.factory(requireFor) }))
  return {
    window,
    document: window.document,
    ctx,
    services,
    modules,
    /** apply() every bundle whose injected services are present, in order. */
    start(extra = {}) {
      Object.assign(ctx, extra)
      act(() => {
        for (const m of modules) {
          for (const name of m.exports.inject ?? []) if (!(name in ctx) && !services.has(name)) throw new Error(`${m.id} needs ${name}`)
          const scoped = { ...ctx }
          for (const name of m.exports.inject ?? []) if (services.has(name)) scoped[name] = services.get(name)
          m.exports.apply(scoped)
        }
      })
    },
    act,
    dispose() { act(() => { for (const d of disposers.splice(0).reverse()) d() }) },
    close() { restore(); window.close() },
  }
}

/** Select the text of `node` from `start` to `end` in the page. */
export function selectText(page, node, start, end) {
  const range = page.document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  // jsdom has no layout; give the range a box.
  range.getBoundingClientRect = () => ({ left: 100, top: 300, right: 300, bottom: 320, width: 200, height: 20 })
  const sel = page.window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  page.document.dispatchEvent(new page.window.Event('selectionchange'))
  return range
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Type into a React-controlled textarea or input. */
export function typeInto(page, el, value) {
  page.act(() => {
    const proto = el.tagName === 'TEXTAREA' ? page.window.HTMLTextAreaElement.prototype : page.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new page.window.Event('input', { bubbles: true }))
  })
}

/** Press a key on an element. */
export function press(page, el, key, init = {}) {
  page.act(() => { el.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })) })
}

/** Click an element. */
export function click(page, el) {
  page.act(() => { el.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
}

/** Let timers run inside act, so React flushes what they render. */
export async function settle(page, ms) {
  await page.act(async () => { await wait(ms) })
}

/** The core's selection toolbar and its buttons by label. */
export function toolbarButtons(page) {
  const bar = page.document.querySelector('[data-rs-dsh="dsh-core"][data-part="toolbar"]')
  return bar === null || bar.hidden ? [] : [...bar.querySelectorAll('button')]
}

/** The open core popover, or null. */
export const popover = (page) => page.document.querySelector('[data-rs-dsh="dsh-core"][data-part="popover"]')
