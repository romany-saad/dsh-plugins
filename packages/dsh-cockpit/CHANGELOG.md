# Changelog

## 0.6.0-rc.10

- **Running shows nested running agents.** In the Agents view, **Running** hid an agent that had finished, and so also every agent still running under it: a finished parent with a running subagent left the view empty, or saying "No subagents are running". Running now keeps a finished agent when one below it still runs, dimmed, so the path down to the running one stays visible.
- **The graph no longer draws a parent's dependency on its own steps.** A parent is done when its steps are, so a `dependsOn` from a parent to one of its own steps, at any depth, says nothing new, and its box already holds them. Those lines are gone, and hovering or pinning the parent no longer lights them. A parent's dependency on a step outside its box is still drawn, as is every dependency between steps. The board data, the list view and what counts as blocked are unchanged.

## 0.6.0-rc.9

- **A right-click menu on every step.** Right-click a step in the List or the Graph, a parent row or box included, or focus it and press Shift+F10 or the menu key. It is DSH's own menu, as on sessions and files. Cockpit's actions copy only: **Copy title**, **Copy step id**, **Copy ready command**, and **Copy PR link** and **Copy issue link** when the step has them. The menu changes nothing on the board. A copy the browser refuses says so in a toast.
- **`/cockpit-delegate`: keep this session free.** A new bundled skill. Type `/cockpit-delegate` (or ask the agent to delegate everything) and for the rest of the conversation the session coordinates instead of working: it hands each piece of work to a subagent with a full brief, records who works on which step on the board, tells you in a line and ends its turn, so you can keep talking, ask questions and steer while the work runs. Follow-ups on a long effort go to the same subagent with `send_message`, so it keeps its context; a new one starts only for a separate line of work. When a subagent reports, the session checks its work, updates the board and tells you. If delegation is not available (a depth or capacity limit, a model not allowed), it asks you instead of doing the work silently. Say "stop delegating" to go back to normal.
- **Copying works over plain HTTP.** On an address that is neither HTTPS nor localhost, such as a server bound to a LAN or Tailscale IP, the browser has no clipboard API, so every copy failed with "Could not copy". Copies now fall back to a hidden text field there. This also fixes the **Copy** buttons on ready commands and in Needs you.
- **Other plugins can add to it.** The menu's target is `dsh-cockpit.step`: a plugin registers its own actions with `ctx.contextMenus.register({ target: 'dsh-cockpit.step', … })`, with no import from cockpit, and gets the step's id, title, status, parent, issue, PR, links and ready command. See "Add actions to the step menu" in the README.
- Without DSH's menu service the board has no right-click menu and works as before.

## 0.6.0-rc.8

- **An Agents view.** The view switch on the Board tab is now **List | Graph | Agents**. Agents shows this session's subagents and the ones they started, at any depth, each under its parent, as DSH's subagent menu in the conversation header lists them: the same status dot (a spinner while it runs, green once it completed), label, task, mode, tokens and time, and under them the model it runs on and its effort ("claude-sonnet-5-5 · high"), updating live as they start and finish. A line at the top counts the whole tree ("3 running · 6 in all"); **Running** / **All** filters it, **Collapse all** / **Expand all** folds every branch, and the arrow on a row folds that one. Click a row to open that subagent, or the arrow at its end to open it in the sidebar. A board with no steps yet offers it too, beside **Steps**. The choice of view and of Running or All is kept in this browser.
- **From the list back to the graph.** Double-click a step in the list, or a parent's row, to open the graph with that step selected, as if you had clicked it there: it and its direct links stay lit and it is scrolled into view. A double-click on a link, a button or the opened details does nothing. With a double-click from the graph opening the list at a step, you can now go both ways. Switching with **List | Graph** still opens the graph with nothing selected. Screenshots are unchanged: they show neither double-click.
- **The Inbox is a card.** Its items and **Add item…** now sit in one bordered card, drawn like the step groups: a tinted header with the title, the open count and **Refine all**, the items as rows with dividers, and **Add item…** as the last row. Before, they sat loose between Needs you and the steps. Nothing it does changes. `board-tab.png` and `inbox-tab.png` are retaken.

## 0.6.0-rc.7

- **Nested steps line up under their title.** On a step nested below another step, the lines under its title (next action, waiting on, blocked by, the ready and Needs you tags) and its opened detail (Reason, Model, the command) started at the row's left edge, left of the indented title. They now start where the title's text does, after its indent and elbow.
- **Parents are boxes in the graph.** A parent is now a box that holds its steps, with its status mark, title and count in its header, instead of a node joined to its children by lines. Nested parents nest their boxes. Only dependencies are drawn as lines, so the graph has fewer lines to follow. A step that depends on a step inside another box sits below that whole box. Double-clicking a box or a step opens the list at that row.
- **Click a step in the graph to keep its links lit.** A click keeps the hover highlight on that step (outlined in blue) after the pointer leaves, and hovering other steps leaves it alone. Click it again, click an empty spot or press Esc to clear it; clicking another step moves it. A double-click opens the list at the step, as a single click did before. Enter or Space on a focused step pins it too. A line under the dependency key says so.
- **Lit lines show which way a dependency goes.** While a step is hovered or pinned, the dashes of its lit dependency lines run from the step that comes first toward the step that waits for it. Nothing else on the board moves, nothing moves when no step is lit, and with the system setting for reduced motion the lines stay still.
- **Hover a step in the graph to see what it connects to.** In the graph view, pointing at a step (or tabbing to it) dims every other step except the ones it depends on and the ones that depend on it, one step each way, and keeps only their dependency lines bright. Parent lines are not followed. Moving away undims everything.
- **A next step's mark matches its bar segment.** A step to do next that nothing blocks has a green ring, as its segment has a green border; one that waits on another step has a dashed grey ring, as its segment is dashed. Before, both were the same grey ring, so the row and the bar disagreed. The mark's tooltip says "next · ready" or "next · blocked". The graph's nodes use the same marks.
- **No "ready" tag on the rows.** A step to do next that nothing blocks no longer carries a green "ready" tag: almost every such step had one, so it added noise. A step that is still waiting on another says "Blocked by …" as before. The bars and the Whole board key still count ready steps.
- **A wider progress bar on the strip on desktop.** When the strip above the message box is 640 px or wider, its bar is about 28 px a step, at least 120 px and at most a quarter of the strip (280 px at most); a continuous bar takes that most. Before, it was 10 px a step, between 48 and 120 px, so a board with a few steps showed a 48 px bar. A narrower strip keeps the old sizes.
- **Screenshots.** `board-tab.png` (no ready tag, the new marks) and `board-graph.png` (parents as boxes) are retaken.

## 0.6.0-rc.6

- **Show or hide Needs you.** The **Needs you** title at the top of the Board tab is now a button: **Hide** folds the cards into one line with the count, **Show** opens them again. The choice is kept in this browser, across reloads and boards. A hidden section still shows its count, so a step that needs you stays in sight, and the rows and the strip still mark it.
- **A graph view.** A **List | Graph** switch above the steps. The graph draws each step as a node with its status mark: a parent above its children (solid lines) and a step above the steps that depend on it (dashed). It fits the tab's width, wrapping a wide layer onto more rows, so it never scrolls sideways. Click a node to go back to the list at that row. The choice is kept in this browser.
- **The whole-board bar shows the board's state and lines up with the group bars.** The **Whole board** summary moved from the header into the first card above the sections, drawn like a parent's header, so its bar starts and ends where every group bar does at any width. Under it, a key counts each state present (done, in progress, needs you, waiting, ready, blocked, dropped). When a bar is too narrow or too long for its segments (above 24), it is no longer only a done fill: it shows one run per state, in proportion, each at least 2 px. This applies to the strip's narrow bar too.

## 0.6.0-rc.5

- **Your actions use `user`, not a project-ownership title.** Tool descriptions, the board schema and process-stage actors now use `user`. Tasks with `waitingOn: user` appear in **Needs you**, in the progress strip and in the agent’s per-turn context. Names and specific roles remain free-form waiting targets.
- **Existing data still works.** Board waits using `owner` remain a case-insensitive, whitespace-tolerant legacy alias. Process maps using `who: owner` are read as `who: user` without rewriting the file; the next approved save uses the new value.

## 0.6.0-rc.4

- **The agent is told about board problems.** When the board has a flag (the same PR or issue on two tasks, an unknown parent or dependency, a parent loop), the per-turn context now lists it under "Board problems", up to five lines and then "and N more", until it is fixed. The context reads the board file on every turn, so a mistake made outside the session shows too. Before, the flags came back in a write's result and nothing asked the agent to look at them, so a duplicate PR went unnoticed.
- **Fix only what is wrong.** The instructions say to fix a flagged case only when it is actually wrong, such as a PR recorded on the wrong task, and to leave it as it is when it looks intentional.

## 0.6.0-rc.3

- **Inbox buttons send.** **Refine**, **Refine all** and **Clear** now queue their request for the agent in one click, instead of only filling the message box. They still refuse when the message box holds a draft, so nothing you typed is sent or replaced, and they work while other messages are already queued (the click goes behind them). **Add item…** still fills the box, because you type the text. New config `inbox.sendOnClick` (default `true`); `false` restores fill-only.

## 0.6.0-rc.2

- **Fix `text.indexOf is not a function` during turn prompt assembly.** `rs-dsh:cockpit-context` now returns synchronous string context from memory cache with `interpolate: false`, while the `system-prompt/assemble` waterfall handles asynchronous cache populating on session resume. This fixes turn failures across all DSH versions (including `0.2.1-rc.2` and `0.2.1-rc.5`).

## 0.6.0-rc.1

Per-project process maps, flow stages, process updates, and todo replacement ([#52](https://github.com/romany-saad/dsh-plugins/issues/52), [#53](https://github.com/romany-saad/dsh-plugins/issues/53), [#29](https://github.com/romany-saad/dsh-plugins/issues/29), parts 2, 3 & 4 of [#50](https://github.com/romany-saad/dsh-plugins/issues/50)).

- **Board replaces the todo list (`replaces.todo`).** When a board is bound, `todo_write` is masked for the session agent via `ctx.tools.restrict`. Subagents retain their private todo lists. The tool mask is lifted if the board cannot be read or if `replaces.todo: false` is configured.
- **Goal integration via dynamic context.** `rs-dsh:cockpit-context` supplies the current board's next ready steps, active work, and user-waiting blockers to the model at each turn, and guides completion when all board tasks are closed.

- **Process map.** `.dsh/cockpit/process.yml` records ordered workflow stages, exit checks, who acts, skills in order, command templates, kind filters, and when/skipIf hints.
- **`board_process` tool.** Actions `read`, `propose`, `save`, and `adopt`. `propose` validates draft maps and returns a structured diff; `save` requires explicit user confirmation, saves the YAML file atomically, bumps the revision, and logs the change summary; `adopt` applies the new process revision to open items without modifying completed stages.
- **`cockpit-process` skill.** Bundled skill to discover and draft the project workflow from CONTRIBUTING, AGENTS.md, CI workflows, and skills.
- **Source drift detection.** Changes to recorded source files (such as CONTRIBUTING.md) are detected via SHA-256 hashes and flagged on `board_open`, `board_read`, and in the Board tab (`⚠️ Process may be out of date`).
- **Flow on tasks.** Tasks can track `flow: { revision, stages, at, skipped }`. Skipped stages must provide non-empty reasons. Materialized stage tasks carry `stage: "<id>"` linking to parent flow.
- **Compact & Expanded views.** Compact view displays the stage track directly on the task row; expanded view displays all flow stages and details. Progress counts each stage consistently in both views without double counting.

## 0.5.0

An Inbox for ideas noted for later, and a skill that refines them into steps ([#51](https://github.com/romany-saad/dsh-plugins/issues/51), part of [#50](https://github.com/romany-saad/dsh-plugins/issues/50)). The board format stays version 1. A board without an Inbox reads and draws as before.

- **Inbox.** "item for later", "todo next" and the like in the chat add the text to the board's Inbox, as said, and the agent goes on with the current work. The first item opens a board when the session has none. Items stay outside the step tree: not counted in progress and never a parent or a dependency.
- **`board_inbox` tool.** Its actions are `add`, `update`, `drop`, `reopen`, `clear` (hide a refined or dropped item, kept in the file) and `delete` (for mistakes; returns the item). `board_read` and `board_open` return the inbox, and the tree text ends with it. `board_read({ inbox: 'all' })` includes cleared items.
- **`refines` on `board_add` and `board_update`.** Links Inbox items to the steps they became, in the same write, with `refinedWith` naming the skill that did the analysis. An unknown or dropped item refuses the call.
- **`cockpit-refine` skill.** Bundled with the plugin, for the agent and as `/cockpit-refine`. It relates the items to the board, closes the gaps with you, proposes the steps, and writes them after your yes. It can hand the analysis to another skill: name one in the run (`using grill-me`) or in the new config `inbox.refineSkill`. It runs in the session by default, or in a subagent for an item that needs research.
- **Board tab.** An Inbox section above the steps, with what each item became. **Add item…**, **Refine**, **Refine all** and **Clear** put the request in the message box for you to send, so the tab still writes nothing; a draft already there is left alone. Add item… also shows with no board yet. The strip says "N in inbox".
- **Revision.** A change to the Inbox counts as a change to the board, so it bumps `revision`.

## 0.4.0

Agents plan multi-step work on a board instead of DSH's todo list (first part of [#29](https://github.com/romany-saad/dsh-plugins/issues/29)). The Board tab, the strip, the tools' behaviour and the board format are unchanged.

- **When to open a board.** Cockpit's instructions now tell the agent to open a board, or keep using the session's board, and to add the steps before it starts any work that takes several steps. While it uses a board, it doesn't keep the todo list as well. A question or a one-step request gets no board. A subagent reports to the agent that gave it the task and opens no board of its own. Before, the instructions only applied once a board was open, and told the agent not to open one because of them. So agents used the todo list and the board stayed empty.
- **Not only for hubs.** The tool descriptions say when to use each tool, and no longer call the board the hub's. The README, the package description and the Board tab's empty state describe the board as the plan for any multi-step work.
- **Config.** `planning: { enabled: false }` leaves the new rule out. The rules for keeping an open board current stay.

## 0.3.3

- **Declares the DSH versions it supports.** `engines.dsh` is `>=0.2.1-rc.2 <0.3.0-0`, the DSH 0.2 line it is tested with. DSH checks it before installing, and plugin markets show it as the version's compatibility. Nothing else changes.

## 0.3.2

- **An icon.** DSH's Plugins page now shows the plugin's own icon instead of the default artwork, in the light and dark themes. Nothing else changes.

## 0.3.1

Cockpit asks agents using a board to keep it current and avoid unverified completion. This is guidance rather than automatic tracking; the visible board and screenshots are unchanged.

- **Agent guidance:** reconcile existing board tasks at meaningful transitions and before handoff, use verified facts, and keep blockers and next actions current. Sessions do not create boards solely because of this guidance.
- **Session binding:** board tools reread the persisted session binding so a rebind from another instance or a failed open cannot leave tools using a stale cached board while the GUI shows another.

## 0.3.0

The board tools refuse a reference to a step that is not on the board. The Board tab, the strip, config and the board format are unchanged.

- **Tools:** `board_add` and `board_update` refuse a `parent` or `dependsOn` that names a task not on the board, with the new code `unknown_reference`, and change nothing. The message names the missing items and says to add them first, then link them. Before, such a reference was stored and only flagged, so a typo or a step the agent never added left the board with a dangling dependency. Clearing a reference (`null`) is never refused. A removed task, or a hand-written board file, can still leave a reference to a task that is gone; it is flagged as before.

## 0.2.1

The Whole board bar and the strip order their segments as the Board tab orders its sections. Tools, config and the board format are unchanged.

- **Board tab and strip:** the Whole board bar and the strip now order their segments the way the sections below are drawn: each parent's subtree in turn, then the standalone tasks. Before, a standalone task listed before or between parents in the board file came first or in the middle of the bar, though its section is last.

## 0.2.0

The Board tab and the strip show the whole board, and the tab takes less room and looks like the rest of DSH. Tools, config and the board format are unchanged.

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
