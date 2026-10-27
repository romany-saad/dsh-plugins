# Changelog

## 0.1.0-rc.2

- **Renamed from `@rs-dsh/dsh-comment` to `@rs-dsh/dsh-threads`.** Remove `@rs-dsh/dsh-comment` from your profile and add `@rs-dsh/dsh-threads`. Threads saved with dsh-comment 0.1.0-rc.1 keep showing, and you can reply to them and delete them as before.
- **The badge uses a DSH-style icon.** The margin badge and the sent-message card show DSH's speech-bubble outline instead of the 💬 emoji.
- **Fix: dsh-cockpit's progress bar broke.** This plugin's CSS classes shared the `dshc-` prefix with dsh-cockpit, so its toolbar style turned cockpit's progress bar into a floating box. Its classes now use their own prefix, `dshth-`, and a test checks them against the other rs-dsh plugins.

## 0.1.0-rc.1

The first release candidate, published as `@rs-dsh/dsh-comment` under npm's `next` tag.

- **Comment on a passage.** Select text in a reply, in your own message, or in an expanded reasoning block, and press **Comment**.
- **A brief AI reply.** The session's current model replies in a small thread next to the passage. It starts from the passage, its message and that turn's prompt, and reads more of the session with read-only tools when it needs to. It cannot act, and the main agent does not see the thread.
- **Threads.** Follow up in the thread, up to five comments from you. A failed reply can be retried.
- **Highlights.** Commented passages stay highlighted after a reload, with a badge in the margin. Clicking either opens the thread.
- **Send to chat.** A thread goes into the message box as a chip. The agent receives it as a `<comment-thread>` block, and your sent message shows it as a card.
- **Storage.** Threads are records in the session log. They never enter the model's history, and a fork starts without them.
- **Requires** DSH 0.2.1-rc.2 or later and a profile with the web GUI.
