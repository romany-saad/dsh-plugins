# Developing dsh-cockpit

The reference for working on the plugin: its files, tools, routes, store, drift runner and web GUI rules. For what it does and how to set it up, see [README.md](README.md). The design and the owner's decisions are in [issue #1](https://github.com/romany-saad/dsh-plugins/issues/1). This file stays in the repository and is not published to npm.

## Build and test

```sh
pnpm test
node client/build.mjs   # after changing client/src, lib/rows.js or lib/present.js
```

`pnpm test` runs with network access blocked (`test/no-network.mjs`). A test fails when the committed `client/client.js` is not what the sources build.

To try a checkout, install it by path into a scratch profile: `dsh plugin --profile scratch add ./packages/dsh-cockpit`.

## Files

- `index.js`: the host plugin. Registers `board_open`, `board_read`, `board_add` and `board_update` inside `ctx.inject(['tools'], …)`, with `defineTool` from `@deepseek-ai/dsh-tools`. When the system-prompt service is present it also contributes board-maintenance guidance, scoped to sessions already using a board. This is advisory, not automatic reconciliation; a complete custom prompt can suppress the section. Every agent in a profile that loads the plugin sees the tools; `tools.enabled: false` registers neither tools nor guidance.
- `lib/tools.js`: the tool bodies. Results are `{ ok: true, … }` or `{ ok: false, code, message }`, with the codes `not_bound`, `item_exists`, `item_unknown`, `unknown_reference`, `invalid_input`, `board_unreadable` and `write_failed`.
  - `board_open({ key, parent? })` creates or opens a board and binds the session to it, in memory and in `sessions/<sessionId>.json`, so a resumed session finds its board without reopening it.
  - `board_read({ item?, status?, checkDrift? })`: the tasks, the tree text, the flags, the last drift result, and the file's path and format version. The filters narrow the result only. `checkDrift: true` first runs the drift command (see Drift runner), and `driftCheck` says `ran`, `failed` or `not_configured`.
  - `board_add({ item?, what, status?, … })`: `item` defaults to the next integer, `status` to `next`. A field it does not know is refused (`invalid_input`); `extra` keeps anything else. A `parent` or `dependsOn` item not on the board is refused (`unknown_reference`): the task is defined first, then linked.
  - `board_update({ item, set? | remove? })`: `item` is one item or a list, changed in one write; one unknown item refuses the whole call (`item_unknown`), as does a `parent` or `dependsOn` in `set` that names no task on the board (`unknown_reference`). `null` in `set` clears a field. It returns `tasks` (after) and `previous` (before); a removal returns the removed tasks in `previous`, so `board_add` can put them back.
- `lib/route.js`: the read routes for the Board tab and the strip, `GET` and `HEAD` only, registered inside `ctx.inject(['connection'], …)` as exact Fetch routes on the host connection, which answers 403 to any Peer that is not the owner. Nothing registers on the raw web server. `route.enabled: false` registers none.
  - `/api/dsh-cockpit/boards`: `{ boards }`, the keys in the folder.
  - `/api/dsh-cockpit/board?key=K`: the board file as stored; 404 for an unknown key.
  - `/api/dsh-cockpit/view?sessionId=S`: `{ key, board, tree, flags, problems, driftConfigured, links }` for the session's bound board, `links` being the profile's non-empty link patterns, else `{ key: null, boards }`. A bound board that is missing, unreadable or cannot be drawn comes back as `{ key, error }`. An unexpected read error is a 500 that names its code, not its paths.
- `client/client.js` (`./client`, `dsh.client` with `platform: 'web'`): the Board tab in the web GUI's right sidebar, read-only. Built from `client/src/panel.js` and `client/src/command-box.js` by `node client/build.mjs`, which inlines `lib/rows.js`, so the tab and the tree text share their rules; a test fails when the committed file is not what the sources build. The tab polls the view route every 2 s and shows:
  - a header with the key and parent, the revision and time, the drift line ("Drift: 1 differs · 16:40") when drift is configured or has run, and the **Whole board** count and bar, the strip's own model (every leaf task, parents not counted again, in the order the sections below draw them: `boardGroups` in `lib/rows.js`);
  - **Needs you**: one card per open task whose `waitingOn` is `owner`: the title and an "Open PR" link on one line, then its next action as written and the ready command with Copy, both spanning the card. The step id is in the title's tooltip;
  - **Board data problems**, each naming its reference, with ↓ to the row;
  - each root parent and its subtree in a separate bordered section, then a **Standalone tasks** section for roots without children. The parent row is the section's header: its title with the count on the same line ("0 of 3 done · 1 needs you", dropped counted apart), and under them a segmented bar spanning the section, one segment per direct child. The chevron column only shows when the parent has details to open;
  - the task rows in tree order, in columns mark · title · PR · chevron. The status is the mark only: one 12 px circle per status in DSH's StateDot `step` style (a 1.5 px ring, `corner-shape: round` against DSH's default squircle), shaped like the status's bar segment, so a row and its bar read the same. Done is the host's filled step with its check; now is a ring half filled with the info accent (still, not the host's spinner); waiting is filled grey, or orange when it needs you; next is an empty ring; dropped is a ring with a dash, its title struck through. Its word is the mark's tooltip and accessible name. The step id is in the title's tooltip and the expanded detail, so neither takes a column. Under the title: one meta line (the next action as written, "Waiting on CI", "Start when: …"), "Blocked by …", the "ready" and "Needs you · see top" tags, "reported: done", and an expandable detail with the reason, start condition, model, branch, worktree and command;
  - the bars (the header's, each parent's, the strip's) share one style in whole pixels: segments at least 10 px wide and 8 px tall, 1 px gaps, round only at the bar's two outer ends, and one continuous bar when the segments do not fit.
  **DSH look.** The tab, the strip and the cards take the host's `@deepseek-ai/dsh-client-ui-primitives` from the shell when it has them: `StateDot` (`step`) for the done mark, the other marks drawn at its size and ring (never its `ongoing` spinner, as nothing on the board moves), the host icons for warning, external link, chevrons and copy, and `DisclosureRow` for the cards. Each has a drawn fallback, so the bundle still renders without them. The styles use the host's tokens (`--dsw-alias-*`, `--dsw-radius-*`) and follow its Tag pill, small outline Button and sentence-case section titles; text colours keep the 4.5:1 light-theme mixes above.
  Titles show `#12` for the board parent's repository and `repo#12` for another, with the full reference in the link and its tooltip. Board text is rendered only as text; only `http(s)` URLs become links, opening in a new tab. The tab runs no command and writes nothing.
- The **progress strip** above the chat input (the `conversation.input.dock` slot, after the Todo, Goal and Queue docks), shown only while the session has a bound board. It is one line: one segment per leaf task across the whole board, including standalone top-level tasks and excluding parent containers (one continuous bar above 24), then "<key> · N of M done · <focus> · Board ›". The focus is the first of: a task blocked, naming the blocker and its status ("#887 blocked by #886 (waiting)"); the tasks in progress ("2 in progress: #885, #886"). When a task waits on the owner it reads "⚠ Needs you: <next action> · Copy command · Board ›" instead, with the CommandBox's copy ("2 need you" for more, with no Copy). A click on the strip or a segment opens the Board tab at that row. The strip and the tab share one poll of the view route.
- **Chat cards** for `board_open`, `board_read`, `board_add` and `board_update` (keyed `tool.call.toolview` views): one row, "Board · <title>", the title from `lib/present.js` on the arguments or the result's recorded meta title; a result `{ ok: false }` shows its code, in the error colour (mixed toward the primary label in light, as the tab's is). Opened, the card shows the result's tree text, else its JSON.
- `lib/config.js`: the config and its defaults, and `linkOptions(config, board)`, which turns the `links` patterns into the options of `refUrl` and `boardRows`.
- `lib/present.js`: one-line titles for the tool cards, inlined into the client bundle too.
- `cordis.patch.yml`: the bundle patch (`dsh.bundle.patch`).
- `lib/task.js`: the task model. Statuses `next`, `now`, `waiting`, `done` and `dropped`; `done` and `dropped` are closed, so they block nothing. Fields: item, what, status, why, issue, pr, branch, worktree, provider, model, effort, nextAction, waitingOn, readyCommand, startWhen, parent, dependsOn, extra, updatedAt. Fields it does not know are kept.
- `lib/rows.js`: what each row says, derived and never stored: ready, blocked by, needs you (`waitingOn` is `owner`, in any case), progress (dropped counted apart from done), flags (`unknown_parent`, `unknown_dependency`, `parent_loop`, `duplicate_issue`, `duplicate_pr`), and links. Only full `http(s)` URLs link, unless the caller passes `links` URL patterns (`{ref}`, `{repo}`, `{number}`).
- `lib/tree.js`: the tree text, led by a Problems block. Bad data never moves a row.
- `lib/store.js`: `$DSH_HOME/data/dsh-cockpit/boards/<encodeURIComponent(key)>.json`, format `dsh-cockpit.board`, version 1, written by temp file, fsync, rename and directory fsync. A file it cannot read is never overwritten. `revision` counts changes to tasks or to the board's parent; a write that changes neither, such as a report-only drift result, does not bump it.
- `lib/drift.js`: the drift runner and record. It keeps only the entries whose status differs from their task's, and `checked` counts every entry.
- `examples/board-drift-gh.sh`: an example drift command (see Drift runner).
- `reader.js` (`@rs-dsh/dsh-cockpit/reader`): `listBoards(dir?)`, `readBoard(keyOrFile, dir?)` and `boardTree(board)`, with no DSH imports. A miss names the folder it looked in and where `DSH_HOME` came from.
- `board.schema.json`: the file format as a JSON Schema, also for a local file that a hub without the plugin writes and the reader reads the same way; that file is never the plugin's own store.

## Config

```yaml
- id: dsh-cockpit
  name: '@rs-dsh/dsh-cockpit'
  config:
    tools: { enabled: true }      # false: register no tools
    route: { enabled: true }      # false: no routes, so no panel data
    drift: { command: '', cwd: '', mode: report }   # mode: report | apply; empty command: no check
    links: { issue: '', pr: '' }  # URL patterns with {ref}, {repo}, {number}; empty: only full URLs link, in the Board tab too
```

A profile patch with the same id replaces the whole config. A field it leaves out takes its default above, so a field it means to keep at a non-default value must be restated. The README shows the patch for GitHub links.

## Drift runner

Drift is a task whose status no longer matches its linked work, such as a merged PR on a task that still says `waiting`. The plugin knows no tracker, so the check is a command you configure in `drift.command`. With no command, nothing runs.

- **When.** Only on `board_read({ checkDrift: true })`. The command comes only from the profile config; no tool argument names it, and nothing runs on a timer.
- **How.** Through the system shell, in `drift.cwd` (empty: the host's directory), with the host's environment plus `DSH_HOME`, `DSH_COCKPIT_KEY` and `DSH_COCKPIT_FILE`, and the board's JSON on stdin. It runs in its own process group, so cancelling the call stops it and what it started (on Windows, only the shell). It runs outside the board's write queue, so other writes go on meanwhile; its result is then compared with the board as it is when stored.
- **Output.** `{ "items": [ { "item", "status"?, "note"? } ] }` on stdout. The board's `drift` keeps only the entries whose status differs from their task's, plus `checked`, the number of entries reported, and `checkedAt`. A non-zero exit or output that is not JSON stores `drift.error` instead, and the tasks stay as they were.
- **`drift.mode`.** `report` (the default) changes no task and does not bump `revision`; the hub decides and writes. `apply` sets each differing task's status and bumps `revision`.
- **Shown.** The tree text ends a row whose status still differs with "reported: done".

`examples/board-drift-gh.sh` is an example to copy and change. It reports `done` for each open task whose `pr` `gh pr view` reports as merged, and needs `gh` and `jq`; it fails when either is missing or gh can read none of the PRs. The plugin never runs it unless you name it in `drift.command`, for example `drift: { command: 'bash /path/to/board-drift-gh.sh', cwd: '/path/to/repo', mode: report }`.

## Installing from git

A profile can install the package from this repository with a git pin to the release tag:

```sh
dsh plugin --profile <name> add 'github:romany-saad/dsh-plugins#dsh-cockpit@<version>&path:packages/dsh-cockpit'
```

```json
"@rs-dsh/dsh-cockpit": "github:romany-saad/dsh-plugins#dsh-cockpit@<version>&path:packages/dsh-cockpit"
```

- **The tag works.** pnpm accepts a tag that contains `@` before `&path:`, and the lockfile records the tag's commit (`codeload.github.com/romany-saad/dsh-plugins/tar.gz/<commit>#path:packages/dsh-cockpit`). This was tried with pnpm 12.14.0 and `dsh plugin add` (DSH 0.2.1-rc.2) against a test tag. To pin a commit instead, put the commit in place of the tag: `#<commit>&path:packages/dsh-cockpit`.
- **The peers** `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-home-paths` come from the DSH that boots the profile. pnpm may warn that they are missing from the profile itself.

## Screenshots

[CONTRIBUTING.md](../../CONTRIBUTING.md#screenshots) sets the rules. The README's images live in `docs/images/` (not shipped in the package). They were taken in a separate `DSH_HOME` with a scratch profile (`@deepseek-ai/dsh-web-app`, this package by path) and a demo board, `search-v2` (parent `acme/shop#120`), so no real board, session or path shows. Light theme, 1400 × 900 at 2× scale. Retake them when a change alters what they show:

| File | Shows |
|---|---|
| `board-tab.png` | The Board tab: whole-board progress, Needs you, separate parent subtrees with local progress, and standalone tasks |
| `strip.png` | The progress strip above the message box, with a step that needs you |
| `strip-whole-board.png` | Whole-board progress with a completed parent and a standalone step waiting on CI |
| `tool-cards.png` | Two board tool calls as cards under Called tools |

`screenshots.json` lists these images, in this order, for plugin storefronts that read the awesome-dsh-plugin catalog; keep it in step when you add, rename or drop one. `docs/icon.png` is the storefront tile, rendered from `docs/icon.svg` (see [CONTRIBUTING.md](../../CONTRIBUTING.md#plugin-catalog)).

## Releases

A release bumps `version` in `package.json`, adds a CHANGELOG entry and is tagged `dsh-cockpit@<version>` after the merge; pushing the tag publishes it to npm. npm shows the README of the last published version, so a README change reaches npmjs.com only with a release.
