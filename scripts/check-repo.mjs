#!/usr/bin/env node
// Repository rules that pnpm test cannot see from inside one package: every
// package is complete, versions agree everywhere a consumer reads them, the
// README's screenshots exist and are all used, and a core-based plugin never
// keeps its own copy of a helper the core shares. Run by `pnpm check` and in
// CI. Exits 1 with one line per broken rule.
//
//   node scripts/check-repo.mjs            the rules for the working tree
//   node scripts/check-repo.mjs --release  also: a tag dsh-<pkg>@<version> it
//                                          needs is on npm before a dependent
//                                          one is tagged (see --tag)
//   node scripts/check-repo.mjs --tag dsh-drafts@0.1.0
//                                          before pushing that tag: its
//                                          dsh-core range is satisfied on npm
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const ROOT = new URL('../', import.meta.url)
const PACKAGES = new URL('packages/', ROOT)
const read = (url) => readFileSync(url, 'utf8')
const problems = []
const fail = (where, what) => problems.push(`${where}: ${what}`)

const packages = readdirSync(PACKAGES)
  .filter((dir) => existsSync(new URL(dir + '/package.json', PACKAGES)))
  .map((dir) => {
    const base = new URL(dir + '/', PACKAGES)
    return { dir, base, pkg: JSON.parse(read(new URL('package.json', base))) }
  })
const versions = new Map(packages.map((p) => [p.dir, p.pkg.version]))

// ------------------------------------------------------------ each package

const REQUIRED = ['README.md', 'DEVELOPING.md', 'CHANGELOG.md', 'LICENSE', 'index.js']
// Helpers rsDshCore shares: a plugin on the core uses them from there.
const CORE_HELPERS = ['oneLine', 'stackChip', 'placeNear', 'eventInside']

for (const { dir, base, pkg } of packages) {
  const at = `packages/${dir}`
  if (pkg.name !== `@rs-dsh/${dir}`) fail(at, `package.json name is ${pkg.name}, expected @rs-dsh/${dir}`)
  for (const file of REQUIRED) if (!existsSync(new URL(file, base))) fail(at, `missing ${file}`)

  // CHANGELOG's newest entry is the current version.
  if (existsSync(new URL('CHANGELOG.md', base))) {
    const top = read(new URL('CHANGELOG.md', base)).match(/^## (\S+)/m)
    if (top === null || top[1] !== pkg.version) fail(at, `CHANGELOG.md's newest entry is ${top?.[1] ?? 'missing'}, package.json is ${pkg.version}`)
  }

  // Every file the package publishes exists.
  for (const file of pkg.files ?? []) if (!existsSync(new URL(file, base))) fail(at, `package.json files lists ${file}, which does not exist`)

  // Screenshots: every README image is in docs/images and every image there is used.
  const readme = existsSync(new URL('README.md', base)) ? read(new URL('README.md', base)) : ''
  const developing = existsSync(new URL('DEVELOPING.md', base)) ? read(new URL('DEVELOPING.md', base)) : ''
  for (const m of readme.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const [, alt, src] = m
    if (alt.trim() === '') fail(at, `README image ${src} has no alt text`)
    const own = src.match(/^https:\/\/raw\.githubusercontent\.com\/romany-saad\/dsh-plugins\/main\/packages\/([^/]+)\/(docs\/images\/[^)]+)$/)
    if (own === null) { fail(at, `README image ${src} is not an absolute raw.githubusercontent.com/.../main URL (CONTRIBUTING.md, Screenshots)`); continue }
    if (own[1] !== dir) continue
    if (!existsSync(new URL(own[2], base))) fail(at, `README shows ${own[2]}, which does not exist`)
  }
  const images = new URL('docs/images/', base)
  if (existsSync(images)) {
    for (const file of readdirSync(images)) {
      if (!file.endsWith('.png')) fail(at, `docs/images/${file} is not a PNG`)
      if (!readme.includes(file) && !developing.includes(file)) fail(at, `docs/images/${file} is in neither README.md nor DEVELOPING.md; delete it or show it`)
    }
  }

  // A plugin on the core keeps no copy of the core's helpers.
  const onCore = pkg.dependencies?.['@rs-dsh/dsh-core'] !== undefined
  const client = pkg.exports?.['./client']
  if (onCore && typeof client === 'string' && existsSync(new URL(client, base))) {
    const source = read(new URL(client, base))
    for (const name of CORE_HELPERS) {
      if (new RegExp(`function\\s+${name}\\s*\\(`).test(source)) fail(at, `defines its own ${name}(); use rsDshCore.${name} instead`)
    }
    if (/Intl\.RelativeTimeFormat/.test(source)) fail(at, 'formats relative time itself; use rsDshCore.ui.relativeTime and the sidebar\'s time.* wording')
    if (!existsSync(new URL('cordis.patch.yml', base)) || !/name: '@rs-dsh\/dsh-core'/.test(read(new URL('cordis.patch.yml', base)))) {
      fail(at, 'is on the core but its cordis.patch.yml does not insert the dsh-core row')
    }
  }
}

// ------------------------------------------------------------ versions everywhere a consumer reads them

const docs = [{ where: 'README.md', text: read(new URL('README.md', ROOT)) }]
for (const { dir, base } of packages) {
  if (existsSync(new URL('README.md', base))) docs.push({ where: `packages/${dir}/README.md`, text: read(new URL('README.md', base)) })
}
for (const { where, text } of docs) {
  for (const m of text.matchAll(/@rs-dsh\/(dsh-[a-z-]+)@(\d[^\s`'&)]*)/g)) {
    const current = versions.get(m[1])
    if (current !== undefined && current !== m[2]) fail(where, `installs ${m[0]}, but ${m[1]} is ${current}`)
  }
  for (const m of text.matchAll(/#(dsh-[a-z-]+)@(\d[^\s`'&)]*)&path/g)) {
    const current = versions.get(m[1])
    if (current !== undefined && current !== m[2]) fail(where, `pins the tag ${m[1]}@${m[2]}, but ${m[1]} is ${current}`)
  }
}

// The root README lists every package, at its current version.
const rootReadme = docs[0].text
for (const [dir, version] of versions) {
  const row = rootReadme.split('\n').find((line) => line.startsWith(`| [\`@rs-dsh/${dir}\`]`))
  if (row === undefined) { fail('README.md', `the package table has no row for @rs-dsh/${dir}`); continue }
  const status = row.split('|').at(-2)?.trim()
  if (status !== version) fail('README.md', `the package table says ${dir} is ${status}, package.json says ${version}`)
}

// The shared guard tests know every core-based plugin's class prefix.
const namespaceTest = read(new URL('dsh-core/test/namespace.test.js', PACKAGES))
for (const { dir, pkg } of packages) {
  if (pkg.dependencies?.['@rs-dsh/dsh-core'] === undefined) continue
  if (!new RegExp(`'${dir}':\\s*'[a-z]+-'`).test(namespaceTest)) fail('packages/dsh-core/test/namespace.test.js', `OWN_PREFIX has no class prefix for ${dir}`)
}

// ------------------------------------------------------------ before a tag is pushed

const tagAt = process.argv.indexOf('--tag')
if (tagAt !== -1) {
  const tag = process.argv[tagAt + 1] ?? ''
  const m = tag.match(/^(dsh-[a-z-]+)@(.+)$/)
  const target = m === null ? undefined : packages.find((p) => p.dir === m[1])
  if (target === undefined) fail(tag, 'names no package under packages/')
  else if (target.pkg.version !== m[2]) fail(tag, `package.json version is ${target.pkg.version}`)
  else {
    // The publish workflow rewrites workspace:^ to ^<current core>; that core must be on npm first.
    for (const name of Object.keys(target.pkg.dependencies ?? {})) {
      if (!name.startsWith('@rs-dsh/')) continue
      const dep = packages.find((p) => p.pkg.name === name)
      if (dep === undefined) continue
      try {
        execFileSync('npm', ['view', `${name}@${dep.pkg.version}`, 'version'], { stdio: ['ignore', 'pipe', 'ignore'] })
      } catch (_) {
        fail(tag, `needs ${name}@${dep.pkg.version} on npm first: push the tag ${dep.dir}@${dep.pkg.version} and wait for its publish run`)
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => '✖ ' + p).join('\n'))
  console.error(`\n${problems.length} repository rule${problems.length === 1 ? '' : 's'} broken. The rules: CONTRIBUTING.md and .agents/skills/dsh-plugin-dev/SKILL.md.`)
  process.exit(1)
}
console.log(`✔ repository rules hold for ${packages.length} packages`)
