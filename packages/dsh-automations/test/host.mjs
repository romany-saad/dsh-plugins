// A real cordis Context with in-memory stand-ins for the Host services the
// plugin injects: sessionController, sessionQuery, storageDomain, workspaceRegistry, llm,
// sessionProjections, permissionPresets and commands. The Schedule is DSH's
// own ScheduleService from the pinned @deepseek-ai/dsh-schedule, so a change in
// its API fails these tests instead of a user's sync.
import { Context, Service } from '@deepseek-ai/cordis'
import ScheduleService from '@deepseek-ai/dsh-schedule'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const tempDir = (prefix = 'dsh-automations-') => mkdtemp(join(tmpdir(), prefix))

/** DSH's Schedule, recording each create and edit, so a test can tell a no-op sync from a write. */
class RecordingSchedule extends ScheduleService {
  calls = []
  create(request, ...rest) {
    this.calls.push(['create', request.target?.sessionId, request.title])
    return super.create(request, ...rest)
  }
  edit(request, ...rest) {
    this.calls.push([request.action === 'delete' ? 'delete' : 'update', request.id])
    return super.edit(request, ...rest)
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
    prompts,
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
      const model = { select: (selection) => void selections.push([sessionId, selection]) }
      return { agent: { id: sessionId, session: sessions.get(sessionId), model } }
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
  const storageDomain = createStorageDomain()
  const sessionController = createSessions()
  // Messages the Schedule put straight into a live agent, per Session.
  const liveAgents = new Map() // sessionId -> injected messages
  const liveAgent = (sessionId) => ({
    status: 'running',
    session: { ...sessionController.sessions.get(sessionId), header: { id: sessionId } },
    options: {},
    inject: (message) => void liveAgents.get(sessionId).push(message),
  })
  // A handle on the running Schedule service.
  const schedule = {
    get calls() {
      return ctx.get('schedule').calls
    },
    create: (...args) => ctx.get('schedule').create(...args),
    edit: (...args) => ctx.get('schedule').edit(...args),
    catalog: () => ctx.get('schedule').catalog(),
  }
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
      // What the Schedule itself needs; a stored Session is one the controller stand-in knows.
      // A Session listed in liveAgents is live: the Schedule sends its change notices there.
      c.provide('agents', {
        get: (sessionId) => (liveAgents.has(sessionId) ? liveAgent(sessionId) : undefined),
      })
      c.provide('sessions', { flush: async () => true })
      c.provide('sessionPersistence', {
        stat: async (id) => (sessionController.sessions.has(id) ? { header: {} } : undefined),
      })
      c.provide('storageDomain', storageDomain)
      c.provide('sessionController', sessionController)
      // ctx.sessionQuery.observeSession, as DSH's session query reads a stored Session.
      c.provide('sessionQuery', {
        async observeSession(sessionId) {
          const s = sessionController.sessions.get(sessionId)
          if (!s) throw Object.assign(new Error(`session ${sessionId} not found`), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
          return { header: { id: sessionId, cwd: s.cwd }, events: s.events ?? [], [Symbol.dispose]() {} }
        },
      })
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
  ctx.plugin(RecordingSchedule, {})
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
  return { ctx, schedule, storageDomain, sessionController, workspaceRegistry, archived, commands, run, call, liveAgents, ...agent }
}

/** Config for tests: no watcher, no poll, no status file, no Schedule-change trigger. */
export const quiet = (extra) => ({ watch: false, pollMs: 0, syncOnScheduleChange: false, statusFile: false, ...extra })
