// Test-only: resolve @deepseek-ai/* from the DSH installation, as a profile's
// runtime resolution does. DSH_INSTALL overrides the location.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const dshModules = process.env.DSH_INSTALL
  ? join(process.env.DSH_INSTALL, 'node_modules')
  : join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules')

export const available = existsSync(join(dshModules, '@deepseek-ai', 'dsh-tools'))

if (available) {
  const parent = pathToFileURL(join(dshModules, '..', 'package.json')).href
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('@deepseek-ai/')) return next(specifier, { ...context, parentURL: parent })
      return next(specifier, context)
    },
  })
}
