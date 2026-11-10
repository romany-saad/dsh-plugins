# Changelog

## 0.2.0-rc.3

- **Works with DSH 0.2.2-rc.1, and needs it.** DSH 0.2.2-rc.1 changed how plugins create, change and read Schedule tasks, and how they read and steer conversations. 0.2.0-rc.2 still used the old forms, so every sync failed for every task. Depending on the task, the error was `invalid_rule: timing must contain exactly kind and its matching selector.` or `ctx.sessionController.inspect is not a function`. Tasks already on the Schedule kept running, but changes to their files no longer reached it. `engines.dsh` is now `>=0.2.2-rc.1 <0.3.0-0`.
- **Stuck tasks recover on their own.** A refusal is remembered so that an unchanged task is not sent again, so the failed tasks stayed failed. A refusal recorded by an earlier version is now retried, and a task whose schedule already matches its file clears its error. No duplicate tasks are created: each one takes over the schedule it already had.
- **No more "[SCHEDULE CHANGE]" messages in task conversations.** DSH 0.2.2 tells a task's conversation about each change to its schedule, with a message the model reads in its next run. The plugin's own syncs caused those messages. Its changes now come from the task's own conversation, which DSH doesn't notify. A change you make on the Automation tasks page is still announced.
- **A task paused on the Automation tasks page is resumed** at the next sync, because its file says it runs. Before, a paused task stayed paused.
- **Requirements:** the Automation tasks page is part of `@deepseek-ai/dsh-web-app` in DSH 0.2.2, so the experimental schedule bundle is no longer needed.

## 0.2.0-rc.2

- **A welcome message in each new task conversation.** The plugin creates a task's conversation empty, and DSH reuses an empty conversation for the next new conversation in that folder, so you got it with the task's title. The conversation now starts with a short message to the model (two sentences; the task's prompt is not in it), which answers with the task's name, when it runs, which file defines it, and a suggestion to pin the conversation. It is sent once per new task, after the task synced. If DSH cannot accept the message, that is logged and retried at the next sync; if the model call itself fails (no API key, say), the conversation shows a failed turn and nothing is retried. Existing tasks are not changed. It costs one model call per new task; `intro: false` turns it off. For a `fresh` task it goes to the task's own conversation, not to a run.
- **The README now says** that a task's conversation is restored when you archive it while the task is enabled.
- **`promptFile`.** A task can read its prompt from a file (`promptFile: ./prompts/digest.md`, relative to the task file) instead of writing it inline. Saving the prompt file re-syncs the task. A missing or empty file, or giving both `prompt` and `promptFile`, is an error that names the task.

## 0.2.0-rc.1

- **Agents can create and manage tasks.** The new tools `automation_list`, `automation_upsert`, `automation_remove`, `automation_sync` and `automation_adopt` let the agent work with tasks. Each task it creates is its own YAML file in `$DSH_HOME/automations/agent/` (`agentDir`), so the files stay the source of truth. A task DSH refuses is undone. The tools never change files you wrote. Before, an agent asked to "use the automation plugin" had no way to find it and fell back to a reminder in the current conversation.
- **The agent knows when to use them.** A short guidance section tells the agent to make routines into automation tasks and to keep DSH's `schedule_create` for reminders in the current conversation. The bundled `automations` skill holds the file format, how to write a prompt that runs unattended, and an example: a channel summarised twice a week.
- **Turn a reminder into a task.** `automation_adopt` writes a task from a reminder's timing and prompt, then deletes the reminder so the work doesn't run twice.
- **Approval for more than read-only.** A task the agent creates is `read-only` by default. Asking for another permission preset shows you an approval first.
- **`cwd` is optional.** A task without one works in DSH's Default workspace.
- **Config:** `tools` (default `true`) and `agentDir` (default `automations/agent`).
- **Fix: a fresh install with no `automations` folder** reported "source … is not readable" on every sync, because the bundled config writes the default folder out. The default folder is now optional however it is set.
- **Needs `@deepseek-ai/dsh-tools`**, which every DSH profile with an agent has.

## 0.1.1

- **Declares the DSH versions it supports.** `engines.dsh` is `>=0.2.1-rc.2 <0.3.0-0`, the DSH 0.2 line it is tested with. DSH checks it before installing, and plugin markets show it as the version's compatibility. Nothing else changes.

## 0.1.0

The first release. It is the private `dsh-plugin-automation-sync` plugin, made into a published rs-dsh package.

- **Task files** in YAML, JSON or JS keep automation tasks: schedule (cron, daily, weekly, every, at), prompt, title, working folder, time zone, model, permission preset, agent preset, `persistent` or `fresh` conversation, and `enabled`.
- **Sync** at startup, when a task file changes, when the Schedule changes, and on `/automations`. `/automations status` shows the last result.
- **Safe by default:** a file with a mistake changes nothing, and a sync that finds no tasks deletes nothing unless `allowEmpty` is set.

Changes from `dsh-plugin-automation-sync`:

- **Name:** the package is `@rs-dsh/dsh-automations`, the plugin id `dsh-automations`, and the command `/automations` (was `/automation-sync`).
- **No paths to set:** `sources` defaults to `$DSH_HOME/automations`, and a missing default folder means no tasks. Before, `sources` was required.
- **YAML always works:** the package ships its YAML parser. Before, it borrowed one from the DSH install and failed when none was found.
- **A relative `cwd`** is read from the task file's folder. Before, it was read from the folder DSH was started in.
- **A renamed task renames its conversation.** Before, the conversation kept the first title.
- **The status file is written before `/automations` answers**, and writes never overlap, so an older result can't overwrite a newer one.
- **Status file:** `$DSH_HOME/data/dsh-automations/status.json` (was `data/automation-sync/status.json`).

To switch a profile from `dsh-plugin-automation-sync`, remove it from the profile first, so the two never run at the same time, then add this package. Move your `sources`, `baseDir` and `defaults` into a `dsh-automations` row in the profile's `cordis.patch.yml`. The applied state and the task conversations carry over: this package keeps the old storage names and conversation ids, so your tasks are adopted, not created again.
