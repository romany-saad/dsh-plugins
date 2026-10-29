// Every rs-dsh plugin's dictionaries, as each registers them on a live page:
// English is the reference; every other language has exactly its keys and
// the same {placeholders}, so no string falls back or loses a value. A new
// language a contributor adds is checked the same way.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import test from 'node:test'
import { createPage, fakePrimitives } from './dom.mjs'

const PACKAGES = new URL('../../', import.meta.url)
const CORE = new URL('../client.js', import.meta.url)

/** Bundles of the core-based plugins, the core first. */
function bundles() {
  const out = []
  for (const dir of readdirSync(PACKAGES)) {
    const pkgFile = new URL(dir + '/package.json', PACKAGES)
    if (!existsSync(pkgFile)) continue
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    if (pkg.dsh?.client === undefined) continue
    if (dir !== 'dsh-core' && pkg.dependencies?.['@rs-dsh/dsh-core'] === undefined) continue
    const exp = pkg.exports?.['./client'] ?? './client.js'
    out.push({ dir, bundle: new URL(dir + '/' + exp.replace(/^\.\//, ''), PACKAGES) })
  }
  return out.sort((a, b) => (a.dir === 'dsh-core' ? -1 : b.dir === 'dsh-core' ? 1 : 0))
}

/** namespace → { locale → dictionary }, as the plugins register them. */
function registered() {
  const probe = createPage({ bundles: [CORE] })
  const names = probe.modules[0].exports._internals.UI_EXPORTS
  probe.close()
  const page = createPage({ bundles: bundles().map((b) => b.bundle), primitives: fakePrimitives(names) })
  page.window.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  page.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ threads: [], canWrite: true }) })
  const dicts = new Map()
  page.start({
    locale: {
      register: (ns, localeOrDicts, dict) => {
        const pairs = typeof localeOrDicts === 'string' ? { [localeOrDicts]: dict } : localeOrDicts
        dicts.set(ns, { ...dicts.get(ns), ...pairs })
        return () => {}
      },
      bind: () => (key) => key,
    },
    inputTriggers: { registerSource: () => () => {} },
    uiConversation: { userText: { register: () => () => {} } },
    slots: { inject: (_n, make) => make(), register: () => () => {} },
    sessions: { scope: () => undefined },
    conversation: { input: { for: () => null } },
    uiWorkspace: { openSession: () => {} },
  })
  page.dispose()
  page.close()
  return dicts
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('every plugin registers English and Chinese', () => {
  const dicts = registered()
  assert.ok(dicts.size >= 3, 'core, threads and quote register dictionaries: ' + [...dicts.keys()])
  for (const [ns, locales] of dicts) {
    assert.ok(locales.en, ns + ' has an English dictionary')
    assert.ok(locales.zh, ns + ' has a Chinese dictionary')
  }
})

test('every language has exactly the English keys, with the same placeholders', () => {
  for (const [ns, locales] of registered()) {
    const en = locales.en
    for (const [locale, dict] of Object.entries(locales)) {
      if (locale === 'en') continue
      assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), `${ns}: ${locale} keys match en`)
      for (const key of Object.keys(en)) {
        assert.equal(typeof dict[key], 'string', `${ns}.${key}: ${locale} is a string`)
        assert.notEqual(dict[key].trim(), '', `${ns}.${key}: ${locale} is not empty`)
        assert.deepEqual(placeholders(dict[key]), placeholders(en[key]), `${ns}.${key}: ${locale} keeps the placeholders of "${en[key]}"`)
      }
    }
  }
})
