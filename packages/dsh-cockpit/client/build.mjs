// Wrap client/src/panel.js in the DSH module-loader factory: client/client.js.
// No bundler: the source is one CommonJS body whose shell requires (react and
// @deepseek-ai/dsh-client-ui-primitives) come from the shell's module table. The core's pure, import-free ES
// modules below are inlined, so the tab and the hub's tree text share one copy
// of their rules. `node client/build.mjs` writes the file; `--check` fails
// when the committed file is not what the sources build.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const LOCAL = ['../../lib/rows.js', '../../lib/present.js', './command-box.js']
const OUT = new URL('./client.js', import.meta.url)

/** An import-free ES module as an expression of its exports. */
function inline(spec) {
  const src = readFileSync(new URL(spec, new URL('./src/', import.meta.url)), 'utf8')
  if (/^\s*import\s/m.test(src)) throw new Error(spec + ' must not import: it is inlined into the browser bundle')
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
  const body = src.replace(/^export\s+/gm, '')
  return '(() => {\n' + body + '\nreturn { ' + names.join(', ') + ' }\n})()'
}

/** The bundle's text, built from the sources. */
export function bundle() {
  const id = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name
  const body = readFileSync(new URL('./src/panel.js', import.meta.url), 'utf8')
  const local = LOCAL.map((s) => JSON.stringify(s) + ': ' + inline(s)).join(',\n')
  return `// Built by client/build.mjs from client/src, lib/rows.js and lib/present.js; do not edit.
window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (shellRequire) => {
var module = { exports: {} }; var exports = module.exports; var __packageId = ${JSON.stringify(id)};
var __local = {
${local}
};
var require = (name) => (Object.prototype.hasOwnProperty.call(__local, name) ? __local[name] : shellRequire(name));
${body}
return module.exports;
} });
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = bundle()
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== out) {
      console.error('client/client.js is not what the sources build: run node client/build.mjs')
      process.exit(1)
    }
  } else {
    writeFileSync(OUT, out)
    console.log(`client/client.js: ${out.length} bytes`)
  }
}
