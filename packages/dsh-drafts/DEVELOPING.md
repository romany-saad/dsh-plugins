# dsh-drafts: development notes

For maintainers. Users read [README.md](README.md).

## Layout

- `client.js`: the whole plugin, the browser half. A hand-written bundle with no build step, registered with `window.__ModuleLoader__.load`. The pure helpers are exported as `_internals` for tests only.
- `index.js`: the Node half, an empty plugin; DSH needs it to load the bundle.
- `cordis.patch.yml`: inserts the shared `dsh-core` row and the plugin into the profile.
- `docs/images/`: README screenshots. Not shipped in the package.
- `test/`: Node tests.

## The problem

DSH's ui-conversation persists each Session's composer draft in `localStorage` under `dsh.conversation.<sessionId>` (its `CONVERSATION_STORE_KEY`), as `{ draft, view, viewRequest }`. `draft` is a semantic snapshot `{ text, references, command? }`, or a legacy string. Drafts already survive switching between started Sessions.

A new conversation is a *blank* Session (no turn started). ui-workspace shows only the **current** blank in the sidebar, and New Session with no options calls `sessions.create({ workspaceId })` with no `sessionId`, so it always creates another blank. The old blank's draft stays in storage with no way back to it.

## How it works

| Need | Extension point |
|---|---|
| The card above the composer | `conversation.input.dock` slot entry `rs-dsh-drafts`, order `-10`. It uses the slot's standard `useSession`, `useSessions` and `useWorkspaces` hooks. |
| Show only in a new conversation | The current `SessionSnapshot` is `blank`, has no `promptAttempted`, and is not `running`. |
| Which drafts are lost | `lostDrafts`: a non-empty `dsh.conversation.<id>` entry whose Session is in `sessions.list` `ids`, is `blank`, is not in `workspaces.archivedSessionIds`, is not a subagent (`origin`/`parentId`), and is not the current one. Sorted by `updatedAt`. |
| Open | `sessions.create({ sessionId, workspaceId, agentPreset? })`: the Host reuses a named blank that is still eligible (same directory, unarchived member of the Workspace, no other writer) and resumes a persisted one; then `uiWorkspace.openSession(id)`. The preset is the one the blank's log recorded (`projectionValues.agentPreset`), retried without it on `agent-preset/not-found` or `agent-preset/invalid`, as ui-workspace's own startup restoration does. If the Host returns another id, the draft snapshot is copied to that id's entry before navigation and the old entry is cleared, so the new Session's input imports it on first read. |
| Discard | Set the entry's `draft` to `''`, keeping `view`; if the Session is loaded, `conversation.input.for(sessions.scope(id)).setDraft({ text: '', references: [] })` too, so its in-memory store cannot write the draft back. Undo writes the saved raw entry back, and the snapshot into a loaded input. |
| React to changes | A local version counter bumped after the plugin writes storage, plus the window `storage` event for other tabs. Session and Workspace lists come from the hooks. |

A discarded row is kept in the dock's own state, in its place, until the dock unmounts, so Undo stays in reach.

The card copies the look of DSH's own todo dock (`TodoPanel`) with design tokens. Classes are `dr-`-prefixed under `[data-rs-dsh="dsh-drafts"]`; buttons are DSH's `Button` from `rsDshCore.ui`.

### Why not patch New Session

Making New Session reuse the Workspace's blank (calling `startSession(id, { clearPreviousDraft: false })`) would mean wrapping another plugin's service method at runtime, would change documented DSH behavior, and would reach only the first blank in list order. The dock leaves DSH's behavior alone and handles any number of lost drafts.

## Test

```sh
pnpm --filter @rs-dsh/dsh-drafts test
```

`client.test.js` loads the real `client.js` in a Node `vm` for the pure helpers. It also reads the pinned `@deepseek-ai/dsh-client-ui-conversation` bundle (a dev dependency) and checks that the storage key is still `dsh.conversation.<sessionId>`; when a DSH update moves it, this test fails. `apply.test.js` renders the dock with the real dsh-core on a jsdom page with real React (dsh-core's `test/dom.mjs`): a blank conversation lists the other blank's draft, a started one shows nothing, Open resumes or copies, and Discard and Undo. A setup file makes `fetch` throw, so no test reaches the network.

The flow was also checked end to end with Playwright against a running DSH 0.2.1-rc.2 in a separate `DSH_HOME`: type into a new conversation, press New Session, type another, press New Session, then Discard, Undo, Open and a page reload. That run is not part of `pnpm test`.

## Screenshots

[CONTRIBUTING.md](../../CONTRIBUTING.md#screenshots) sets the rules. The current set was taken in a separate `DSH_HOME` with a scratch profile (`@deepseek-ai/dsh-web-app`, this package by path) and its default workspace, light theme, 1400 × 900 at 2× scale, cropped to the new-conversation hero. Retake them when a change alters what they show:

| File | Shows |
|---|---|
| `unsent-drafts.png` | Two unsent drafts above a new conversation's message box |
| `opened-draft.png` | An opened draft back in the message box, the other still listed |
| `discard-undo.png` | A discarded row with Undo |

`screenshots.json` lists these images, in this order, for plugin storefronts that read the awesome-dsh-plugin catalog; keep it in step when you add, rename or drop one. `icon.svg` is the icon DSH's Plugins page shows, and `docs/icon.png` the storefront tile rendered from it (see [CONTRIBUTING.md](../../CONTRIBUTING.md#plugin-catalog)).

## Release

Bump `version` in `package.json`, add a `CHANGELOG.md` entry, update the version in the README's install lines, merge, then push the tag `dsh-drafts@<version>`. `.github/workflows/publish.yml` publishes it.
