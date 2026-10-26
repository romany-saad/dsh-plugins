# dsh-quote: development notes

For maintainers. Users read [README.md](README.md).

## Layout

- `client.js`: the whole plugin, the browser half. A hand-written bundle with no build step, registered with `window.__ModuleLoader__.load`. The pure helpers are exported as `_internals` for tests only.
- `index.js`: the Node half, an empty plugin; DSH needs it to load the bundle.
- `cordis.patch.yml`: inserts the plugin into the profile.
- `docs/images/`: README screenshots. Not shipped in the package.
- `test/`: Node tests.

## How it works

The plugin uses DSH extension points only and never edits nodes the host renders. It reads the host's DOM in three places: the session id on the selection's `[data-conversation-session]` ancestor, the position of a pressed or hovered quote chip among the composer's quote chips, and the chip's own `title` attribute, which it removes while the hover card is open and puts back after.

| Need | Extension point |
|---|---|
| A chip in the composer that becomes text at send | `inputTriggers.registerSource` with a `codec`. DSH calls `serialize` once per chip at submit; a failure blocks the send and keeps the draft. |
| Insert, edit or remove a chip in the right session's draft | The session id from the selection → `sessions.scope` → `conversation.input.for(scope)`, then `setDraft` with the structured draft (`draftSnapshot`), so every other chip survives. |
| Open the edit box when a chip is clicked | The source's `openReference`, which DSH calls on a chip click. |
| Full quote in the hover card | `input.state.getSnapshot().occurrences`, indexed by the hovered chip's position among quote chips. |
| Quote cards in the sent message | A `uiConversation.userText` rule that finds `<quote>` blocks, and a `conversation.user.text.node` slot entry (key `quote`) that renders them. |

### The chip's ref

A chip's `ref` is JSON: `{ "v": 1, "text": "…", "note": "…" }`, with `note` left out when empty. DSH persists the ref with the draft, so a draft restored after a reload still serializes. The chip's `clipboardText` is `> ` and the first 120 characters of the passage on one line; that is what copy and the draft's text projection carry.

### What the model receives

```
<quote>
the quoted passage
<note>your note, if any</note>
</quote>
```

A literal `</quote>` or `</note>` inside the passage or note is written as `<\/quote>` or `<\/note>` and turned back on display. The user-text rule matches exactly this shape, so a passage that merely mentions `<quote>` is left as text.

### Stacking

`stackQuote` puts a new chip after the quote chips already at the start of the draft, each followed by a newline, and shifts every later reference. Edits and removals locate the clicked chip by its position among quote chips, falling back to the first chip with the same ref when the draft changed in between, so two chips quoting the same passage stay independent.

## Test

```sh
pnpm --filter @rs-dsh/dsh-quote test
```

The tests load the real `client.js` in a Node `vm` with a fake module loader and a minimal DOM. No test extracts code from the source with regular expressions. A setup file makes `fetch` throw, so no test reaches the network.

## Screenshots

[CONTRIBUTING.md](../../CONTRIBUTING.md#screenshots) sets the rules. The current set was taken in a scratch profile (`@deepseek-ai/dsh-web-app`, this package by path), light theme, 1400 × 900 at 2× scale, cropped to the conversation column and never below the message box, so no account usage shows. Retake them when a change alters what they show:

| File | Shows |
|---|---|
| `select-quote.png` | The Quote button over a selection |
| `note-box.png` | The note box with a typed note |
| `composer-chips.png` | Two chips stacked above a question |
| `hover-full-quote.png` | The hover card on a chip |
| `edit-note.png` | The edit box with Remove, Cancel and Save |
| `sent-cards.png` | The sent message with two cards, and the reply |

## Release

Bump `version` in `package.json`, add a `CHANGELOG.md` entry, update the version in the README's install lines, merge, then push the tag `dsh-quote@<version>`. `.github/workflows/publish.yml` publishes it.
