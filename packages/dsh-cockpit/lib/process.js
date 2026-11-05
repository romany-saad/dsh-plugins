// Project process maps are untrusted data. The caller supplies policy-aware I/O
// and a YAML codec; this module neither accesses the host filesystem nor executes
// commands, hints, skills, or any other text in the map.
export const PROCESS_PATH = '.dsh/cockpit/process.yml'
export const PROCESS_FORMAT = 'dsh-cockpit.process'
export const PROCESS_VERSION = 1

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import yaml from 'yaml'

export class ProcessError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export const defaultCodec = {
  parse: (text) => yaml.parse(text),
  stringify: (val) => yaml.stringify(val),
}

export function createFsProcessStore(projectRoot = process.cwd()) {
  const filePath = (rel) => join(projectRoot, rel)
  const adapter = {
    async read(rel) {
      const full = filePath(rel)
      try {
        const text = await readFile(full, 'utf8')
        const s = await stat(full)
        return { text, token: `${s.mtimeMs}:${s.size}` }
      } catch (err) {
        if (err.code === 'ENOENT') return { text: null, token: 'absent' }
        throw err
      }
    },
    async write(rel, text, token) {
      const full = filePath(rel)
      if (token !== undefined) {
        let currentToken
        try {
          const s = await stat(full)
          currentToken = `${s.mtimeMs}:${s.size}`
        } catch (err) {
          if (err.code === 'ENOENT') currentToken = 'absent'
          else throw err
        }
        if (currentToken !== token) {
          throw new ProcessError('stale_process', 'Process map changed on disk since last observed')
        }
      }
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, text, 'utf8')
      const s = await stat(full)
      return `${s.mtimeMs}:${s.size}`
    },
  }
  return createProcessStore({ adapter, codec: defaultCodec })
}
const fail = (message) => { throw new ProcessError('invalid_process', message) }
const object = (v, where, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) fail(where + ' must be an object')
  for (const key of Object.keys(v)) if (!keys.includes(key)) fail(where + ': unknown field ' + key)
}
const text = (v, where) => { if (typeof v !== 'string' || !v.trim()) fail(where + ' must be a nonempty string') }
const list = (v, where) => { if (!Array.isArray(v)) fail(where + ' must be an array') }
const strings = (v, where) => { list(v, where); v.forEach((x) => text(x, where)); if (new Set(v).size !== v.length) fail(where + ' contains duplicates') }

/** Validate the complete persisted record; returns a detached JSON-safe copy. */
export function validateProcess(map) {
  object(map, 'process', ['format', 'version', 'revision', 'kinds', 'stages', 'sources', 'changes'])
  if (map.format !== PROCESS_FORMAT || map.version !== PROCESS_VERSION) fail('unknown process format or version')
  if (!Number.isSafeInteger(map.revision) || map.revision < 1) fail('revision must be a positive integer')
  strings(map.kinds, 'kinds')
  if (!map.kinds.length) fail('kinds must not be empty')
  list(map.stages, 'stages')
  if (!map.stages.length) fail('stages must not be empty')
  const ids = new Set()
  for (const stage of map.stages) {
    object(stage, 'stage', ['id', 'exitCheck', 'skills', 'who', 'readyCommand', 'kinds', 'when', 'skipIf'])
    text(stage.id, 'stage.id')
    if (ids.has(stage.id)) fail('duplicate stage id: ' + stage.id)
    ids.add(stage.id)
    text(stage.exitCheck, 'stage.exitCheck')
    strings(stage.skills, 'stage.skills')
    if (!['agent', 'user', 'owner', 'CI', 'subagent'].includes(stage.who)) fail('invalid stage.who')
    for (const key of ['readyCommand', 'when', 'skipIf']) if (stage[key] !== undefined) text(stage[key], 'stage.' + key)
    if (stage.kinds !== undefined) {
      strings(stage.kinds, 'stage.kinds')
      for (const kind of stage.kinds) if (!map.kinds.includes(kind)) fail('unknown kind: ' + kind)
    }
  }
  list(map.sources, 'sources')
  const paths = new Set()
  for (const source of map.sources) {
    object(source, 'source', ['path', 'hash'])
    text(source.path, 'source.path')
    if (source.path.startsWith('/') || source.path.includes('\\') || source.path.split('/').some((part) => !part || part === '.' || part === '..')) fail('source.path must be a relative project path')
    if (paths.has(source.path)) fail('duplicate source path: ' + source.path)
    paths.add(source.path)
    if (typeof source.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(source.hash)) fail('source.hash must be a sha256 digest')
  }
  if (map.changes !== undefined) {
    list(map.changes, 'changes')
    for (const c of map.changes) {
      if (typeof c === 'string') text(c, 'change')
      else if (c && typeof c === 'object') {
        object(c, 'change', ['revision', 'summary', 'at'])
        if (!Number.isSafeInteger(c.revision) || c.revision < 1) fail('change.revision must be positive integer')
        text(c.summary, 'change.summary')
        if (c.at !== undefined) text(c.at, 'change.at')
      } else {
        fail('change item must be string or object')
      }
    }
  }
  const normalized = JSON.parse(JSON.stringify(map))
  // Legacy maps remain readable; proposals and subsequent writes use user.
  for (const stage of normalized.stages) if (stage.who === 'owner') stage.who = 'user'
  return normalized
}

/** Compute human-readable diff between current and next process map. */
export function diffProcess(current, next) {
  if (!current) return ['Initial process map with ' + (next.stages?.length ?? 0) + ' stages']
  const diffs = []
  const oldStages = new Map((current.stages || []).map((s, i) => [s.id, { ...s, index: i }]))
  const newStages = new Map((next.stages || []).map((s, i) => [s.id, { ...s, index: i }]))

  // Stages added
  for (const [id, s] of newStages) {
    if (!oldStages.has(id)) diffs.push('Added stage ' + id + ' (' + (s.who || 'agent') + '): ' + (s.exitCheck || ''))
  }
  // Stages removed
  for (const [id] of oldStages) {
    if (!newStages.has(id)) diffs.push('Removed stage ' + id)
  }
  // Stages modified or reordered
  for (const [id, sNew] of newStages) {
    const sOld = oldStages.get(id)
    if (!sOld) continue
    const changes = []
    if (sOld.exitCheck !== sNew.exitCheck) changes.push('exitCheck: ' + sNew.exitCheck)
    if (sOld.who !== sNew.who) changes.push('who: ' + sNew.who)
    if (JSON.stringify(sOld.skills) !== JSON.stringify(sNew.skills)) changes.push('skills: ' + (sNew.skills || []).join(', '))
    if (sOld.readyCommand !== sNew.readyCommand) changes.push('readyCommand')
    if (sOld.index !== sNew.index) changes.push('reordered to step ' + (sNew.index + 1))
    if (changes.length) diffs.push('Modified stage ' + id + ' (' + changes.join('; ') + ')')
  }
  // Kinds
  if (JSON.stringify(current.kinds) !== JSON.stringify(next.kinds)) {
    diffs.push('Kinds changed: ' + (next.kinds || []).join(', '))
  }
  return diffs.length ? diffs : ['No functional changes']
}

/** Check if any recorded source file has changed or disappeared relative to projectRoot. */
export async function checkSourceDrift(projectRoot, sources = []) {
  if (!Array.isArray(sources) || !sources.length) return []
  const drift = []
  for (const src of sources) {
    if (!src || typeof src.path !== 'string') continue
    const full = join(projectRoot, src.path)
    try {
      const content = await readFile(full)
      const hash = 'sha256:' + createHash('sha256').update(content).digest('hex')
      if (src.hash && hash !== src.hash) {
        drift.push({ path: src.path, expected: src.hash, actual: hash, error: null })
      }
    } catch (err) {
      drift.push({ path: src.path, expected: src.hash, actual: null, error: err.code || err.message })
    }
  }
  return drift
}

/**
 * adapter.read(path) => { text, token } or { text: null, token } for confirmed
 * absence. adapter.write(path, text, token) MUST atomically compare that opaque
 * token (including absence) and reject on stale state. Reads/writes must enforce
 * the active DSH filesystem and observation policies. codec.parse/stringify handle
 * YAML safely (reject duplicate keys, aliases/cycles and unsafe tags).
 *
 * A proposal captures both the map and observed file token. Approval is a
 * separate, explicit application decision, never inferred from a proposal.
 */
export function createProcessStore({ adapter, codec }) {
  const proposals = new WeakMap()
  const byId = new Map()
  let nextId = 1
  async function readSnapshot() {
    const snapshot = await adapter.read(PROCESS_PATH)
    if (!snapshot || !Object.hasOwn(snapshot, 'token') || !(snapshot.text === null || typeof snapshot.text === 'string')) throw new ProcessError('invalid_adapter', 'adapter must return text and a token')
    if (snapshot.text === null) return { map: undefined, token: snapshot.token }
    let parsed
    try { parsed = codec.parse(snapshot.text) } catch (error) { throw new ProcessError('process_unreadable', 'invalid YAML: ' + error.message) }
    try { return { map: validateProcess(parsed), token: snapshot.token } } catch (error) { throw new ProcessError('process_unreadable', error.message) }
  }
  return {
    async read() { return (await readSnapshot()).map },
    async propose(draft) {
      const { map: current, token } = await readSnapshot()
      const next = validateProcess({ ...draft, format: PROCESS_FORMAT, version: PROCESS_VERSION, revision: (current?.revision ?? 0) + 1 })
      const id = String(nextId++)
      const diff = diffProcess(current, next)
      const proposal = { id, current, next, diff }
      const entry = { token, current: JSON.stringify(current), next: JSON.parse(JSON.stringify(next)), diff }
      proposals.set(proposal, entry)
      byId.set(id, entry)
      return proposal
    },
    async save(proposal, { approved } = {}) {
      if (approved !== true) throw new ProcessError('approval_required', 'explicit user approval is required')
      const captured = (proposal && proposals.get(proposal)) || (proposal?.id && byId.get(proposal.id))
      if (!captured) throw new ProcessError('invalid_proposal', 'proposal is unknown or already used')
      if (proposal.id) byId.delete(proposal.id)
      if (typeof proposal === 'object' && proposal !== null) proposals.delete(proposal)
      // Approval must match exactly what the caller presented, including current.
      if (JSON.stringify(proposal.current) !== captured.current || JSON.stringify(proposal.next) !== JSON.stringify(captured.next)) throw new ProcessError('invalid_proposal', 'proposal was changed')
      const diffSummary = captured.diff ? captured.diff.join('; ') : 'Updated process map'
      const isUpdate = captured.next.revision > 1
      const changeEntry = { revision: captured.next.revision, summary: diffSummary, at: new Date().toISOString() }
      const toWrite = isUpdate
        ? { ...captured.next, changes: [...(captured.next.changes || []), changeEntry] }
        : { ...captured.next }
      const serialized = codec.stringify(toWrite)
      await adapter.write(PROCESS_PATH, serialized, captured.token)
      return toWrite
    },
  }
}
