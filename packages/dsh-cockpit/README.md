# @romany-saad/dsh-cockpit

A durable task board for a DeepSeek Harness hub session: the session that coordinates builders across many pull requests. A board is a tree of steps, each linked to its work by free-form fields, and it is kept as one local JSON file that other processes can read.

**Status: in development.** The design is in [issue #1](https://github.com/romany-saad/dsh-plugins/issues/1). The plugin registers its four board tools; running drift, the routes and the web panel follow in later pull requests.

## What is here

- `index.js`: the host plugin. Registers `board_open`, `board_read`, `board_add` and `board_update` inside `ctx.inject(['tools'], …)`, with `defineTool` from `@deepseek-ai/dsh-tools`. Every agent in a profile that loads the plugin sees them; `tools.enabled: false` registers none.
- `lib/tools.js`: the tool bodies. Results are `{ ok: true, … }` or `{ ok: false, code, message }`, with the codes `not_bound`, `item_exists`, `item_unknown`, `invalid_input`, `board_unreadable` and `write_failed`.
  - `board_open({ key, parent? })` creates or opens a board and binds the session to it, in memory and in `sessions/<sessionId>.json`, so a resumed session finds its board without reopening it.
  - `board_read({ item?, status? })`: the tasks, the tree text, the flags, and the file's path and format version. The filters narrow the result only.
  - `board_add({ item?, what, status?, … })`: `item` defaults to the next integer, `status` to `next`. A field it does not know is refused (`invalid_input`); `extra` keeps anything else.
  - `board_update({ item, set? | remove? })`: `item` is one item or a list, changed in one write; one unknown item refuses the whole call. `null` in `set` clears a field. It returns `tasks` (after) and `previous` (before); a removal returns the removed tasks in `previous`, so `board_add` can put them back.
- `lib/config.js`: the config and its defaults, and `linkOptions(config, board)`, which turns the `links` patterns into the options of `refUrl` and `boardRows`.
- `lib/present.js`: one-line titles for the tool cards.
- `cordis.patch.yml`: the bundle patch (`dsh.bundle.patch`).
- `lib/task.js`: the task model. Statuses `next`, `now`, `waiting`, `done` and `dropped`; `done` and `dropped` are closed, so they block nothing. Fields: item, what, status, why, issue, pr, branch, worktree, provider, model, effort, nextAction, waitingOn, readyCommand, startWhen, parent, dependsOn, extra, updatedAt. Fields it does not know are kept.
- `lib/rows.js`: what each row says, derived and never stored: ready, blocked by, needs you (`waitingOn` is `owner`, in any case), progress (dropped counted apart from done), flags (`unknown_parent`, `unknown_dependency`, `parent_loop`, `duplicate_issue`, `duplicate_pr`), and links. Only full `http(s)` URLs link, unless the caller passes `links` URL patterns (`{ref}`, `{repo}`, `{number}`).
- `lib/tree.js`: the tree text, led by a Problems block. Bad data never moves a row.
- `lib/store.js`: `$DSH_HOME/data/dsh-cockpit/boards/<encodeURIComponent(key)>.json`, format `dsh-cockpit.board`, version 1, written by temp file, fsync, rename and directory fsync. A file it cannot read is never overwritten. `revision` counts changes to tasks or to the board's parent; a write that changes neither, such as a report-only drift result, does not bump it.
- `lib/drift.js`: the drift record. It keeps only the entries whose status differs from their task's, and `checked` counts every entry.
- `reader.js` (`@romany-saad/dsh-cockpit/reader`): `listBoards(dir?)`, `readBoard(keyOrFile, dir?)` and `boardTree(board)`, with no DSH imports. A miss names the folder it looked in and where `DSH_HOME` came from.
- `board.schema.json`: the file format as a JSON Schema, for a hub that writes the file without the plugin.

## Config

```yaml
- id: dsh-cockpit
  name: '@romany-saad/dsh-cockpit'
  config:
    tools: { enabled: true }      # false: register no tools
    route: { enabled: true }      # false: no routes, so no panel data (the routes come in a later step)
    drift: { command: '', cwd: '', mode: report }   # mode: report | apply (the runner comes in a later step)
    links: { issue: '', pr: '' }  # URL patterns with {ref}, {repo}, {number}; empty: only full URLs link
```

A profile patch with the same id replaces the whole config, so it restates the fields it keeps. For example, a profile on GitHub sets `links: { issue: 'https://github.com/{repo}/issues/{number}', pr: 'https://github.com/{repo}/pull/{number}' }`; `{repo}` comes from `owner/repo#12`, or for `#12` from the board's parent reference.

The peers are `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-home-paths`, which the profile's DSH provides.

## Test

```sh
pnpm test
```

## License

[MIT](../../LICENSE)
