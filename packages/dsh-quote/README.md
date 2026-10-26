# @rs-dsh/dsh-quote

Quote passages from a DSH Web conversation into your next message.

Select text in the conversation and a **Quote** button appears. It opens a box for an optional note: type one and press Enter, or press Enter on an empty box for a plain quote. Shift+Enter breaks the line; Esc cancels.

The quote goes into the composer as a chip. Quotes stack one per line at the top of the draft, above your question. Each chip is part of the draft: Backspace deletes it, the draft keeps it across a reload, and Send works even when the draft holds only quotes. Your own `@file` and `@session` chips stay as they are.

- **Hover** a chip to see the full passage and note.
- **Click** a chip to edit its note (**Save**), delete it (**Remove**), or leave it as it is (**Cancel**).

When you send, the model receives each quote as a block:

```
<quote>
the quoted passage
<note>your note, if any</note>
</quote>
```

In your sent message, those blocks show as quote cards: the passage in three lines with your note under it. Click a card to expand it.

## Install

```sh
dsh plugin --profile <profile> add ./packages/dsh-quote
```

Reload the Web page afterwards. Do not also add the plugin id to the profile's own `cordis.patch.yml`; the package's patch inserts it.

## How it works

Everything runs in the browser half, `client.js`, a hand-written bundle with no build step. It uses DSH's extension points and never edits nodes the host renders:

| Need | Extension point |
|---|---|
| Chip in the composer, serialized at send | `inputTriggers.registerSource` with a `codec` (`serialize` runs once per chip at submit; a failure blocks the send and keeps the draft) |
| Put the chip into the right session's draft | the session id on the selection's `[data-conversation-session]` → `sessions.scope` → `conversation.input.for(scope)`, then `setDraft` with the structured draft so existing chips survive |
| Quote cards in the sent bubble | a `uiConversation.userText` rule that finds `<quote>` blocks, plus a `conversation.user.text.node` slot entry that renders them |

The chip's `ref` carries the quote and note as JSON, so a draft restored after a reload still serializes correctly.

## Limits

- The composer chip uses DSH's generic reference look (the `@` marker); DSH ships glyphs only for files, folders and sessions.
- Quoting needs the composer to be editable. While a message is being submitted, or while the draft holds a `/command`, quoting shows a notice and changes nothing.
- The sent message keeps the `<quote>` blocks as text. Other views that show raw prompts (TUI, exports) show the blocks as written.

## Develop

```sh
pnpm --filter @rs-dsh/dsh-quote test
```

The tests load the real `client.js` in a Node VM with a fake module loader and a minimal DOM. No test extracts code from the source with regular expressions.
