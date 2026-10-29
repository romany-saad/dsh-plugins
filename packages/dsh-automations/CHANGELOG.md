# Changelog

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
- **Status file:** `$DSH_HOME/data/dsh-automations/status.json` (was `data/automation-sync/status.json`).

To switch a profile from `dsh-plugin-automation-sync`, remove it from the profile first, so the two never run at the same time, then add this package. Move your `sources`, `baseDir` and `defaults` into a `dsh-automations` row in the profile's `cordis.patch.yml`. The applied state and the task conversations carry over: this package keeps the old storage names and conversation ids, so your tasks are adopted, not created again.
