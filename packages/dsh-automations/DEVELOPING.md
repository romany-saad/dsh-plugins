# Developing dsh-automations

The reference for working on the plugin. For what it does and how to set it up, see [README.md](README.md). This file stays in the repository and is not published to npm.

## Build and test

```sh
pnpm test
```

`pnpm test` runs with network access blocked (`test/no-network.mjs`). `test/host.mjs` is a real cordis `Context` with in-memory stand-ins for every Host service the plugin injects, so the sync runs end to end without DSH.

To try a checkout, install it by path into a scratch profile: `dsh plugin --profile scratch add ./packages/dsh-automations`.

## Files

- `index.js`: the host plugin. `inject` is `schedule`, `sessionController`, `storageDomain`, `workspaceRegistry`, `llm` and `sessionProjections`; it also uses `permissionPresets` through `ctx.get`, and `commands` through `ctx.inject` for `/automations`. It holds the reconcile loop, the triggers and the fresh-run queue. `resolveConfig` and `reportText` are exported for tests.
- `lib/source.js`: finds task files (`SourceLoader.files`, over `roots()`: the configured sources, then `agentDir`, which may be missing), parses them (cached by mtime and size; `.js`/`.mjs` are imported with the cache key in the query, so an edit is re-imported), and normalizes each task. Any problem throws `SourceError`, which aborts the sync before anything is deleted.
- `lib/agent.js`: the agent surface, registered by `registerAgentSurface` unless `tools: false`: five tools (`ctx.inject(['tools'])`), a `tools/pre-execute` gate that answers `ask` for a task above `read-only`, the `rs-dsh:automations` system-prompt section (`ctx.inject(['tools', 'systemPrompt'])`), and the `automations` skill (`skills/automations.md`, `ctx.inject(['tools', 'skills'])`). For tasks, the tools never write to the Schedule directly: they write one YAML file per task in `agentDir`, then call `syncNow`, which waits out a running sync so the new file is seen. A task error in the report undoes the write (restores the old file or removes the new one) and syncs again. `inAgentDir` keeps the tools off user files. `automation_adopt` deletes the reminder only after its task has synced.
- `lib/intro.js`: `introPrompt` builds the welcome message (one paragraph: the task's title, schedule and file, what to say, no task prompt) and `describeSchedule` puts a normalized schedule in words.
- `lib/records.js`: the Host record signature (`timingSig`), the two storage domains, and `parseDelivery`, which reads the prompt and occurrence out of a Schedule delivery message.
- `lib/util.js`: canonical JSON hashing, derived Session ids, `SourceError`, `errorText`.

## The Default workspace

A task without `cwd` is left `undefined` by the loader. `syncOnce` fills it in with `defaultWorkspacePath()`: `workspaceController.initializeDefault` (through `ctx.get`, not `inject`) returns the existing default, and creates one only on a first-use profile, as DSH's own startup does. Without the controller, it falls back to a registered workspace whose folder is named `default-workspace`. When neither exists, only those tasks report an error; the others sync.

## Reconcile, per task

State per task lives in the `automation_sync` domain, table `tasks`. A sync reads the sources, then the Schedule catalog once, then for each task:

1. **Session.** A changed title renames it. Its id is derived from the task id and a hash of `{ cwd, agentPreset }` (`derivedSessionId`), so a crash after create re-adopts it. A new key creates a new Session and deletes the old one's schedule.
2. **Model and permission**, only when the declared value changed. The model goes through `sessionController.agents.selectForNextRequest`, not the public `selectModel`, because that also rewrites the profile's default model. This is an internal seam: if it goes, `applyModel` throws and the task reports an error.
3. **Schedule.** Create, or compare-and-set `schedule.update` with the stored record as `expected` (3 tries on `schedule_conflict`), else delete and create. An active orphan in the task's Session with the same title and no owner is adopted. A finished one-shot stays finished until its declaration changes. A Host input error (`INPUT_ERROR_CODES`) is cached against the declaration hash, so it is not retried until the task changes.

Tasks in the state but not in the sources are removed. An empty source with managed tasks aborts unless `allowEmpty`.

Syncs are serialized; requests during a sync coalesce into one follow-up run.

## Deliveries

`agent/inbox/inserted` re-asserts a persistent task's model and permission when its scheduled message arrives, before the step that reads it.

For `session: fresh`, the delivery is queued in the `automation_sync_runs` domain (`runs`), keyed by the message id; an `agent/pre-step` hook (prepended) drops the scheduled messages from the anchor's step, or rejects the step when nothing else is left. The run Session id is derived from the message id and the prompt uses it as `requestId`, so a retry never sends twice. Finished runs go to `history`; Sessions beyond `keepRunSessions` are archived. Pending runs resume at startup.

## Names kept from dsh-plugin-automation-sync

The storage domains (`automation_sync`, `automation_sync_runs`) and the Session id seed (`dsh-automation-sync:`) keep the old plugin's names, so a profile that switches keeps its state and Sessions. Changing them would orphan every existing task's Session and schedule.

## The introduction

A task conversation is created empty. DSH's `sessionListMetadata` projection keeps a session `blank` until its first `turn/start`, and the Web UI's `createInWorkspace` gives a new conversation the first non-archived blank session whose folder matches. So a task's conversation (and a `fresh` task's anchor, which never runs a turn until its first delivery, because `agent-loop` appends `turn/start` before the `agent/pre-step` hook that rejects the step) would be handed out, title and all.

`introduce` runs after `reconcileTask` succeeds, so the schedule exists and a persistent task's model and permission are applied. State `introduced: false` is set only when `ensureSession` creates a Session; a state row without the field (an older version) is never introduced. It sends `sessionController.prompt` with the request id `dsh-automations:intro:<sessionId>`, which DSH treats as idempotent, and first skips a Session that already has a user message. Success sets `introduced: true`; a failure of `prompt` itself (admission) is logged and leaves `false`, so the next sync retries. `prompt` only queues the message, so a failed model call (no API key) is a failed turn in the conversation, not an error here: the state is already `true` and it is not retried. Seen in a scratch profile with no key. A disabled task waits until it is enabled. The title is set with `sessionController.rename`, a `user`-source title, which DSH's title service never overwrites, so the welcome message does not retitle the conversation.

A fresh task's anchor takes the default model and permission for the welcome, since those are applied to run Sessions only; the prompt tells the model to call no tools. The `agent/pre-step` hook drops only `schedule`-source messages, so the welcome is not diverted.

## Triggers

Startup (500 ms after apply), a directory watch re-armed after each scan (editors replace files, which detaches per-file watchers), a stat-only fingerprint poll (`pollMs`), `schedule/changed` (our own writes cause a no-op follow-up), and `/automations`.

## Screenshots

Taken from a scratch `DSH_HOME` with `@deepseek-ai/dsh-web-app` and `@deepseek-ai/dsh-experimental-schedule-bundle`, three demo tasks in `$DSH_HOME/automations/tasks.yaml`, 1400 × 900 at 2×, light theme:

- `docs/images/automation-tasks.png`: the Automation tasks page with the tasks and one open.
- `docs/images/command-menu.png`: `/automations` in the message box's command menu.
- `docs/images/agent-upsert.png`: a conversation where the agent creates a twice-weekly channel digest with `automation_upsert`, and its reply.
- `docs/images/command-result.png`: its result row in a conversation. A command runs only in a conversation that already exists; on a blank new Session, DSH's composer does not submit it.
