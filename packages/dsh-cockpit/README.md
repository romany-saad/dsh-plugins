# @rs-dsh/dsh-cockpit

A task board for a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) hub, the session that coordinates the work of an effort across many pull requests. The board is a tree of steps, each linked to its issue and PR, kept as a local file that you and your scripts can read.

## What you get

- **Four board tools** for the agent: open a board, read it, add steps and update them.
- **The Board tab** in the web GUI's right sidebar: a "Needs you" list of what waits on you, which steps are blocked and which are ready, links to their PRs and issues, and drift.
- **A progress strip** above the chat input: how far the board is, and what is blocked or needs you.
- **A card per board tool call** in the chat.
- **A small reader** for scripts, with no DSH needed.

The panel and the strip only show the board. They run no command and change nothing.

## Install

```sh
dsh plugin --profile <name> add @rs-dsh/dsh-cockpit@0.1.2
```

If npm is not an option, install from git instead, pinned to the release tag: `'github:romany-saad/dsh-plugins#dsh-cockpit@0.1.2&path:packages/dsh-cockpit'`.

The Board tab, the strip and the chat cards need a profile with `@deepseek-ai/dsh-web-app`, such as `web`.

## Configure

It works with no config. To change something, add a row to the profile's `cordis.patch.yml`, naming only what you change. To link `#12` and `owner/repo#12` to GitHub:

```yaml
- id: dsh-cockpit
  name: '@rs-dsh/dsh-cockpit'
  config:
    links:
      issue: 'https://github.com/{repo}/issues/{number}'
      pr: 'https://github.com/{repo}/pull/{number}'
```

For `#12`, `{repo}` comes from the board's parent ticket. Without `links`, only full URLs become links.

- `tools: { enabled: false }` registers no board tools.
- `route: { enabled: false }` turns off the data the Board tab and the strip read, so they show nothing.

### Drift

Drift is a step whose status no longer matches its work, such as a merged PR on a step that still says `waiting`. The plugin knows no tracker, so the check is a command you configure, `drift: { command: '...', cwd: '...' }`; it runs only when the agent asks for a drift check. In `mode: report` (the default) it only reports the differences, and the hub decides what to change; in `mode: apply` it sets the reported statuses itself. [`examples/board-drift-gh.sh`](examples/board-drift-gh.sh) is an example to copy: it reports steps whose PR `gh` says is merged.

## Use

Ask the hub to keep a board for the effort, or let it use the tools on its own:

- **Open a board** with a key, such as `bosla-883`, and optionally the parent ticket. The session stays bound to it, also after a resume.
- **Add steps**, each with what it is and its issue or PR. `parent` puts a step under another; `dependsOn` lists steps that come first, so a step shows as blocked until they are done.
- **Update a step** as the work moves: `next`, `now`, `waiting`, `done` or `dropped`, and a next action.
- **Needs you:** a step with `waitingOn: owner` shows in the "Needs you" list and on the strip, with its next action and a command to copy.

## Reading a board from a script

```js
import { readBoard, boardTree } from '@rs-dsh/dsh-cockpit/reader'
const board = await readBoard('bosla-883')
console.log(boardTree(board).tree)
```

`listBoards()` lists the keys. Boards are read from `$DSH_HOME`, or `~/.dsh`.

## Links

- Design and decisions: [issue #1](https://github.com/romany-saad/dsh-plugins/issues/1)
- [CHANGELOG](CHANGELOG.md)
- Working on the plugin: [DEVELOPING.md](https://github.com/romany-saad/dsh-plugins/blob/main/packages/dsh-cockpit/DEVELOPING.md)
- License: [MIT](LICENSE)
