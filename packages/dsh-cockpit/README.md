# @romany-saad/dsh-cockpit

A durable task board for a DeepSeek Harness hub session: a tree of steps, each linked to its work, kept as one local JSON file per board that other processes can read.

**Status: proof of concept** (branch `poc/dsh-cockpit`). Not published.

## What is here

- `index.js`: the host plugin. Registers `board_open`, `board_read`, `board_add`, `board_update` in `ctx.inject(['tools'], …)`. Results are `{ ok: true, … }` or `{ ok: false, code, message }`.
- `lib/store.js`: `$DSH_HOME/data/dsh-cockpit/boards/<encodeURIComponent(key)>.json` (format `dsh-cockpit.board`, version 1), written by temp file, fsync, rename and directory fsync; `sessions/<sessionId>.json` binds a session to its board. A file that does not parse, or has an unknown version, is never overwritten (`board_unreadable`).
- `lib/tree.js`: the tree text and the flags `unknown_parent`, `unknown_dependency`, `parent_loop`.
- `lib/drift.js`: the optional `drift.command`, run only on `board_read({ checkDrift: true })`, with the board on stdin and `DSH_HOME`, `DSH_COCKPIT_KEY`, `DSH_COCKPIT_FILE` in its environment.
- `reader.js` (`@romany-saad/dsh-cockpit/reader`): `listBoards(dir?)`, `readBoard(keyOrFile, dir?)`, `boardTree(board)`, with no DSH imports.

Task fields: item, what, status (next | now | waiting | done), why, issue, pr, branch, worktree, provider, model, effort, nextAction, readyCommand, parent, dependsOn, extra, updatedAt.

## Config

```yaml
- id: dsh-cockpit
  name: '@romany-saad/dsh-cockpit'
  config:
    tools: { enabled: true }
    drift: { command: '', cwd: '', mode: report }   # mode: report | apply
```

## Try it

```sh
npm test                                   # node --test, against the installed DSH
node poc/simulate.mjs list                 # the hub asks A1..F2 (DSH_HOME defaults to /tmp/cockpit-poc-home)
node poc/simulate.mjs A1                   # one ask per run; prints calls, PASS/FAIL, the tree
node poc/simulate.mjs reset
DSH_HOME=/tmp/x node poc/simulate.mjs all  # every ask, for testing
```

## License

[MIT](../../LICENSE)
