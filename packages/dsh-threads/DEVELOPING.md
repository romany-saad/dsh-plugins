# dsh-threads: development notes

The package was `@rs-dsh/dsh-comment` up to 0.1.0-rc.1. That name is deprecated on npm and points here.

For maintainers. Users read [README.md](README.md).

## Layout

- `client.js`: the browser half, on dsh-core. A hand-written bundle with no build step, registered with `window.__ModuleLoader__.load`. Its pure helpers are exported as `_internals` for tests only.
- `index.js`: the Node half. It builds the service and registers the routes.
- `lib/threads.js`: the record format, anchor and comment checks, and the fold from session events to threads. No DSH imports.
- `lib/session-text.js`: session events as text, and the replier's three session tools. No DSH imports.
- `lib/host-tools.js`: the replier's file and web tools, over DSH services passed in. No DSH imports.
- `lib/reply.js`: the opening prompt and the reply loop.
- `lib/service.js`: list, create, comment, retry and delete; background replies; one write at a time per session.
- `lib/route.js`: the Fetch routes.
- `lib/config.js`: config and defaults.
- `docs/images/`: README screenshots. Not shipped in the package.
- `test/`: Node tests.

## How it works

### Storage

A thread is stored whole after every change, as `plugin:dsh-threads/thread` `{ v: 1, sessionId, thread }`, with `appendPluginRecord` on the live session followed by `sessions.flush`. A deletion is `plugin:dsh-threads/thread-delete` `{ v: 1, sessionId, threadId }`. `foldThreads` also reads the same records under the first name, `plugin:dsh-comment/thread` and `plugin:dsh-comment/thread-delete`, and never writes them; a change to such a thread is written under the new name and wins. Reading folds the log from `sessionQuery.readSession`, so running and stopped sessions read the same way.

What that gives, from the DSH source (0.2.1-rc.2):

- **Model history.** Plugin records carry `ignorable: true` and no surface operation, so `deriveMessages` never sees them. A test checks this against a real `Session`.
- **Compaction and full-text search.** Both skip them.
- **Export.** The session-log export writes them as they are.
- **Fork.** A fork copies them. `foldThreads` keeps only records whose `sessionId` matches, which is how a fork starts empty.

The dsh-session README asks plugins outside the DSH repository not to call `appendPluginRecord`. Its CI check covers only the DSH repository. We use it because it is the one writer that keeps a live session's log, its in-memory state and persistence in step. If DSH adds a public plugin-record API, move to it.

Writes need a live session (`sessions.get(id)`), and answer `inactive` (409) otherwise. Writing to a stopped session would need a persistence write handle and its lock, as dsh-message-feedback does. That is deferred.

### The reply

`runReply` calls `ctx.llm` directly:

- **No subagent.** A `spawn` subagent would add a `subagent/catalog` entry to the session, save a child session, and need an agent preset to limit its tools.
- **The route.** It is the session's current one, as DSH's `modelSelection` projection folds it: the user's pending pick, else the last request header's.
- **One `prepareCall` per round**, because a prepared call streams only once.
- **Tools.** Every round but the last offers read-only tools. Three read the events already read: `session_outline`, `find_in_session` (literal text, because full-text search is off in the web profile) and `read_event`. They read only this session.
- **File and web tools** (`lib/host-tools.js`) are our own, not DSH's registered tools: those run through `ctx.tools` with an agent, and with no agent they would read the process's cwd, skip the session's permission state, and record observations. Ours call host services directly:
  - `read_file`, `list_dir` on `ctx.fs`, resolved against the session's working directory: the last `working-directory/change` in the log, else the header's `cwd`.
  - `glob`, `grep` run the ripgrep binary that `@deepseek-ai/dsh-tool-fs-search` ships (`resolveRgPath`) through `ctx.subprocess`, with `--no-config` (a `RIPGREP_CONFIG_PATH` could add `--pre`) and every model value as one argv element after `--`. Without the package or the service, the two tools are not offered.
  - `web_search`, `web_fetch` call `ctx.web` and format with `@deepseek-ai/dsh-tool-web`'s `formatSearchOutput` and `formatFetchOutput`, which label the content as untrusted. Off unless `reply.web`.
  - Both packages are optional peers, imported lazily. DSH's profile resolver routes them to the installation's copies, as it does `dsh-session`; if one fails to load, its tools are not offered.
  - Each result is capped at 12 000 characters.
- **Nothing is logged** to the session except the finished reply, as a thread record.

Replies run in the background. The browser polls `threads` every 1.5 s while one is pending. Reply state (`replying`, `failure`) lives in memory, so a restart drops a pending reply and the thread waits for **Try again**.

### Routes

The routes are exact Fetch routes on the host connection, as in dsh-cockpit: owner-only, behind the launch-token cookie. A Typert Remote is not an option, because the browser side needs a generated codec that only first-party packages ship.

| Route | Method | Body / query | Answer |
|---|---|---|---|
| `/api/dsh-threads/threads` | GET | `?sessionId=` | `{ threads, canWrite }` |
| `/api/dsh-threads/create` | POST | `{ sessionId, anchor, text }` | the thread |
| `/api/dsh-threads/comment` | POST | `{ sessionId, threadId, text }` | the thread |
| `/api/dsh-threads/retry` | POST | `{ sessionId, threadId }` | the thread |
| `/api/dsh-threads/delete` | POST | `{ sessionId, threadId }` | `{ deleted }` |

Expected failures answer `{ error, message }` with a 4xx or 5xx status. Anything else answers only its error code, never a message that could hold a path.

### Anchors

An anchor names the message and the passage:

- **Your message:** `{ kind: 'user', messageId }`.
- **A reply:** `{ kind: 'assistant', turn, step }`.
- **Reasoning:** `{ kind: 'reasoning', turn, step, block }`.

Each also carries `text` plus up to 64 characters of `prefix` and `suffix`, all without whitespace. The browser reads them from the row's `data-chat-node-key`:

- `13:input-message<id>` for your messages;
- `14:assistant-step<turn>:<step>` for replies.

These keys come from durable log facts, but they are not a documented API. `parseNodeKey` and `nodeKeyOf` are the only places that know the format.

To find a passage again, the browser:

1. joins the row's text nodes without whitespace (skipping tool rows, reasoning and buttons inside a reply);
2. finds every occurrence of the passage;
3. keeps the one whose prefix and suffix match best.

Whitespace is ignored because the rendered Markdown and the selection string differ in it.

### Highlights and badges

The highlights use the CSS Custom Highlight API (`CSS.highlights`), so the host's nodes are never changed. A `MutationObserver` places them again when the chat re-renders, and so does expanding a reasoning block. Highlights take no clicks, so a click is matched to its highlight through `caretPositionFromPoint`. Badges sit in a fixed layer of their own, in the gutter right of the row, level with the passage's first line.

### Send to chat

The chip reuses dsh-quote's approach. It is an `inputTriggers` source with a codec, and its ref carries the whole thread, so a draft restored after a reload still serializes. At send, the chip becomes this block:

```
<comment-thread>
(A side thread: …)
<passage>
…
</passage>
<comment>…</comment>
<reply>…</reply>
</comment-thread>
```

A user-text rule and a `conversation.user.text.node` entry render that block as a card. `escapeTags` keeps a passage from closing a tag early.

## The rs-dsh core

The Comment button, the comment box and the thread come from [@rs-dsh/dsh-core](../dsh-core/DEVELOPING.md) (`ctx.rsDshCore`):

- **The toolbar.** `selection.register` puts the button in the shared toolbar. Its `when` hides the button where `anchorFor` gives no anchor.
- **The cards.** `popover.open` draws the comment box and the thread on DSH's `MenuSurface`.
- **The components.** DSH's `InlineEditor`, `Button`, `MarkdownText` (the AI replies, with the compact variant's text in the primary colour) and `TextShimmer` (Thinking…).

The thread follows the plugin's store through `useSyncExternalStore`, so polling and the highlights update it while it is open. The plugin's own CSS (badges, the cards in sent messages, highlights) is scoped under `[data-rs-dsh="dsh-threads"]`, with `th-` classes.

## Test

```sh
pnpm --filter @rs-dsh/dsh-threads test
```

- `client.test.js` loads the real `client.js` in a Node `vm` for the pure helpers.
- `apply.test.js` runs it with the real dsh-core on a jsdom page with real React (dsh-core's `test/dom.mjs`) and a fake host route: the toolbar button, posting, polling, Markdown replies, Send to chat, badges, read-only sessions and cleanup.
- `host-tools.test.js` runs the file tools over a temp directory with the real packaged ripgrep, and the web tools on a fake `ctx.web` with dsh-tool-web's real formatters.
- `service.test.js` runs the service over a real `Session` (`appendPluginRecord` as DSH writes it) and the real `BlockAssembler`, with a scripted model that, like DSH, refuses a second stream of one prepared call.
- A setup file makes `fetch` throw, so no test reaches the network.

The browser half was also checked end to end with Playwright against a running DSH in a separate `DSH_HOME`, with a real model. That run is not part of `pnpm test`.

## Screenshots

[CONTRIBUTING.md](../../CONTRIBUTING.md#screenshots) sets the rules. The current set was taken in a separate `DSH_HOME` with a scratch profile (`@deepseek-ai/dsh-web-app`, this package by path) and a demo prompt about a fetcher cache. Light theme, 1400 × 900 at 2× scale, cropped to the conversation column. Retake them when a change alters what they show:

| File | Shows |
|---|---|
| `select-comment.png` | The Comment button over a selection |
| `new-comment.png` | The comment box with a typed question |
| `thread-reply.png` | An open thread with the AI reply |
| `highlights.png` | Two highlighted passages with their badges |
| `composer-chip.png` | A thread chip in the message box |
| `sent-card.png` | The sent message with the thread card expanded |

## Release

Bump `version` in `package.json`, add a `CHANGELOG.md` entry, update the version in the README's install lines, merge, then push the tag `dsh-threads@<version>`. `.github/workflows/publish.yml` publishes it. A version with `-`, such as `0.1.0-rc.1`, goes to npm's `next` tag.
