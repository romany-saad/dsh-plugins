# @romany-saad/dsh-cockpit

A durable task board for a DeepSeek Harness hub session: the session that coordinates builders across many pull requests. A board is a tree of steps, each linked to its work by free-form fields, and it is kept as one local JSON file that other processes can read.

**Status: in development.** The design is in [issue #1](https://github.com/romany-saad/dsh-plugins/issues/1). This package does not register any tools yet; the plugin, drift, routes and the web panel follow in later pull requests.

## What is here

- `lib/task.js`: the task model. Statuses `next`, `now`, `waiting`, `done` and `dropped`; `done` and `dropped` are closed, so they block nothing. Fields: item, what, status, why, issue, pr, branch, worktree, provider, model, effort, nextAction, waitingOn, readyCommand, startWhen, parent, dependsOn, extra, updatedAt. Fields it does not know are kept.
- `lib/rows.js`: what each row says, derived and never stored: ready, blocked by, needs you (`waitingOn` is `owner`, in any case), progress (dropped counted apart from done), flags (`unknown_parent`, `unknown_dependency`, `parent_loop`, `duplicate_issue`, `duplicate_pr`), and links. Only full `http(s)` URLs link, unless the caller passes `links` URL patterns (`{ref}`, `{repo}`, `{number}`).
- `lib/tree.js`: the tree text, led by a Problems block. Bad data never moves a row.
- `lib/store.js`: `$DSH_HOME/data/dsh-cockpit/boards/<encodeURIComponent(key)>.json`, format `dsh-cockpit.board`, version 1, written by temp file, fsync, rename and directory fsync. A file it cannot read is never overwritten. `revision` counts changes to tasks or to the board's parent; a write that changes neither, such as a report-only drift result, does not bump it.
- `lib/drift.js`: the drift record. It keeps only the entries whose status differs from their task's, and `checked` counts every entry.
- `reader.js` (`@romany-saad/dsh-cockpit/reader`): `listBoards(dir?)`, `readBoard(keyOrFile, dir?)` and `boardTree(board)`, with no DSH imports. A miss names the folder it looked in and where `DSH_HOME` came from.
- `board.schema.json`: the file format as a JSON Schema, for a hub that writes the file without the plugin.

## Test

```sh
pnpm test
```

## License

[MIT](../../LICENSE)
