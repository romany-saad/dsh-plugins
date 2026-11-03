# Changelog

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
