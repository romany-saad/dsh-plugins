// Task sources: read every task file, normalize each task, refuse the whole
// set on any error so a sync never deletes what it could not read.

import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { SourceError, fail } from './util.js'

export const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const SOURCE_EXTS = new Set(['.json', '.yaml', '.yml', '.js', '.mjs'])
const WEEKDAYS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }

/** A config source path, absolute; a relative one resolves against baseDir. */
export const sourcePath = (src, baseDir) => (isAbsolute(src) ? src : resolve(baseDir ?? process.cwd(), src))

// ---------------------------------------------------------------------------
// Source normalization

function normalizeTime(value, where) {
  if (typeof value !== 'string') fail(where, 'time must be a "HH:mm" or "HH:mm:ss" string')
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/.exec(value.trim())
  if (!m) fail(where, `invalid time "${value}"`)
  const hh = m[1].padStart(2, '0')
  return `${hh}:${m[2]}:${m[3] ?? '00'}${m[4] ?? ''}`
}

function parseDuration(value, where) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string') {
    const m = /^\s*(\d+)\s*(s|sec|m|min|h|d)?\s*$/i.exec(value)
    if (m) {
      const n = Number(m[1])
      const unit = (m[2] ?? 's').toLowerCase()
      return n * ({ s: 1, sec: 1, m: 60, min: 60, h: 3600, d: 86400 })[unit]
    }
  }
  fail(where, `invalid interval "${value}" (use seconds or "15m", "2h", "1d")`)
}

function parseWeekdays(value, where) {
  const list = Array.isArray(value) ? value : String(value).split(/[\s,]+/).filter(Boolean)
  const days = list.map((d) => {
    if (typeof d === 'number') return d
    const key = String(d).toLowerCase().slice(0, 3)
    if (WEEKDAYS[key]) return WEEKDAYS[key]
    const n = Number(d)
    return Number.isInteger(n) ? n : NaN
  }).map((d) => (d === 0 ? 7 : d))
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    fail(where, `invalid weekdays ${JSON.stringify(value)} (ISO 1=Mon..7=Sun or names)`)
  }
  return [...new Set(days)].sort((a, b) => a - b)
}

/** Normalize a schedule declaration into {create, change, sig}. */
export function normalizeSchedule(raw, defaultTz, where) {
  if (typeof raw === 'string') raw = { cron: raw }
  if (!raw || typeof raw !== 'object') fail(where, 'schedule is required')
  const tz = raw.timeZone ?? raw.time_zone ?? raw.tz ?? defaultTz
  const kinds = ['cron', 'daily', 'weekly', 'every', 'at'].filter((k) => raw[k] !== undefined)
  if (kinds.length !== 1) fail(where, 'schedule needs exactly one of cron, daily, weekly, every, at')
  const kind = kinds[0]
  switch (kind) {
    case 'cron': {
      const expression = String(raw.cron).trim().replace(/\s+/g, ' ')
      const cron = { expression, time_zone: tz }
      return { kind, create: { cron }, change: { kind, cron }, spec: { kind, expression, tz } }
    }
    case 'daily': {
      const daily = { time: normalizeTime(raw.daily, where), time_zone: tz }
      return { kind, create: { daily }, change: { kind, daily }, spec: { kind, ...daily } }
    }
    case 'weekly': {
      const w = typeof raw.weekly === 'object' ? raw.weekly : { time: raw.weekly, weekdays: raw.weekdays ?? raw.days }
      const weekly = { time: normalizeTime(w.time, where), time_zone: tz, weekdays: parseWeekdays(w.weekdays ?? w.days, where) }
      return { kind, create: { weekly }, change: { kind, weekly }, spec: { kind, ...weekly } }
    }
    case 'every': {
      const every_seconds = parseDuration(raw.every, where)
      return { kind, create: { every_seconds }, change: { kind, every_seconds }, spec: { kind, every_seconds } }
    }
    case 'at': {
      const at = raw.at instanceof Date ? raw.at.toISOString() : raw.at
      if (typeof at !== 'string' && (typeof at !== 'object' || at === null)) fail(where, 'at must be an ISO date-time')
      return { kind, create: { at }, change: { kind, at }, spec: { kind, at } }
    }
  }
}

export function normalizeModel(raw, where) {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw === 'string') {
    const slash = raw.indexOf('/')
    if (slash <= 0 || slash === raw.length - 1) fail(where, `model "${raw}" must be "provider/model"`)
    return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) }
  }
  if (typeof raw === 'object' && typeof raw.provider === 'string' && typeof raw.model === 'string') {
    return {
      provider: raw.provider,
      model: raw.model,
      ...(raw.reasoningEffort === undefined ? {} : { reasoningEffort: String(raw.reasoningEffort) }),
    }
  }
  fail(where, 'model must be "provider/model" or { provider, model, reasoningEffort? }')
}

/** One task, normalized; a relative cwd resolves against dir, its file's folder. */
export function normalizeTask(raw, defaults, where, dir = process.cwd()) {
  if (!raw || typeof raw !== 'object') fail(where, 'task must be an object')
  const d = { ...defaults, ...(raw.defaults ?? {}) }
  const id = raw.id
  if (typeof id !== 'string' || !TASK_ID_RE.test(id)) fail(where, `task id ${JSON.stringify(id)} must match ${TASK_ID_RE}`)
  where = `${where} [${id}]`
  const title = String(raw.title ?? raw.name ?? id).trim()
  if (!title || title.length > 120) fail(where, 'title must be 1..120 characters')
  if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') fail(where, 'prompt must be a non-empty string')
  const prompt = raw.prompt.trim()
  const cwdRaw = raw.cwd ?? d.cwd
  if (typeof cwdRaw !== 'string' || !cwdRaw) fail(where, 'cwd is required (per task or in defaults)')
  const cwd = isAbsolute(cwdRaw) ? cwdRaw : resolve(dir, cwdRaw)
  const tz = raw.timeZone ?? d.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const schedule = normalizeSchedule(raw.schedule ?? raw.trigger, tz, where)
  const model = normalizeModel(raw.model ?? d.model, where)
  const permission = raw.permission ?? raw.mode ?? d.permission
  if (permission !== undefined && typeof permission !== 'string') fail(where, 'permission must be a preset name')
  const agentPreset = raw.agentPreset ?? raw.preset ?? d.agentPreset
  if (agentPreset !== undefined && typeof agentPreset !== 'string') fail(where, 'agentPreset must be a string')
  const enabled = raw.enabled ?? true
  if (typeof enabled !== 'boolean') fail(where, 'enabled must be a boolean')
  let session = raw.session ?? (raw.freshSession === true ? 'fresh' : undefined) ?? d.session ?? 'persistent'
  if (session !== 'fresh' && session !== 'persistent') fail(where, 'session must be "fresh" or "persistent"')
  return { id, title, prompt, cwd, schedule, model, permission, agentPreset, enabled, session, timeZone: tz, where }
}

// ---------------------------------------------------------------------------
// Source loading (cached by mtime + size)

export function tasksOf(value) {
  if (Array.isArray(value)) return { tasks: value, defaults: {} }
  if (value && typeof value === 'object' && Array.isArray(value.tasks)) {
    return { tasks: value.tasks, defaults: value.defaults ?? {} }
  }
  if (value && typeof value === 'object' && value.id !== undefined) return { tasks: [value], defaults: {} }
  return { tasks: [], defaults: {} }
}

export class SourceLoader {
  constructor(config) {
    this.config = config
    this.cache = new Map() // file -> { key, value }
  }

  async files() {
    const out = []
    for (const src of this.config.sources) {
      const abs = sourcePath(src, this.config.baseDir)
      let info
      try {
        info = await stat(abs)
      } catch (error) {
        // The default folder ($DSH_HOME/automations) may not exist yet: no tasks.
        if (this.config.usesDefaultSources && error?.code === 'ENOENT') continue
        throw new SourceError(`source "${abs}" is not readable: ${error.message}`)
      }
      if (info.isDirectory()) {
        const entries = await readdir(abs, { recursive: true, withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile()) continue
          const base = entry.name
          if (base.startsWith('.') || base.startsWith('_')) continue
          if (!SOURCE_EXTS.has(extname(base))) continue
          out.push(join(entry.parentPath ?? entry.path, base))
        }
      } else {
        out.push(abs)
      }
    }
    return [...new Set(out)].sort()
  }

  async readFileValue(file) {
    const info = await stat(file)
    const key = `${info.mtimeMs}:${info.size}`
    const cached = this.cache.get(file)
    if (cached?.key === key) return cached.value
    const ext = extname(file)
    let value
    try {
      if (ext === '.json') value = JSON.parse(await readFile(file, 'utf8'))
      else if (ext === '.yaml' || ext === '.yml') value = parseYaml(await readFile(file, 'utf8'))
      else {
        const mod = await import(`${pathToFileURL(file).href}?v=${encodeURIComponent(key)}`)
        value = mod.default ?? mod.tasks
        if (typeof value === 'function') value = await value()
      }
    } catch (error) {
      throw new SourceError(`${file}: ${error.message}`)
    }
    this.cache.set(file, { key, value })
    return value
  }

  /** Load every task; throws SourceError on any problem so nothing is deleted. */
  async load() {
    const files = await this.files()
    const tasks = new Map()
    for (const file of files) {
      const { tasks: raws, defaults } = tasksOf(await this.readFileValue(file))
      const merged = { ...(this.config.defaults ?? {}), ...defaults }
      raws.forEach((raw, index) => {
        const task = normalizeTask(raw, merged, `${file}#${index}`, dirname(file))
        const prev = tasks.get(task.id)
        if (prev) fail(task.where, `duplicate task id (also in ${prev.where})`)
        tasks.set(task.id, task)
      })
    }
    for (const task of tasks.values()) {
      try {
        task.cwd = await realpath(task.cwd)
      } catch {
        fail(task.where, `cwd "${task.cwd}" does not exist`)
      }
    }
    return { files, tasks }
  }
}
