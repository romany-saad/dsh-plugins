# Changelog

## Unreleased

- **Board tab:** add whole-board progress matching the strip, isolate each root parent and its subtree in a bordered section, and group standalone roots under Standalone tasks. Every root parent keeps its own direct-child progress bar.
- **Progress strip:** count leaf tasks across the whole board, including standalone top-level tasks outside the main parent. Parent containers are not counted twice; each parent's tab bar still counts its direct children. Fixes [#23](https://github.com/romany-saad/dsh-plugins/issues/23).
- **Board tab, less wasted space** ([#28](https://github.com/romany-saad/dsh-plugins/issues/28)): the step id column and the status word are gone from the rows; a step shows its status mark, with the status in the mark's tooltip and the id in the title's. A parent row is now its section's header: title and count on one line, its bar across the whole section. The Needs you card has no id column; its ask and command span the card. The whole-board progress sits in the header, and the spacing is tighter throughout.
- **Board tab, strip and cards look like DSH:** DSH's own icons (warning, link, chevrons, copy), its tag pills, outline buttons and sentence-case section titles, from the shell when it has them, with drawn fallbacks.
- **Status marks:** every status is one 12 px circle in DSH's step style, shaped like its bar segment: done filled with a check, now half filled, waiting filled (orange when it needs you), next an empty ring, dropped a ring with a dash.
- **Board tab, Needs you card:** a long step id no longer runs into the step's title; it is in the title's tooltip.

## 0.1.2

README rewritten for users; developer reference moved to DEVELOPING.md. No code change.

## 0.1.1

The package is renamed from `@romany-saad/dsh-cockpit` to `@rs-dsh/dsh-cockpit`, under the npm organization `rs-dsh` ([decision 26](https://github.com/romany-saad/dsh-plugins/issues/2#issuecomment-6410629697)). The plugin id `dsh-cockpit`, its tools, config, board format and data folder `$DSH_HOME/data/dsh-cockpit` stay as they were, so existing boards stay where they are.

- **The segmented bar** (the progress strip and the Board tab's parent row, one shared style): segments at least 10 px wide and 8 px tall with 1 px gaps, square except the first segment's left end and the last one's right end, which are round (4 px, half the height; a single segment is round at both ends). Every size is a whole pixel: the bar is measured, each segment gets floor((width − gaps) / n) px and the pixels left over go one each to the first segments, and the half fill of a `now` segment is floor(width / 2) px. When the segments do not fit at 10 px, the bar is one continuous bar, with the same height and round ends.

To upgrade a profile from 0.1.0, remove the old package and add the new one, so the two never load side by side under the same id: `dsh plugin --profile <name> remove @romany-saad/dsh-cockpit`, then `dsh plugin --profile <name> add @rs-dsh/dsh-cockpit@0.1.1`. In the profile's own `cordis.patch.yml`, change `name: '@romany-saad/dsh-cockpit'` to `name: '@rs-dsh/dsh-cockpit'`. The web GUI's Board tab takes its id from the package name, so it is now `@rs-dsh/dsh-cockpit`.

## 0.1.0

The first release: the board only (decision 2). The design is in [#1](https://github.com/romany-saad/dsh-plugins/issues/1); the decisions below are numbered as in [the owner's decisions](https://github.com/romany-saad/dsh-plugins/issues/1#issuecomment-6402129343).

### What 0.1 holds

- **The board.** A tree of steps with free-form link fields (issue, PR, branch, worktree, provider, model, effort, next action, waiting on, ready command, start when), `parent` and `dependsOn`. Statuses `next`, `now`, `waiting`, `done` and `dropped`. Ready, blocked by, needs you, progress and flags are derived on every read, never stored. Unknown references and parent loops are flagged, never refused, and bad data never moves a row.
- **The record.** One file per board, `$DSH_HOME/data/dsh-cockpit/boards/<key>.json`, format `dsh-cockpit.board` version 1, written by temp file, fsync and rename before each tool returns. A file the plugin cannot read is never overwritten. `board.schema.json` describes the format.
- **Four tools.** `board_open`, `board_read`, `board_add` and `board_update` (one item or a list in one write, with `previous`). A session's binding survives a resume.
- **Drift.** An optional `drift.command`, run only on `board_read({ checkDrift: true })`, in mode `report` (default) or `apply`, keeping only the differences. `examples/board-drift-gh.sh` is an example to copy.
- **The reader.** `@rs-dsh/dsh-cockpit/reader`: `listBoards`, `readBoard` and `boardTree`, with no DSH imports.
- **Read routes.** `/api/dsh-cockpit/boards`, `/board` and `/view`, `GET` and `HEAD` only, owner-only on the host connection.
- **In the web GUI.** The Board tab (Needs you, board data problems, the tree in fixed columns, PR and issue links, the parent row's bar), the progress strip above the chat input, and one-line chat cards for the four tools. None of them runs a command or writes the board.
- **Config.** `tools.enabled`, `route.enabled`, `drift` and `links` (URL patterns, empty by default), shipped as the bundle patch `cordis.patch.yml`.

### The owner's decisions it implements

- 1, 3: a separate, reusable plugin named dsh-cockpit in romany-saad/dsh-plugins, MIT, installed from a git commit or tag, not npm.
- 2, 18: the board only. The panel links PRs and issues and runs nothing; there is no remote control.
- 4: each step was one PR with one code review, merged by the owner.
- 5: no dependency on Agent Teams.
- 6, 9: drift is reported through the user's own command, with no tracker built in; the hub writes what it learns through the board tools.
- 7: one writer per board.
- 8, 10: the record is a local file under `$DSH_HOME/data/dsh-cockpit/boards/`.
- 11: the hub names the board's key; the parent ticket is an optional free-form reference.
- 12: the board replaces the hub's hand-kept action list.
- 13: `parent` and `dependsOn`, drawn as a tree.
- 14: the file format and the reader work without DSH, for a hub in another harness.
- 15: item ids are any non-empty string, the next integer when omitted; tags are `dsh-cockpit@<semver>`; every agent in a loading profile sees the tools, unless `tools.enabled: false`.
- 16: `readyCommand`, stored and shown, never run.
- 17: `waitingOn`, and the panel's priorities: quality, usability and clarity, then simplicity.
- 20: `startWhen`; the `dropped` status; the `links` config, empty by default; `waitingOn` `owner` (any case) puts a task in Needs you.

### Not in 0.1

- [#3](https://github.com/romany-saad/dsh-plugins/issues/3): a "mark done" control on a Needs you card (decision 19).
- [#5](https://github.com/romany-saad/dsh-plugins/issues/5): a pull request as a task of its own.
- [#6](https://github.com/romany-saad/dsh-plugins/issues/6): subtasks as a feature.
- [#7](https://github.com/romany-saad/dsh-plugins/issues/7): naming the UI Cockpit, not Board.
- [#8](https://github.com/romany-saad/dsh-plugins/issues/8): a context briefing on each Needs you item.
- [#9](https://github.com/romany-saad/dsh-plugins/issues/9): answer buttons that fill the hub's chat input.
- [#10](https://github.com/romany-saad/dsh-plugins/issues/10): prompting the hub to resync the board on a schedule.
- Publishing to npm is parked in [#2](https://github.com/romany-saad/dsh-plugins/issues/2).
