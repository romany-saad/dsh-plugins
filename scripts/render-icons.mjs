#!/usr/bin/env node
// Renders each package's icon.svg (the 36 × 36 glyph DSH shows in Plugins)
// into docs/icon.png, the 512 × 512 tile plugin storefronts show. The tile is
// DSH's plugin-card tile: a light surface, a hairline border, radius 12 on 48,
// and the glyph at 36 on 48, as DSH draws it. Needs google-chrome.
//
//   node scripts/render-icons.mjs [package…]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../packages/', import.meta.url).pathname
const names = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : readdirSync(root).filter((dir) => existsSync(join(root, dir, 'icon.svg')))
const dir = mkdtempSync(join(tmpdir(), 'rs-dsh-icons-'))
try {
  for (const name of names) {
    const svg = readFileSync(join(root, name, 'icon.svg')).toString('base64')
    const html = join(dir, `${name}.html`)
    writeFileSync(html, `<html><body style="margin:0;background:transparent">
<div style="box-sizing:border-box;width:512px;height:512px;border-radius:128px;background:#FFFFFF;border:6px solid #E4E4E7;display:flex;align-items:center;justify-content:center">
<img src="data:image/svg+xml;base64,${svg}" width="384" height="384"></div></body></html>`)
    execFileSync('google-chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
      '--window-size=512,512', `--screenshot=${join(root, name, 'docs/icon.png')}`, `file://${html}`], { stdio: 'ignore' })
    console.log(`packages/${name}/docs/icon.png`)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
