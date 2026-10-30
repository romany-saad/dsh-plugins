// @rs-dsh/dsh-automations: the DSH host plugin. Publishes automation tasks
// (Host Schedule records) from task files. The files are the single source of
// truth: every sync reconciles the Host so that each declared task exists with
// exactly the declared schedule, title, prompt, model, permission preset,
// agent preset and working directory.
//
// Cost: one stat per task file (a file is parsed again only when its mtime or
// size changes), one Schedule catalog read per sync, and per task one hash
// comparison against the persisted applied state. It writes only when a
// declaration changed or the Host record drifted from what it last applied.
//
// Reliability: every step is idempotent and its outcome is persisted at once;
// each task owns a Session with a derived id, so a crash between "create" and
// "save state" re-adopts instead of duplicating; any source error aborts the
// whole sync before anything is deleted. The rules are in DEVELOPING.md.

import { mkdir, stat, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { dirname } from 'node:path'
import { dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { STATE_VERSION, domainSpec, parseDelivery, recordOf, runsDomainSpec, timingSig } from './lib/records.js'
import { SourceLoader, sourcePath } from './lib/source.js'
import { derivedSessionId, errorText, hash } from './lib/util.js'

export const name = 'dsh-automations'
export const inject = ['schedule', 'sessionController', 'storageDomain', 'workspaceRegistry', 'llm', 'sessionProjections']

const INPUT_ERROR_CODES = new Set([
  'invalid_prompt', 'invalid_selector', 'invalid_rule', 'invalid_time_zone',
  'not_future', 'time_out_of_range', 'frequency_too_high', 'subagent_session',
])
const LOG = 'dsh-automations'

/** The config with its defaults; exported for tests. */
export function resolveConfig(config = {}) {
  const usesDefaultSources = config.sources === undefined
  const cfg = {
    debounceMs: 750,
    watch: true,
    pollMs: 10000,
    syncOnScheduleChange: true,
    sessionTitlePrefix: '⏱ ',
    archiveRemovedSessions: false,
    allowEmpty: false,
    keepRunSessions: 10,
    runRetryMs: 30000,
    runMaxAttempts: 5,
    ...config,
    baseDir: config.baseDir || resolveDshHome(),
    sources: usesDefaultSources ? ['automations'] : config.sources,
    defaults: config.defaults ?? {},
  }
  if (!Array.isArray(cfg.sources) || cfg.sources.some((s) => typeof s !== 'string' || !s)) {
    throw new Error(`${LOG}: sources must be a list of paths`)
  }
  cfg.usesDefaultSources = usesDefaultSources
  cfg.statusFile = cfg.statusFile === false ? undefined
    : (cfg.statusFile || dshHomePath('data', 'dsh-automations', 'status.json'))
  return cfg
}

// ---------------------------------------------------------------------------
// Plugin

export function apply(ctx, config) {
  const cfg = resolveConfig(config ?? {})
  const log = ctx.logger ?? console
  const statusFile = cfg.statusFile
  const loader = new SourceLoader(cfg)
  let disposed = false
  let domain
  let running = undefined
  let rerun = false
  let lastReport = { at: undefined, ok: undefined, summary: 'not synced yet' }

  // ---- domain lifecycle (retry: an HMR predecessor may still be closing) ----
  async function openDomain(spec) {
    for (let attempt = 0; ; attempt++) {
      try {
        const opened = await ctx.storageDomain.open(spec)
        if (disposed) {
          await opened.close()
          return undefined
        }
        return opened
      } catch (error) {
        if (error?.code !== 'already-open' || attempt >= 20 || disposed) throw error
        await new Promise((r) => setTimeout(r, 250))
      }
    }
  }
  let runsDomain
  // Declared settings per managed Session, used at delivery time; loaded from
  // the persisted state first so deliveries racing the first sync are handled.
  const declared = new Map() // sessionId -> snapshot
  const domainReady = openDomain(domainSpec).then((d) => {
    domain = d
    if (d) for (const [, s] of d.table('tasks').entries()) if (s.sessionId && s.declared) declared.set(s.sessionId, s.declared)
    return d
  })
  const runsReady = openDomain(runsDomainSpec).then((d) => (runsDomain = d))
  domainReady.catch((error) => log.warn?.(`dsh-automations: state unavailable: ${errorText(error)}`))
  runsReady.catch((error) => log.warn?.(`dsh-automations: run queue unavailable: ${errorText(error)}`))
  ctx.effect(() => () => {
    disposed = true
    domainReady.then((d) => d?.close()).catch(() => {})
    runsReady.then((d) => d?.close()).catch(() => {})
  }, 'dsh-automations.domain')

  const table = () => domain.table('tasks')
  const putState = (state) => table().put(state.taskId, state)

  // ---- side-effect helpers --------------------------------------------------

  async function sessionExists(sessionId) {
    try {
      const inspection = await ctx.sessionController.inspect(sessionId)
      return inspection.meta
    } catch (error) {
      if (/not found/i.test(String(error?.message))) return undefined
      throw error
    }
  }

  async function ensureSession(task, sessionKey) {
    const sessionId = derivedSessionId(task.id, sessionKey)
    const meta = await sessionExists(sessionId)
    if (meta) {
      if (meta.cwd !== task.cwd) throw new Error(`session ${sessionId} belongs to ${meta.cwd}, expected ${task.cwd}`)
      return { sessionId, created: false }
    }
    const workspace = (await ctx.workspaceRegistry.resolveByPath(task.cwd)) ?? (await ctx.workspaceRegistry.create(task.cwd))
    const created = await ctx.sessionController.create({
      workspaceId: workspace.id,
      sessionId,
      ...(task.agentPreset === undefined ? {} : { agentPreset: task.agentPreset }),
    })
    if (cfg.sessionTitlePrefix !== false) {
      try {
        await ctx.sessionController.rename({ sessionId: created.sessionId, title: `${cfg.sessionTitlePrefix}${task.title}` })
      } catch (error) {
        log.warn?.(`dsh-automations: could not title session for ${task.id}: ${errorText(error)}`)
      }
    }
    return { sessionId: created.sessionId, created: true }
  }

  async function liveAgent(sessionId) {
    const result = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in result) throw result.error
    return result.agent
  }

  // Validated, Session-local model selections keyed by "provider/model/effort".
  const resolvedModels = new Map()
  async function resolveModel(model) {
    const key = hash(model)
    if (!resolvedModels.has(key)) {
      const resolved = await ctx.llm.resolveCallConfig({
        provider: model.provider,
        model: model.model,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
      })
      resolvedModels.set(key, {
        provider: resolved.provider,
        model: resolved.model,
        ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
      })
    }
    return resolvedModels.get(key)
  }

  const sameSelection = (a, b) => !!a && !!b && a.provider === b.provider && a.model === b.model &&
    String(a.reasoningEffort ?? '') === String(b.reasoningEffort ?? '')

  /**
   * Select a model for one Session only. The public `selectModel` Remote also
   * rewrites the profile's global default model, which must not happen here,
   * so the controller's Session-local selection is used directly.
   */
  function selectSessionModel(agent, selection) {
    const internals = ctx.sessionController.agents
    if (typeof internals?.selectForNextRequest !== 'function') {
      throw new Error('this DSH version exposes no Session-local model selection')
    }
    const state = ctx.sessionProjections.stateOf(agent.session, 'modelSelection')
    const effective = state ? (state.pending ?? state.lastUsed) : undefined
    if (sameSelection(effective, selection)) return false
    internals.selectForNextRequest(agent, selection)
    return true
  }

  async function applyModel(sessionId, model) {
    const selection = await resolveModel(model)
    selectSessionModel(await liveAgent(sessionId), selection)
  }

  function presetsService(preset) {
    const presets = ctx.get('permissionPresets')
    if (!presets) throw new Error('permission presets are not available in this composition')
    presets.resolve(preset) // throws on unknown names
    return presets
  }

  async function applyPermission(sessionId, preset) {
    const presets = presetsService(preset)
    const agent = await liveAgent(sessionId)
    if (presets.current(agent.session) !== preset) presets.set(agent.session, preset)
  }

  function enforceSettings(agent, want) {
    if (want.model) {
      const selection = resolvedModels.get(hash(want.model))
      if (selection && selectSessionModel(agent, selection)) log.info?.(`dsh-automations: applied model for ${want.taskId}`)
    }
    if (want.permission) {
      const presets = presetsService(want.permission)
      if (presets.current(agent.session) !== want.permission) presets.set(agent.session, want.permission)
    }
  }

  // ---- delivery handling ------------------------------------------------------
  //
  // persistent: the scheduled message runs in the task's own Session; its
  //   declared model and permission are re-asserted on arrival (synchronous, so
  //   they land before the step that consumes the message).
  // fresh: the task's own Session is only the Schedule's anchor. On arrival the
  //   run is queued durably (keyed by the message id); the anchor's step is then
  //   rejected so the model never runs there, and the run starts in a new
  //   Session with the declared preset, model, and permission.
  const queued = new Map() // message id -> Promise of the durable run record
  ctx.on('agent/inbox/inserted', function (payload) {
    const agent = payload?.agent ?? this
    const message = payload?.message
    if (!agent?.session || message?.source?.kind !== 'schedule') return
    const want = declared.get(agent.id)
    if (!want) return
    if (want.session === 'fresh') {
      if (!queued.has(message.id)) queued.set(message.id, queueRun(want, message))
      return
    }
    try {
      enforceSettings(agent, want)
    } catch (error) {
      log.warn?.(`dsh-automations: cannot enforce settings for ${want.taskId}: ${errorText(error)}`)
    }
  })

  ctx.on('agent/pre-step', async function (payload, next) {
    const agent = payload?.agent ?? this
    // A restored anchor can wake before the persisted declarations are loaded.
    if (!domain && (payload?.messages ?? []).some((m) => m?.source?.kind === 'schedule')) await domainReady.catch(() => {})
    const want = agent ? declared.get(agent.id) : undefined
    const scheduled = want?.session === 'fresh'
      ? (payload.messages ?? []).filter((m) => m?.source?.kind === 'schedule')
      : []
    if (scheduled.length === 0) return next()
    // Make sure every intercepted run is durable before its message is dropped.
    for (const message of scheduled) {
      if (!queued.has(message.id)) queued.set(message.id, queueRun(want, message))
      await queued.get(message.id)
    }
    const dropped = new Set(scheduled.map((m) => m.id))
    const others = payload.messages.filter((m) => !dropped.has(m.id))
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (others.length === 0) return { kind: 'reject' }
    return { ...decision, messages: decision.messages.filter((m) => !dropped.has(m.id)) }
  }, { prepend: true })

  async function queueRun(want, message) {
    const runs = (await runsReady)?.table('runs')
    if (!runs) throw new Error('run queue unavailable')
    const runId = String(message.id)
    if (!runs.get(runId) && !(await runsReady).table('history').get(want.taskId)?.sessions.some((s) => s.runId === runId)) {
      const { prompt, occurrenceAt } = parseDelivery(message)
      const record = {
        v: STATE_VERSION,
        runId,
        runSessionId: derivedSessionId(want.taskId, `run:${runId}`),
        task: { ...want, prompt: prompt ?? want.prompt },
        occurrenceAt: occurrenceAt ?? new Date().toISOString(),
        attempts: 0,
      }
      await runs.put(runId, record)
    }
    setImmediate(() => startRun(runId))
  }

  const activeRuns = new Set()
  const retryTimers = new Set()
  ctx.effect(() => () => {
    for (const t of retryTimers) clearTimeout(t)
  }, 'dsh-automations.run-retries')

  async function startRun(runId) {
    if (disposed || activeRuns.has(runId)) return
    activeRuns.add(runId)
    try {
      await executeRun(runId)
    } finally {
      activeRuns.delete(runId)
    }
  }

  async function executeRun(runId) {
    const d = await runsReady
    const runs = d?.table('runs')
    const record = runs?.get(runId)
    if (!record) return
    const { task, runSessionId } = record
    try {
      // 1. The run's Session (deterministic id: a retry finds the same one).
      const meta = await sessionExists(runSessionId)
      let started = false
      if (meta) {
        const inspection = await ctx.sessionController.inspect(runSessionId)
        started = inspection.events.some((e) => e.type === 'user/message' && e.data?.source?.rpcId === runId)
      }
      if (!started) {
        if (!meta) {
          const workspace = (await ctx.workspaceRegistry.resolveByPath(task.cwd)) ?? (await ctx.workspaceRegistry.create(task.cwd))
          const created = await ctx.sessionController.create({
            workspaceId: workspace.id,
            sessionId: runSessionId,
            ...(task.agentPreset === undefined ? {} : { agentPreset: task.agentPreset }),
          })
          if (created.sessionId !== runSessionId) throw new Error(`run Session was created as ${created.sessionId}`)
          const when = new Date(record.occurrenceAt).toLocaleString('sv-SE', { timeZone: task.timeZone, hour12: false }).slice(0, 16)
          await ctx.sessionController.rename({ sessionId: runSessionId, title: `${cfg.sessionTitlePrefix || ''}${task.title} · ${when}` })
            .catch((error) => log.warn?.(`dsh-automations: could not title run ${runId}: ${errorText(error)}`))
        }
        // 2. Declared model and permission, then 3. the prompt (idempotent by request id).
        if (task.model) await resolveModel(task.model)
        enforceSettings(await liveAgent(runSessionId), task)
        const controller = new AbortController()
        await ctx.sessionController.prompt({
          requestId: runId,
          sessionId: runSessionId,
          mode: 'queue',
          content: [{ type: 'text', text: task.prompt }],
        }, controller.signal)
      }
      // 4. Done: move the run to history and retire old run Sessions.
      const history = d.table('history')
      const prev = history.get(task.taskId)?.sessions ?? []
      const sessions = [{ runId, sessionId: runSessionId, occurrenceAt: record.occurrenceAt, startedAt: new Date().toISOString() },
        ...prev.filter((s) => s.runId !== runId)]
      const keep = Math.max(1, cfg.keepRunSessions)
      await history.put(task.taskId, { v: STATE_VERSION, sessions: sessions.slice(0, keep) })
      await runs.delete(runId)
      queued.delete(runId)
      log.info?.(`dsh-automations: ${task.taskId} run started in fresh session ${runSessionId}`)
      for (const old of sessions.slice(keep)) {
        if (ctx.agents?.get(old.sessionId)?.status === 'running') continue
        await ctx.workspaceRegistry.archiveSession(old.sessionId)
          .catch((error) => log.warn?.(`dsh-automations: could not archive ${old.sessionId}: ${errorText(error)}`))
      }
    } catch (error) {
      const attempts = (record.attempts ?? 0) + 1
      const message = errorText(error)
      if (attempts >= cfg.runMaxAttempts) {
        log.warn?.(`dsh-automations: ${task.taskId} run ${runId} abandoned after ${attempts} attempts: ${message}`)
        await runs.delete(runId).catch(() => {})
        queued.delete(runId)
        return
      }
      await runs.put(runId, { ...record, attempts, lastError: message }).catch(() => {})
      log.warn?.(`dsh-automations: ${task.taskId} run ${runId} failed (attempt ${attempts}), retrying: ${message}`)
      const t = setTimeout(() => {
        retryTimers.delete(t)
        startRun(runId)
      }, cfg.runRetryMs * attempts)
      retryTimers.add(t)
    }
  }

  // Resume runs interrupted by a restart.
  runsReady.then((d) => {
    if (!d) return
    for (const [runId] of d.table('runs').entries()) setTimeout(() => startRun(runId), 2000)
  }).catch(() => {})

  async function unarchiveIfNeeded(sessionId) {
    if (ctx.workspaceRegistry.archivedSessionIds?.includes(sessionId)) {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
      return true
    }
    return false
  }

  // ---- reconcile one task ---------------------------------------------------

  async function reconcileTask(task, state, catalog, report) {
    const sessionKey = hash({ cwd: task.cwd, agentPreset: task.agentPreset ?? null })
    const scheduleHash = hash({ title: task.title, prompt: task.prompt, schedule: task.schedule.spec, enabled: task.enabled })
    const modelKey = task.model ? hash(task.model) : null
    const save = async (patch) => {
      Object.assign(state, patch)
      await putState(state)
    }
    const actions = []

    // A disabled task that was never published needs no Session at all.
    if (!task.enabled && !state.sessionId) {
      if (state.scheduleHash !== scheduleHash) await save({ scheduleHash })
      return actions
    }

    // 1. Session (deterministic id => crash safe; a new key means a new Session).
    if (state.sessionKey !== sessionKey || !state.sessionId) {
      const previousSession = state.sessionId
      const { sessionId, created } = await ensureSession(task, sessionKey)
      if (previousSession && previousSession !== sessionId && state.scheduleId) {
        await ctx.schedule.delete({ sessionId: previousSession, id: state.scheduleId })
        actions.push('moved to new session')
        state.scheduleId = undefined
      }
      await save({ sessionId, sessionKey, modelKey: null, permission: null, scheduleId: state.scheduleId, timingSig: undefined, scheduleHash: undefined })
      if (created) actions.push('session created')
    }
    const sessionId = state.sessionId
    if (task.enabled && (await unarchiveIfNeeded(sessionId))) actions.push('session unarchived')
    if (task.model) await resolveModel(task.model) // validates and warms the run-time cache
    const snapshot = {
      taskId: task.id, title: task.title, prompt: task.prompt, cwd: task.cwd, timeZone: task.timeZone,
      session: task.session, model: task.model, permission: task.permission, agentPreset: task.agentPreset,
    }
    declared.set(sessionId, snapshot)
    // A renamed task retitles its Session; a new Session was titled on creation.
    const previousTitle = state.declared?.title
    if (hash(state.declared ?? null) !== hash(snapshot)) await save({ declared: snapshot })
    if (previousTitle !== undefined && previousTitle !== task.title && cfg.sessionTitlePrefix !== false) {
      try {
        await ctx.sessionController.rename({ sessionId, title: `${cfg.sessionTitlePrefix}${task.title}` })
        actions.push('session retitled')
      } catch (error) {
        log.warn?.(`dsh-automations: could not retitle the session of ${task.id}: ${errorText(error)}`)
      }
    }

    // 2. Model and permission (applied only when the declared value changed).
    //    A fresh-session task applies them to each run Session instead.
    if (task.session === 'fresh') {
      if (state.modelKey !== null || state.permission !== null) await save({ modelKey: null, permission: null })
    } else if (modelKey && state.modelKey !== modelKey) {
      await applyModel(sessionId, task.model)
      await save({ modelKey })
      actions.push(`model ${task.model.provider}/${task.model.model}`)
    }
    if (task.session !== 'fresh' && task.permission && state.permission !== task.permission) {
      await applyPermission(sessionId, task.permission)
      await save({ permission: task.permission })
      actions.push(`permission ${task.permission}`)
    }

    // 3. Schedule.
    let entry = state.scheduleId ? catalog.byId.get(state.scheduleId) : undefined
    if (entry && entry.sessionId !== sessionId) entry = undefined

    if (!task.enabled) {
      if (entry) {
        await ctx.schedule.delete({ sessionId, id: entry.id })
        actions.push('disabled (schedule deleted)')
      }
      if (state.scheduleId || state.scheduleHash !== scheduleHash) {
        await save({ scheduleId: undefined, timingSig: undefined, scheduleHash })
      }
      return actions
    }

    // Adopt an orphan created right before a crash (dedicated Session + same title).
    if (!entry) {
      entry = catalog.bySession.get(sessionId)?.find((e) => e.status === 'active' && e.title === task.title && !catalog.owned.has(e.id))
      if (entry) {
        await save({ scheduleId: entry.id, timingSig: undefined })
        actions.push('adopted existing schedule')
      }
    }

    const create = async () => {
      if (state.error?.hash === scheduleHash) throw Object.assign(new Error(state.error.message), { cached: true })
      try {
        const record = await ctx.schedule.create(sessionId, { title: task.title, prompt: task.prompt, ...task.schedule.create })
        catalog.owned.add(record.id)
        await save({ scheduleId: record.id, timingSig: timingSig(record), scheduleHash, error: undefined })
        actions.push('schedule created')
      } catch (error) {
        if (INPUT_ERROR_CODES.has(error?.code)) await save({ error: { hash: scheduleHash, message: errorText(error) } })
        throw error
      }
    }

    if (!entry) {
      if (state.scheduleId) actions.push('schedule was missing')
      await create()
      return actions
    }

    if (entry.status === 'inactive') {
      // A finished one-shot stays finished unless its declaration changed.
      if (state.scheduleHash === scheduleHash) return actions
      await ctx.schedule.delete({ sessionId, id: entry.id })
      await save({ scheduleId: undefined, timingSig: undefined })
      await create()
      return actions
    }

    const timingDrift = state.timingSig !== timingSig(entry)
    const contentDrift = entry.title !== task.title || entry.prompt !== task.prompt
    const declarationChanged = state.scheduleHash !== scheduleHash
    if (!timingDrift && !contentDrift && !declarationChanged) return actions

    let expected = recordOf(entry)
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await ctx.schedule.update({
        sessionId,
        id: entry.id,
        expected,
        title: task.title,
        prompt: task.prompt,
        ...(timingDrift || declarationChanged ? { change: task.schedule.change } : {}),
      })
      if ('record' in result) {
        await save({ timingSig: timingSig(result.record), scheduleHash, error: undefined })
        if (result.updated) actions.push('schedule updated')
        return actions
      }
      if (result.code === 'schedule_conflict') {
        const fresh = (await ctx.schedule.catalog()).find((e) => e.id === entry.id)
        if (!fresh) break
        expected = recordOf(fresh)
        continue
      }
      if (result.code === 'schedule_ended' || result.code === 'schedule_not_found') break
      if (INPUT_ERROR_CODES.has(result.code)) await save({ error: { hash: scheduleHash, message: `${result.code}: ${result.message}` } })
      throw Object.assign(new Error(result.message ?? result.code), { code: result.code })
    }
    // Could not update in place: replace the schedule.
    await ctx.schedule.delete({ sessionId, id: entry.id }).catch(() => {})
    await save({ scheduleId: undefined, timingSig: undefined })
    await create()
    return actions
  }

  // ---- full sync --------------------------------------------------------------

  async function syncOnce(reason) {
    await domainReady
    if (disposed || !domain) return lastReport
    const started = Date.now()
    const report = { reason, changed: [], removed: [], errors: [], unchanged: 0 }

    let source
    try {
      const fp = await sourceFingerprint()
      source = await loader.load()
      fingerprint = fp.value
      rearmWatchers(fp.files).catch(() => {})
    } catch (error) {
      report.errors.push(`source: ${error.message}`)
      return finish(report, started, false, 'aborted: source error, nothing changed')
    }
    if (source.tasks.size === 0 && table().size > 0 && !cfg.allowEmpty) {
      report.errors.push('no tasks found in sources while managed tasks exist; set allowEmpty: true to remove all')
      return finish(report, started, false, 'aborted: empty source')
    }

    const entries = await ctx.schedule.catalog()
    const catalog = { byId: new Map(), bySession: new Map(), owned: new Set() }
    for (const e of entries) {
      catalog.byId.set(e.id, e)
      const list = catalog.bySession.get(e.sessionId) ?? []
      list.push(e)
      catalog.bySession.set(e.sessionId, list)
    }
    for (const [, s] of table().entries()) if (s.scheduleId) catalog.owned.add(s.scheduleId)

    for (const task of source.tasks.values()) {
      const state = structuredClone(table().get(task.id) ?? { v: STATE_VERSION, taskId: task.id })
      try {
        const actions = await reconcileTask(task, state, catalog, report)
        if (actions.length) report.changed.push(`${task.id}: ${actions.join(', ')}`)
        else report.unchanged++
      } catch (error) {
        report.errors.push(`${task.id}: ${error.cached ? '(unchanged, previously rejected) ' : ''}${errorText(error)}`)
      }
    }

    // Tasks removed from source.
    for (const [taskId, state] of [...table().entries()]) {
      if (source.tasks.has(taskId)) continue
      try {
        if (state.scheduleId && catalog.byId.get(state.scheduleId)?.sessionId === state.sessionId) {
          await ctx.schedule.delete({ sessionId: state.sessionId, id: state.scheduleId })
        }
        if (cfg.archiveRemovedSessions && state.sessionId) {
          await ctx.workspaceRegistry.archiveSession(state.sessionId, { stopActivity: true }).catch(() => {})
        }
        await table().delete(taskId)
        report.removed.push(taskId)
      } catch (error) {
        report.errors.push(`${taskId} (removal): ${errorText(error)}`)
      }
    }

    return finish(report, started, report.errors.length === 0)
  }

  // Status writes run one after another, so an older report never overwrites a newer one.
  let statusWrite = Promise.resolve()
  async function finish(report, started, ok, note) {
    const parts = []
    if (note) parts.push(note)
    parts.push(`${report.changed.length} changed, ${report.removed.length} removed, ${report.unchanged} unchanged, ${report.errors.length} errors (${Date.now() - started} ms)`)
    lastReport = { at: new Date().toISOString(), ok, summary: parts.join('; '), ...report }
    if (statusFile) {
      const text = `${JSON.stringify(lastReport, null, 2)}\n`
      statusWrite = statusWrite
        .then(() => mkdir(dirname(statusFile), { recursive: true }))
        .then(() => writeFile(statusFile, text))
        .catch((error) => log.warn?.(`dsh-automations: cannot write ${statusFile}: ${error.message}`))
      await statusWrite
    }
    const level = ok ? 'info' : 'warn'
    if (report.changed.length || report.removed.length || report.errors.length) {
      log[level]?.(`dsh-automations (${report.reason}): ${lastReport.summary}` +
        [...report.changed, ...report.removed.map((r) => `${r}: removed`), ...report.errors].map((l) => `\n  - ${l}`).join(''))
    }
    return lastReport
  }

  /** Serialize syncs; concurrent requests coalesce into one follow-up run. */
  function sync(reason) {
    if (disposed) return Promise.resolve(lastReport)
    if (running) {
      rerun = true
      return running
    }
    running = (async () => {
      try {
        let report = await syncOnce(reason)
        while (rerun && !disposed) {
          rerun = false
          report = await syncOnce(`${reason}+coalesced`)
        }
        return report
      } catch (error) {
        log.warn?.(`dsh-automations: sync failed: ${errorText(error)}`)
        lastReport = { at: new Date().toISOString(), ok: false, summary: `failed: ${errorText(error)}` }
        return lastReport
      } finally {
        running = undefined
      }
    })()
    return running
  }

  // ---- triggers ----------------------------------------------------------------

  let timer
  const schedule = (reason) => {
    if (disposed) return
    clearTimeout(timer)
    timer = setTimeout(() => sync(reason), cfg.debounceMs)
  }
  ctx.effect(() => () => clearTimeout(timer), 'dsh-automations.debounce')

  if (cfg.syncOnScheduleChange) {
    ctx.on('schedule/changed', () => {
      // Our own writes also land here; the follow-up sync is a no-op read.
      if (!running) schedule('schedule-changed')
    })
  }

  // Source change detection. Editors replace files (new inode), which silently
  // detaches per-file watchers, so directories are watched instead (a replace
  // is a rename inside the directory) and re-armed after every scan. A
  // stat-only fingerprint poll backs this up; a full sync runs only when the
  // fingerprint (paths + mtime + size) differs from the last synced one.
  const watchers = new Map() // dir -> FSWatcher
  let fingerprint
  async function sourceFingerprint() {
    const files = await loader.files()
    const parts = await Promise.all(files.map(async (f) => {
      try {
        const s = await stat(f)
        return `${f}:${s.mtimeMs}:${s.size}`
      } catch {
        return `${f}:missing`
      }
    }))
    return { files, value: parts.join('|') }
  }
  async function rearmWatchers(files) {
    if (!cfg.watch || disposed) return
    const dirs = new Set()
    for (const src of cfg.sources) {
      const abs = sourcePath(src, cfg.baseDir)
      try {
        dirs.add((await stat(abs)).isDirectory() ? abs : dirname(abs))
      } catch {
        dirs.add(dirname(abs))
      }
    }
    for (const f of files) dirs.add(dirname(f))
    for (const [dir, w] of watchers) {
      if (!dirs.has(dir)) {
        w.close()
        watchers.delete(dir)
      }
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue
      try {
        const w = watch(dir, () => schedule('source-changed'))
        w.on('error', () => {
          w.close()
          watchers.delete(dir)
        })
        watchers.set(dir, w)
      } catch (error) {
        log.warn?.(`dsh-automations: cannot watch ${dir}: ${error.message}`)
      }
    }
  }
  ctx.effect(() => () => {
    for (const w of watchers.values()) w.close()
    watchers.clear()
  }, 'dsh-automations.watchers')

  if (cfg.pollMs > 0) {
    const poll = setInterval(async () => {
      if (running || disposed) return
      try {
        const fp = await sourceFingerprint()
        if (fp.value !== fingerprint) schedule('source-poll')
      } catch {}
    }, cfg.pollMs)
    ctx.effect(() => () => clearInterval(poll), 'dsh-automations.poll')
  }

  ctx.inject(['commands'], (c) => {
    c.effect(() => c.commands.register({
      name: 'automations',
      description: 'Sync automation tasks from their task files now (add "status" to only show the last result)',
      handler: async ({ rawInput }) => {
        const report = rawInput.trim() === 'status' ? lastReport : await sync('command')
        return { kind: report.ok === false ? 'error' : 'success', text: reportText(report) }
      },
    }), 'dsh-automations.command')
  })

  // Initial sync once the Host is up.
  const startTimer = setTimeout(() => sync('startup'), 500)
  ctx.effect(() => () => clearTimeout(startTimer), 'dsh-automations.startup')
}

/** The /automations reply: the summary, then one line per change or error. */
export function reportText(report) {
  const lines = [`Automations sync ${report.ok === false ? 'finished with problems' : 'ok'}: ${report.summary}`]
  for (const l of report.changed ?? []) lines.push(`- ${l}`)
  for (const l of report.removed ?? []) lines.push(`- ${l}: removed`)
  for (const l of report.errors ?? []) lines.push(`- ERROR ${l}`)
  return lines.join('\n')
}
