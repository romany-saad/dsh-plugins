# Changelog

## 0.3.1

- Chip labels and previews use the shared rs-dsh core's text helper. No change you can see.

## 0.3.0

- **Quoted passages stay highlighted.** After you add a quote, its passage in the conversation keeps a light highlight until you send the message, or until you delete or remove the quote's chip.

## 0.2.1

- **Chinese wording** reviewed: keyboard hints and messages follow DSH's own terms and punctuation.
- From dsh-core 0.1.1: the note box takes focus when it opens, and the selected passage stays highlighted while you type.

## 0.2.0

- **Built on the rs-dsh core.** **Quote** now sits in the one selection toolbar it shares with the other rs-dsh plugins, such as **Comment** from dsh-threads. Installing dsh-quote also installs `@rs-dsh/dsh-core`.
- **DSH's own look.** The note box, the edit box and the chip's hover card use DSH's components and theme: its text box, buttons and menu surface.
- **Chips keep their order** with other rs-dsh chips: a quote added after a comment thread goes below it.

## 0.1.0

The first release.

- **Quote from the conversation.** Select text in a Web conversation and press **Quote**. A box opens for an optional note: Enter adds the quote, with or without a note; Shift+Enter breaks the line; Esc cancels.
- **Quotes are composer chips.** Each quote goes into its own conversation's composer as an atomic chip, stacked one per line above your question. Send works with only quotes in the draft, a reload keeps them, and `@file` and `@session` chips are left as they are.
- **Hover and edit.** Hovering a chip shows the full passage and note. Clicking it opens the box to edit the note, remove the quote, or cancel.
- **What the model receives.** At send time each chip becomes a `<quote>` block, with a `<note>` when there is one. If that fails, the send is blocked and the draft is kept.
- **Sent messages.** Your sent message shows the quotes as cards: three lines of the passage, expandable with a click, and the note under it.
- **Requires** DSH 0.2.1-rc.2 or later and a profile with the web GUI.
