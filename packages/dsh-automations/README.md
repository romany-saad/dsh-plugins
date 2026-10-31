# @rs-dsh/dsh-automations

Keep your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) automation tasks in files. Write each task (its schedule, prompt, model, permission and working folder) in a YAML, JSON or JS file, and the plugin makes the Schedule match: it creates, updates, disables and deletes tasks so that they are exactly what the files say.

![Three tasks from a task file on DSH's Automation tasks page, one open with its weekday schedule](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-automations/docs/images/automation-tasks.png)

## Install

```sh
dsh plugin --profile <name> add @rs-dsh/dsh-automations@0.1.1
```

To install from this repository instead, pinned to the release tag:

```sh
dsh plugin --profile <name> add 'github:romany-saad/dsh-plugins#dsh-automations@0.1.1&path:packages/dsh-automations'
```

Restart DSH after installing.

## Requirements

- DSH 0.2.1-rc.2 or later. It is tested with 0.2.1-rc.2.
- A profile with the Schedule (`@deepseek-ai/dsh-schedule`), which the `web` profile has. To see and edit tasks on the **Automation tasks** page, the profile also needs `@deepseek-ai/dsh-experimental-schedule-bundle`.

## Use

### Write your tasks

Put task files in `~/.dsh/automations/` (the folder is `$DSH_HOME/automations`). Every `.yaml`, `.yml`, `.json`, `.js` and `.mjs` file in it, and in its subfolders, adds tasks. Files whose names start with `_` or `.` are skipped, so you can keep drafts as `_draft.yaml`.

```yaml
defaults:                         # for every task in this file
  cwd: /path/to/your/repo         # the folder the task works in
  timeZone: Europe/Berlin
  permission: read-only           # read-only, workspace-write or danger-full-access
  model: claude/claude-opus-5-5   # or { provider, model, reasoningEffort }
tasks:
  - id: repo-digest               # never reuse an id for another task
    title: Daily repo digest
    schedule:
      cron: "30 8 * * 1-5"
    prompt: |
      Summarize what changed in this repository since yesterday.
```

A file holds a list of tasks, `{ defaults, tasks }`, or one task. A `.js` or `.mjs` file exports the same as `default`, or a function that returns it. [`examples/tasks.yaml`](examples/tasks.yaml) is a file to copy.

Each task has:

| Field | Required | What it is |
|---|---|---|
| `id` | yes | The task's identity: letters, digits, `.`, `_` and `-`, up to 100 characters. Renaming it makes a new task. |
| `prompt` | yes | The message the task sends when it runs. |
| `schedule` | yes | When it runs; see below. |
| `cwd` | yes, here or in `defaults` | The folder it works in. A relative path is read from the task file's folder. |
| `title` | no | The name on the Automation tasks page, up to 120 characters. Defaults to the id. |
| `timeZone` | no | Defaults to your computer's time zone. |
| `model` | no | `provider/model`, or `{ provider, model, reasoningEffort }`. |
| `permission` | no | A permission preset name. |
| `agentPreset` | no | An agent preset name. |
| `session` | no | `persistent` (the default) or `fresh`; see below. |
| `enabled` | no | `false` takes the task off the Schedule and keeps its conversation. |

`schedule` takes exactly one of:

- `cron: "30 8 * * 1-5"`: a five-field cron expression.
- `daily: "09:00"`.
- `weekly: { time: "08:30", weekdays: [mon, thu] }`: days as names or 1 (Monday) to 7 (Sunday).
- `every: 15m`: at least a minute; `s`, `m`, `h` or `d`.
- `at: 2026-12-01T09:00:00+02:00`: once.

Add `timeZone:` inside `schedule` to give one schedule its own time zone.

### What happens when you save

Saving a file syncs within a second or so. You can also type `/automations` in the message box of a conversation to sync now, or `/automations status` to see the result of the last sync without syncing.

![The /automations command in the message box's command menu](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-automations/docs/images/command-menu.png)

The result shows in the conversation as a command line, not as a message to the model:

![The /automations result in a conversation: sync ok, 0 changed, 0 removed, 3 unchanged, 0 errors](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-automations/docs/images/command-result.png)

| You change | What happens |
|---|---|
| title, prompt or schedule | The task is updated in place and keeps its history. A new title also renames its conversation. |
| model | Used in that task's conversation only. Your default model does not change. |
| permission | Set on that task's conversation. |
| `cwd` or `agentPreset` | The task moves to a new conversation. |
| `enabled: false` | The task leaves the Schedule. Its conversation stays. |
| you delete the task | The task leaves the Schedule. |
| you edit or delete the task on the Automation tasks page | The next sync puts it back as the file says. |
| a file has a mistake | Nothing changes until you fix it. `/automations` names the file, the task and the problem. |
| DSH refuses a task, for example a bad cron | The task keeps its last good schedule, and the error shows until you change that task. |

If the files hold no tasks at all, the plugin refuses to delete every task, so an empty or moved folder does not wipe your Schedule. Set `allowEmpty: true` to allow it.

### Each task has its own conversation

Each task runs in a conversation of its own, titled `⏱ <title>`. With `session: persistent`, every run is a new message in that same conversation, so the task remembers earlier runs.

With `session: fresh`, every run starts a new conversation that holds only the task's prompt, titled `⏱ <title> · <date and time>`. The newest 10 run conversations are kept and older ones are archived. The task's own conversation stays, so the Automation tasks page still lists and edits it, but nothing runs in it.

## Configure

It works with no config. To change something, add a `dsh-automations` row to the profile's `cordis.patch.yml`. A row with the same id replaces the whole config, so put every setting you change in that one row:

```yaml
- id: dsh-automations
  name: '@rs-dsh/dsh-automations'
  config:
    sources:
      - /home/me/automation        # folders or single files
    defaults:
      timeZone: Africa/Cairo
      permission: read-only
```

| Option | Default | What it does |
|---|---|---|
| `sources` | `[automations]` | Task folders or files. When you set it, a folder that does not exist is an error. |
| `baseDir` | `$DSH_HOME` | Where relative `sources` paths start. |
| `defaults` | none | Task fields for every file; a file's own `defaults` override them. |
| `allowEmpty` | `false` | `true` lets a sync with no tasks delete every task. |
| `archiveRemovedSessions` | `false` | `true` also archives the conversation of a task you delete. |
| `sessionTitlePrefix` | `⏱ ` | Put in front of each task's conversation title. `false` leaves titles alone. |
| `keepRunSessions` | `10` | How many run conversations a `fresh` task keeps. |
| `watch` | `true` | Sync when a task file changes. |
| `pollMs` | `10000` | Also check the files this often, in milliseconds. `0` turns it off. |
| `debounceMs` | `750` | Wait this long after a change before syncing. |
| `syncOnScheduleChange` | `true` | Sync when the Schedule changes, so an edit on the page is put back. |
| `runRetryMs`, `runMaxAttempts` | `30000`, `5` | How a `fresh` run that fails to start is retried. |
| `statusFile` | `$DSH_HOME/data/dsh-automations/status.json` | Where the last sync's result is written. `false` writes none. |

## Limits

- **The files win.** A change you make on the Automation tasks page to a task from a file is undone at the next sync. Tasks you create on the page yourself are left alone.
- **One DSH at a time.** Two DSH processes reading the same task files would each try to manage the same tasks.
- **A `.js` task file runs as code** inside DSH. Only use files you trust.
- **No screen of its own.** You see the tasks on DSH's Automation tasks page and the sync result through `/automations`.
- **Model per conversation** uses a part of DSH that is not a public API yet. If a DSH update removes it, `/automations` reports an error for each task with a `model`, and those tasks are not updated until you remove the `model` or update the plugin.

## More

[Changelog](CHANGELOG.md) · [MIT license](LICENSE) · [Developing](DEVELOPING.md)
