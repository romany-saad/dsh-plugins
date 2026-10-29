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
- `lib/source.js`: finds task files (`SourceLoader.files`), parses them (cached by mtime and size; `.js`/`.mjs` are imported with the cache key in the query, so an edit is re-imported), and normalizes each task. Any problem throws `SourceError`, which aborts the sync before anything is deleted.
- `lib/records.js`: the Host record signature (`timingSig`), the two storage domains, and `parseDelivery`, which reads the prompt and occurrence out of a Schedule delivery message.
- `lib/util.js`: canonical JSON hashing, derived Session ids, `SourceError`, `errorText`.

## Reconcile, per task

State per task lives in the `automation_sync` domain, table `tasks`. A sync reads the sources, then the Schedule catalog once, then for each task:

1. **Session.** Its id is derived from the task id and a hash of `{ cwd, agentPreset }` (`derivedSessionId`), so a crash after create re-adopts it. A new key creates a new Session and deletes the old one's schedule.
2. **Model and permission**, only when the declared value changed. The model goes through `sessionController.agents.selectForNextRequest`, not the public `selectModel`, because that also rewrites the profile's default model. This is an internal seam: if it goes, `applyModel` throws and the task reports an error.
3. **Schedule.** Create, or compare-and-set `schedule.update` with the stored record as `expected` (3 tries on `schedule_conflict`), else delete and create. An active orphan in the task's Session with the same title and no owner is adopted. A finished one-shot stays finished until its declaration changes. A Host input error (`INPUT_ERROR_CODES`) is cached against the declaration hash, so it is not retried until the task changes.

Tasks in the state but not in the sources are removed. An empty source with managed tasks aborts unless `allowEmpty`.

Syncs are serialized; requests during a sync coalesce into one follow-up run.

## Deliveries

`agent/inbox/inserted` re-asserts a persistent task's model and permission when its scheduled message arrives, before the step that reads it.

For `session: fresh`, the delivery is queued in the `automation_sync_runs` domain (`runs`), keyed by the message id; an `agent/pre-step` hook (prepended) drops the scheduled messages from the anchor's step, or rejects the step when nothing else is left. The run Session id is derived from the message id and the prompt uses it as `requestId`, so a retry never sends twice. Finished runs go to `history`; Sessions beyond `keepRunSessions` are archived. Pending runs resume at startup.

## Names kept from dsh-plugin-automation-sync

The storage domains (`automation_sync`, `automation_sync_runs`) and the Session id seed (`dsh-automation-sync:`) keep the old plugin's names, so a profile that switches keeps its state and Sessions. Changing them would orphan every existing task's Session and schedule.

## Triggers

Startup (500 ms after apply), a directory watch re-armed after each scan (editors replace files, which detaches per-file watchers), a stat-only fingerprint poll (`pollMs`), `schedule/changed` (our own writes cause a no-op follow-up), and `/automations`.
