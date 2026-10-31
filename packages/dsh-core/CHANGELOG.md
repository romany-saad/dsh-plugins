# Changelog

## 0.1.3

- **Declares the DSH versions it supports.** `engines.dsh` is `>=0.2.1-rc.2 <0.3.0-0`, the DSH 0.2 line it is tested with. DSH checks it before installing, and plugin markets show it as the version's compatibility. Nothing else changes.

## 0.1.2

- **`ui.relativeTime`**: DSH's own relative-time bucketing, so a plugin dates a session the way the sidebar does. dsh-drafts uses it.
- dsh-quote, dsh-threads and dsh-drafts now all use the core's `oneLine` for previews and chip labels, instead of each keeping a copy.

## 0.1.1

- **Chinese wording** reviewed: messages follow DSH's own terms (指令 for commands) and end with 。.
- **Triple-click selections** now get the Comment button. A triple-click on a message's last paragraph runs on to the start of the next message, so the selection belonged to no message; it is now trimmed to the text it covers.
- **Cards focus their text field** when they open, so you can type a comment or a quote note right away.
- **The selected passage stays highlighted** while its comment or quote card is open, though focusing the field clears the page selection.

## 0.1.0

The first release. dsh-threads 0.2.0 and dsh-quote 0.2.0 are built on it.

- **One selection toolbar** for every rs-dsh plugin's actions. A button shows only where its action applies.
- **Cards drawn with DSH's own components** (`MenuSurface`, `Button`, `InlineEditor`, `MarkdownText`, `TextShimmer`), closing on **Esc** or a click outside, one at a time.
- **A namespace per plugin** and a repository-wide test that keeps their styles apart.
- **Requires** DSH 0.2.1-rc.2 or later with the web GUI.
