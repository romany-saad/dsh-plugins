# @rs-dsh/dsh-quote

Quote passages from a DeepSeek Harness conversation into your next message, each with an optional note, so the model knows exactly which part you mean.

![Two quotes from the reply sent with a question, shown as quote cards in the message](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-quote/docs/images/sent-cards.png)

## Install

```sh
dsh plugin --profile <name> add @rs-dsh/dsh-quote@0.2.1
```

Then reload the DSH web page.

To install from this repository instead, pinned to the release tag:

```sh
dsh plugin --profile <name> add 'github:romany-saad/dsh-plugins#dsh-quote@0.2.1&path:packages/dsh-quote'
```

The package adds itself, and the shared [rs-dsh core](https://github.com/romany-saad/dsh-plugins/tree/main/packages/dsh-core) it is drawn with, to the profile. Do not also add `dsh-quote` or `dsh-core` to the profile's own `cordis.patch.yml`.

## Requirements

- DSH 0.2.1-rc.2 or later. It is tested with 0.2.1-rc.2.
- A profile with the web GUI (`@deepseek-ai/dsh-web-app`), such as `web`. The plugin works in the web GUI only.

## Use

### Quote a passage

Select text anywhere in the conversation and press **Quote**. With other rs-dsh plugins installed, such as [dsh-threads](https://github.com/romany-saad/dsh-plugins/tree/main/packages/dsh-threads), their actions sit in the same toolbar.

![The Quote button above a selected sentence in a reply](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-quote/docs/images/select-quote.png)

A box opens for an optional note. Type your note and press **Enter**, or press **Enter** on an empty box to quote without a note. **Shift+Enter** starts a new line in the note, and **Esc** cancels.

![The note box, showing the quoted passage and a typed note, with Cancel and Add, drawn like DSH's own menus](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-quote/docs/images/note-box.png)

### Your quotes in the message box

Each quote appears in the message box as a chip. Quotes stack one per line above your question, in the order you added them. Add as many as you like, then type your question below them.

![Two quote chips stacked above a question in the message box](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-quote/docs/images/composer-chips.png)

The chips are part of your message:

- **Send** works even when the message holds only quotes.
- **Backspace** deletes a chip like any other character.
- Reloading the page keeps them.
- `@file` and `@session` mentions in the same message keep working.

### See and edit a quote

Hover a chip to see the full passage and your note.

![The hover card showing a chip's full passage and note](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-quote/docs/images/hover-full-quote.png)

Click a chip to change its note. **Save** keeps the change, **Remove** deletes the quote, and **Cancel** leaves it as it was.

![The edit box for a quote chip, with Remove, Cancel and Save](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-quote/docs/images/edit-note.png)

### After you send

Your sent message shows each quote as a card, with your note under it, followed by your question (see the screenshot at the top). Long quotes show three lines; click a card to read all of it.

The model receives each quote with its note, and can answer each one.

## Limits

- **Web GUI only.** Messages viewed in the terminal UI or in an export show the quotes as tagged text blocks, not cards.
- **The chip shows an `@` sign.** DSH has its own icons for files, folders and sessions only, so quote chips use the generic `@` marker.
- **Not while sending or in a command.** You cannot add a quote while a message is being sent, or while the message box holds a `/command`. A notice tells you why, and nothing changes.
- **Copying a chip gives plain text.** Copying a chip copies `> ` and the start of the passage. Pasting that back does not make a new chip.

## More

- [CHANGELOG.md](https://github.com/romany-saad/dsh-plugins/blob/main/packages/dsh-quote/CHANGELOG.md)
- [MIT License](https://github.com/romany-saad/dsh-plugins/blob/main/packages/dsh-quote/LICENSE)
- For maintainers: [DEVELOPING.md](https://github.com/romany-saad/dsh-plugins/blob/main/packages/dsh-quote/DEVELOPING.md)
