// Wrap client/src/panel.js in the DSH module-loader factory: client/client.js.
// No bundler: the source is one CommonJS body whose requires are all shell
// module-table externals (react, @deepseek-ai/dsh-client-ui-primitives).
import { readFileSync, writeFileSync } from 'node:fs'

const id = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name
const body = readFileSync(new URL('./src/panel.js', import.meta.url), 'utf8')
const out = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
${body}
return module.exports;
} });
`
writeFileSync(new URL('./client.js', import.meta.url), out)
console.log(`client/client.js: ${out.length} bytes for ${id}`)
