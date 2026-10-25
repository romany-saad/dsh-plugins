// Wrap client/src/panel.js in the DSH module-loader factory: client/client.js.
// No bundler: the source is one CommonJS body whose requires are shell
// module-table externals (react, @deepseek-ai/dsh-client-ui-primitives) or
// the core's pure, import-free ES modules below, inlined so the browser, the
// hub's tree text and the chat card titles share one copy of their rules.
import { readFileSync, writeFileSync } from 'node:fs'

const LOCAL = ['../../lib/rows.js', '../../lib/present.js', './command-box.js']

/** An import-free ES module as an expression of its exports. */
function inline(spec) {
  const src = readFileSync(new URL(spec, new URL('./src/', import.meta.url)), 'utf8')
  if (/^\s*import\s/m.test(src)) throw new Error(spec + ' must not import: it is inlined into the browser bundle')
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
  const body = src.replace(/^export\s+/gm, '')
  return '(() => {\n' + body + '\nreturn { ' + names.join(', ') + ' }\n})()'
}

const id = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name
const body = readFileSync(new URL('./src/panel.js', import.meta.url), 'utf8')
const local = LOCAL.map((s) => JSON.stringify(s) + ': ' + inline(s)).join(',\n')
const out = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (shellRequire) => {
var module = { exports: {} }; var exports = module.exports;
var __local = {
${local}
};
var require = (name) => (Object.prototype.hasOwnProperty.call(__local, name) ? __local[name] : shellRequire(name));
${body}
return module.exports;
} });
`
writeFileSync(new URL('./client.js', import.meta.url), out)
console.log(`client/client.js: ${out.length} bytes for ${id}`)
