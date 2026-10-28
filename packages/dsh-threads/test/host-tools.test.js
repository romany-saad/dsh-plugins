// The replier's file and web tools. Files: a temp directory, a small ctx.fs
// over node:fs, and the real packaged ripgrep behind a ctx.subprocess over
// child_process. Web: a fake ctx.web with dsh-tool-web's real formatters.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { resolveRgPath } from '@deepseek-ai/dsh-tool-fs-search'
import { formatFetchOutput, formatSearchOutput } from '@deepseek-ai/dsh-tool-web'
import { hostTools } from '../index.js'
import { resolveConfig } from '../lib/config.js'
import { fileTools, webTools } from '../lib/host-tools.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-threads-'))
mkdirSync(join(dir, 'src'))
writeFileSync(join(dir, 'src', 'cache.js'), 'export const TTL = 600\n// refresh in the background\n')
writeFileSync(join(dir, 'README.md'), Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')

const nodeFs = {
  async resolve(path, { cwd } = {}) {
    const abs = resolve(cwd ?? '/', path)
    return { targetKey: abs, displayPath: abs }
  },
  async stat(target) {
    try {
      const s = statSync(target.targetKey)
      return { version: String(s.mtimeMs), type: s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other', size: s.size }
    } catch { return undefined }
  },
  async readText(target) { return readFileSync(target.targetKey, 'utf8') },
  async listDir(target) {
    return readdirSync(target.targetKey, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ name: d.name, type: d.isDirectory() ? 'directory' : 'file', target: { targetKey: join(target.targetKey, d.name), displayPath: join(target.targetKey, d.name) } }))
  },
  async writeText() { throw new Error('the replier must never write') },
}

const nodeSubprocess = {
  spawns: [],
  spawn(spec) {
    this.spawns.push(spec)
    const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, signal: spec.signal, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    const done = new Promise((ok) => child.on('close', (exitCode, signal) => ok({ exitCode, signal })))
    return { done, collected: { stdout: { readFrom: () => ({ text: out }) }, stderr: { readFrom: () => ({ text: err }) } } }
  },
}

const signal = new AbortController().signal
const files = fileTools({ fs: nodeFs, cwd: dir, subprocess: nodeSubprocess, rgPath: resolveRgPath })

test('read_file reads numbered lines relative to the working directory, in pages', async () => {
  const out = await files('read_file', { path: 'src/cache.js' }, signal)
  assert.match(out, /cache\.js \(2 lines\)\n1\texport const TTL = 600\n2\t\/\/ refresh in the background$/)
  const page = await files('read_file', { path: 'README.md', offset: 10, limit: 3 }, signal)
  assert.match(page, /\n10\tline 10\n11\tline 11\n12\tline 12\n\(lines 10–12 shown; continue with offset 13\)$/)
  assert.match(await files('read_file', { path: 'README.md' }, signal), /continue with offset 401/)
  await assert.rejects(files('read_file', { path: 'nope.txt' }, signal), /no such file/)
  await assert.rejects(files('read_file', { path: 'src' }, signal), /is a directory/)
})

test('list_dir lists the working directory by default', async () => {
  assert.match(await files('list_dir', {}, signal), /\(2 entries\)\nREADME\.md\nsrc\/$/)
  assert.match(await files('list_dir', { path: 'src' }, signal), /cache\.js/)
})

test('glob and grep run the packaged ripgrep, with no config, in the working directory', async () => {
  assert.equal(await files('glob', { pattern: '**/*.js' }, signal), 'src/cache.js')
  assert.match(await files('glob', { pattern: '*.py' }, signal), /No files match/)
  const hits = await files('grep', { pattern: 'refresh' }, signal)
  assert.match(hits, /^src\/cache\.js:2:\/\/ refresh in the background$/)
  assert.match(await files('grep', { pattern: 'TTL', include: '*.md' }, signal), /No matches/)
  await assert.rejects(files('grep', { pattern: '(' }, signal), /search failed/)
  assert.ok(nodeSubprocess.spawns.every((s) => s.argv[1] === '--no-config' && s.cwd === dir))
  // A path that looks like a flag stays a path.
  await assert.rejects(files('grep', { pattern: 'x', path: '--pre=sh' }, signal), /--pre=sh: IO error/)
})

test('file tools answer undefined for names they do not own', () => {
  assert.equal(files('write_file', {}, signal), undefined)
  assert.equal(files('toString', {}, signal), undefined)
})

test('web tools call ctx.web and label the content as untrusted', async () => {
  const calls = []
  const web = {
    async search(req) { calls.push(['search', req]); return { sources: [{ url: 'https://a.example/', title: 'A', snippet: 'about a' }], truncated: false } },
    async fetch(req) { calls.push(['fetch', req]); return { url: req.url, statusCode: 200, body: { kind: 'text', content: 'hello' }, truncated: false } },
  }
  const run = webTools({ web, format: { formatSearchOutput, formatFetchOutput } })
  assert.match(await run('web_search', { query: 'cache ttl' }, signal), /untrusted data[\s\S]*\[A\]\(https:\/\/a\.example\/\) — about a/)
  assert.match(await run('web_fetch', { url: 'https://a.example/' }, signal), /Fetched https:\/\/a\.example\/ \(HTTP 200\)[\s\S]*untrusted[\s\S]*hello/)
  await assert.rejects(run('web_fetch', { url: 'file:///etc/passwd' }, signal), /only http and https/)
  assert.deepEqual(calls.map((c) => c[0]), ['search', 'fetch'])
})

test('hostTools offers files by default and the web only when enabled', async () => {
  const services = { fs: nodeFs, subprocess: nodeSubprocess, web: {} }
  const names = async (config, get = (n) => services[n]) => (await hostTools({ config: resolveConfig(config), get })({ cwd: dir }))
    .flatMap((t) => t.schemas.map((s) => s.name))
  assert.deepEqual(await names({}), ['read_file', 'list_dir', 'glob', 'grep'])
  assert.deepEqual(await names({ reply: { web: true } }), ['read_file', 'list_dir', 'glob', 'grep', 'web_search', 'web_fetch'])
  assert.deepEqual(await names({ reply: { files: false } }), [])
  // Without a subprocess service there is no search, and without ctx.web no web.
  assert.deepEqual(await names({ reply: { web: true } }, (n) => (n === 'fs' ? nodeFs : undefined)), ['read_file', 'list_dir'])
  assert.throws(() => resolveConfig({ reply: { web: 'yes' } }), /reply\.web must be true or false/)
})
