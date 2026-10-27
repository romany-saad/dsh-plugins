// The namespace rule for every rs-dsh plugin in this repository, checked on
// each plugin's real stylesheet: rules the core-based plugins write sit under
// their own [data-rs-dsh="<plugin>"] root, their highlight names start with
// the plugin's name, and no class any plugin styles is styled by another.
// dsh-cockpit's "dshc-" prefix once caught a sibling's .dshc-bar and turned
// cockpit's progress bar into a floating box; this test is the guard.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import test from 'node:test'
import { createPage, fakePrimitives } from './dom.mjs'

const PACKAGES = new URL('../../', import.meta.url)
const CORE = new URL('../client.js', import.meta.url)

/** The plugins on the core, by package folder, and the plain-CSS ones. */
function plugins() {
  const out = []
  for (const dir of readdirSync(PACKAGES)) {
    const pkgFile = new URL(dir + '/package.json', PACKAGES)
    if (!existsSync(pkgFile)) continue
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    if (pkg.dsh?.client === undefined) continue
    const exp = pkg.exports?.['./client'] ?? './client.js'
    const bundle = new URL(dir + '/' + exp.replace(/^\.\//, ''), PACKAGES)
    out.push({ dir, name: pkg.name, bundle, onCore: dir === 'dsh-core' || pkg.dependencies?.['@rs-dsh/dsh-core'] !== undefined })
  }
  return out
}

/** The stylesheets each core-based plugin registers through core.style(), on a live page. */
function liveStyles(list) {
  const names = createPage({ bundles: [CORE] })
  const exportsList = names.modules[0].exports._internals.UI_EXPORTS
  names.close()
  const page = createPage({ bundles: list.map((p) => p.bundle), primitives: fakePrimitives(exportsList) })
  page.window.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  page.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ threads: [], canWrite: true }) })
  page.start({
    inputTriggers: { registerSource: () => () => {} },
    uiConversation: { userText: { register: () => () => {} } },
    slots: { inject: (_n, make) => make(), register: () => () => {} },
    sessions: { scope: () => undefined },
    conversation: { input: { for: () => null } },
  })
  const sheets = new Map()
  for (const el of page.document.querySelectorAll('style[data-rs-dsh-style]')) sheets.set(el.getAttribute('data-rs-dsh-style'), el.textContent)
  page.dispose()
  page.close()
  return sheets
}

/** Top-level rules of a stylesheet: [selector, body], with @keyframes kept whole. */
function rules(css) {
  const out = []
  let i = 0
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open === -1) break
    const selector = text.slice(i, open).trim()
    let depth = 1, j = open + 1
    while (j < text.length && depth > 0) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++ }
    out.push([selector, text.slice(open + 1, j - 1)])
    i = j
  }
  return out
}

test('every core-based plugin scopes its rules under its own [data-rs-dsh] root', () => {
  const list = plugins().filter((p) => p.onCore)
  assert.ok(list.some((p) => p.dir === 'dsh-threads') && list.some((p) => p.dir === 'dsh-quote'), 'threads and quote are on the core')
  const sheets = liveStyles(list.sort((a, b) => (a.dir === 'dsh-core' ? -1 : b.dir === 'dsh-core' ? 1 : 0)))
  for (const p of list) {
    const plugin = p.dir
    const css = sheets.get(plugin)
    assert.ok(css, plugin + ' registers its stylesheet through the core')
    const root = `[data-rs-dsh="${plugin}"]`
    for (const [selector] of rules(css)) {
      if (selector.startsWith('@keyframes')) {
        assert.match(selector, /@keyframes\s+[a-z]+-/, plugin + ': keyframes carry a plugin prefix: ' + selector)
        continue
      }
      if (selector.startsWith('::highlight(')) {
        assert.ok(selector.startsWith('::highlight(' + plugin), plugin + ': highlight names start with the plugin name: ' + selector)
        continue
      }
      for (const part of selector.split(',').map((s) => s.trim())) {
        // A plugin may style the host's own chip of its own source, and nothing else outside its root.
        if (/^\[data-composer-chip="[a-z]+"\]$/.test(part)) continue
        assert.ok(part.startsWith(root), `${plugin}: rule "${part}" is outside ${root}`)
      }
    }
  }
})

// Inside its root a plugin styles only its own classes: one short prefix per
// plugin, so even a scoped rule never names a class another plugin owns.
const OWN_PREFIX = { 'dsh-core': null, 'dsh-quote': 'q-', 'dsh-threads': 'th-' }

test('a core-based plugin styles only classes with its own prefix', () => {
  const list = plugins().filter((p) => p.onCore).sort((a, b) => (a.dir === 'dsh-core' ? -1 : b.dir === 'dsh-core' ? 1 : 0))
  for (const p of list) assert.ok(p.dir in OWN_PREFIX, `${p.dir} needs an entry in OWN_PREFIX`)
  const sheets = liveStyles(list)
  const prefixes = Object.values(OWN_PREFIX).filter(Boolean)
  assert.equal(new Set(prefixes).size, prefixes.length, 'prefixes are unique')
  for (const [plugin, css] of sheets) {
    for (const [selector] of rules(css)) {
      if (selector.startsWith('@')) continue
      for (const cls of selector.match(/\.[a-zA-Z][\w-]*/g) ?? []) {
        const own = OWN_PREFIX[plugin]
        assert.ok(own !== null && cls.slice(1).startsWith(own), `${plugin} styles ${cls}, which is not ${own ?? 'any'}-prefixed`)
      }
    }
  }
})

test('keyframes and highlight names are unique across plugins', () => {
  const sheets = liveStyles(plugins().filter((p) => p.onCore).sort((a, b) => (a.dir === 'dsh-core' ? -1 : b.dir === 'dsh-core' ? 1 : 0)))
  const seen = new Map()
  for (const [plugin, css] of sheets) {
    for (const name of css.match(/@keyframes\s+[\w-]+|::highlight\([\w-]+\)/g) ?? []) {
      assert.ok(!seen.has(name) || seen.get(name) === plugin, `${name} is used by ${seen.get(name)} and ${plugin}`)
      seen.set(name, plugin)
    }
  }
})

// Plugins not on the core (dsh-cockpit) keep their own prefixed classes; no
// class one plugin styles may be styled by another.
test('no CSS class is styled by two plugins', () => {
  const classesOf = (css) => new Set((css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.[a-zA-Z][\w-]*(?=[^{}]*\{)/g) ?? []).map((c) => c.slice(1)))
  const owner = new Map()
  for (const p of plugins()) {
    const source = readFileSync(p.bundle, 'utf8')
    // Class names in CSS text inside the bundle, roughly: selectors before a "{".
    const css = (source.match(/`[^`]*\{[^`]*`/g) ?? []).join('\n') + (source.match(/'[^'\n]*\{[^'\n]*'/g) ?? []).join('\n')
    for (const cls of classesOf(css)) {
      if (!/^(dsh[a-z]*|q|th)-/.test(cls)) continue
      assert.ok(!owner.has(cls) || owner.get(cls) === p.dir, `.${cls} is styled by ${owner.get(cls)} and ${p.dir}`)
      owner.set(cls, p.dir)
    }
  }
  assert.ok(owner.size > 20, 'read the plugins\' class names')
})
