// A real cordis Context with in-memory stand-ins for the Host services the
// plugin injects: schedule, sessionController, storageDomain,
// workspaceRegistry, llm, sessionProjections, permissionPresets and commands.
import { Context, Service } from '@deepseek-ai/cordis'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const tempDir = (prefix = 'dsh-automations-') => mkdtemp(join(tmpdir(), prefix))

function createSchedule() {
  const records = new Map() // id -> { sessionId, status, record }
  let next = 1
  const fromInput = (input) => {
    if (input.cron) return { kind: 'cron', expression: input.cron.expression, timeZone: input.cron.time_zone }
    if (input.daily) return { kind: 'daily', time: input.daily.time, timeZone: input.daily.time_zone }
    if (input.weekly) return { kind: 'weekly', time: input.weekly.time, timeZone: input.weekly.time_zone, weekdays: input.weekly.weekdays }
    if (input.every_seconds) return { kind: 'every', everySeconds: input.every_seconds }
    if (input.at) return { kind: 'at', scheduledAt: input.at }
    throw Object.assign(new Error('no timing'), { code: 'invalid_rule' })
  }
  const timingOfChange = (change) => fromInput(change)
  return {
    records,
    calls: [],
    async create(sessionId, input) {
      this.calls.push(['create', sessionId, input.title])
      if (input.cron && input.cron.expression.split(' ').length !== 5) {
        throw Object.assign(new Error('bad cron'), { code: 'invalid_rule' })
      }
      const record = { id: `sch-${next++}`, title: input.title, prompt: input.prompt, ...fromInput(input) }
      records.set(record.id, { sessionId, status: 'active', record })
      return record
    },
    async catalog() {
      return [...records.values()].map((r) => ({ ...r.record, sessionId: r.sessionId, status: r.status }))
    },
    async update({ id, title, prompt, change }) {
      this.calls.push(['update', id, title])
      const entry = records.get(id)
      if (!entry) return { code: 'schedule_not_found', message: 'gone' }
      entry.record = { ...entry.record, title, prompt, ...(change ? timingOfChange(change) : {}) }
      return { record: entry.record, updated: true }
    },
    async delete({ id }) {
      this.calls.push(['delete', id])
      records.delete(id)
    },
  }
}

function createStorageDomain() {
  const domains = new Map() // name -> Map per table
  return {
    domains,
    async open(spec) {
      const tables = domains.get(spec.name) ?? new Map()
      domains.set(spec.name, tables)
      return {
        table(name) {
          const rows = tables.get(name) ?? new Map()
          tables.set(name, rows)
          return {
            get: (key) => rows.get(key),
            put: async (key, value) => void rows.set(key, structuredClone(value)),
            delete: async (key) => void rows.delete(key),
            entries: () => [...rows.entries()],
            get size() {
              return rows.size
            },
          }
        },
        async close() {},
      }
    },
  }
}

function createSessions() {
  const sessions = new Map() // id -> { cwd, title, permission }
  const selections = []
  const prompts = []
  return {
    sessions,
    selections,
    agents: { selectForNextRequest: (agent, selection) => selections.push([agent.id, selection]) },
    prompts,
    async inspect(sessionId) {
      const s = sessions.get(sessionId)
      if (!s) throw new Error(`session ${sessionId} not found`)
      return { meta: { cwd: s.cwd }, events: s.events ?? [] }
    },
    async create({ workspaceId, sessionId }) {
      sessions.set(sessionId, { cwd: workspaceId, title: undefined, permission: undefined, events: [] })
      return { sessionId }
    },
    async prompt({ requestId, sessionId, content }) {
      if (this.promptError) throw this.promptError
      const s = sessions.get(sessionId)
      if (s.events.some((e) => e.data.source.rpcId === requestId)) return { accepted: true }
      prompts.push({ requestId, sessionId, text: content[0].text })
      s.events.push({ type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } })
      return { accepted: true }
    },
    async rename({ sessionId, title }) {
      sessions.get(sessionId).title = title
    },
    async resolveAgent(sessionId) {
      return { agent: { id: sessionId, session: sessions.get(sessionId) } }
    },
  }
}

/** Stand-ins for the agent-facing registries: each entry goes with the scope that added it. */
function registries(ctx) {
  const tools = new Map()
  const sections = new Map()
  const skills = new Map()
  const registry = (name, method, map, key = 'name') => class extends Service {
    constructor(c) {
      super(c, name)
    }
    [method](value) {
      return this.ctx.effect(() => {
        map.set(value[key], value)
        return () => map.delete(value[key])
      })
    }
  }
  ctx.plugin(registry('tools', 'register', tools))
  ctx.plugin(registry('systemPrompt', 'section', sections))
  ctx.plugin(registry('skills', 'register', skills))
  return { tools, sections, skills }
}

/** A Context with every service the plugin needs, and handles on their state. */
export function createHost({ defaultWorkspace } = {}) {
  const ctx = new Context()
  const agent = registries(ctx)
  const schedule = createSchedule()
  const storageDomain = createStorageDomain()
  const sessionController = createSessions()
  const archived = []
  const workspaceRegistry = {
    archivedSessionIds: [],
    resolveByPath: async (path) => ({ id: path }),
    list: () => (defaultWorkspace ? [{ id: 'ws-default', path: defaultWorkspace }] : []),
    create: async (path) => ({ id: path }),
    archiveSession: async (id) => void archived.push(id),
    unarchiveSession: async () => {},
  }
  const permissionPresets = {
    resolve(name) {
      if (!['read-only', 'workspace-write', 'danger-full-access'].includes(name)) throw new Error(`unknown preset ${name}`)
    },
    current: (session) => session.permission,
    set: (session, name) => void (session.permission = name),
  }
  const commands = new Map()
  ctx.plugin({
    name: 'host',
    apply(c) {
      c.provide('schedule', schedule)
      c.provide('storageDomain', storageDomain)
      c.provide('sessionController', sessionController)
      c.provide('workspaceRegistry', workspaceRegistry)
      c.provide('llm', { resolveCallConfig: async (sel) => sel })
      c.provide('sessionProjections', { stateOf: () => undefined })
      c.provide('permissionPresets', permissionPresets)
      c.provide('commands', {
        register(command) {
          commands.set(command.name, command)
          return () => commands.delete(command.name)
        },
      })
    },
  })
  const run = async (input = '') => {
    // The commands inject resolves a tick after the plugin's fork settles.
    for (let i = 0; !commands.has('automations') && i < 100; i++) await new Promise((r) => setTimeout(r, 5))
    return commands.get('automations').handler({ rawInput: input })
  }
  /** Call an agent tool as the registry would: the pre-execute gate, then the body. */
  const call = async (name, args = {}) => {
    for (let i = 0; !agent.tools.has(name) && i < 100; i++) await new Promise((r) => setTimeout(r, 5))
    const gate = await ctx.waterfall('tools/pre-execute', { name, arguments: args }, () => Promise.resolve({ kind: 'allow' }))
    if (gate.kind !== 'allow') return { gate }
    return agent.tools.get(name).execute(args, { name, arguments: args, signal: new AbortController().signal })
  }
  return { ctx, schedule, storageDomain, sessionController, workspaceRegistry, archived, commands, run, call, ...agent }
}

/** Config for tests: no watcher, no poll, no status file, no Schedule-change trigger. */
export const quiet = (extra) => ({ watch: false, pollMs: 0, syncOnScheduleChange: false, statusFile: false, ...extra })
