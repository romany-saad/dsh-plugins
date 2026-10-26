# Changelog

## 0.1.0

The first release.

- **Quote from the conversation.** Select text in a Web conversation and press **Quote**. A box opens for an optional note: Enter adds the quote, with or without a note; Shift+Enter breaks the line; Esc cancels.
- **Quotes are composer chips.** Each quote goes into its own conversation's composer as an atomic chip, stacked one per line above your question. Send works with only quotes in the draft, a reload keeps them, and `@file` and `@session` chips are left as they are.
- **Hover and edit.** Hovering a chip shows the full passage and note. Clicking it opens the box to edit the note, remove the quote, or cancel.
- **What the model receives.** At send time each chip becomes a `<quote>` block, with a `<note>` when there is one. If that fails, the send is blocked and the draft is kept.
- **Sent messages.** Your sent message shows the quotes as cards: three lines of the passage, expandable with a click, and the note under it.
- **Requires** DSH 0.2.1-rc.2 or later and a profile with the web GUI.
