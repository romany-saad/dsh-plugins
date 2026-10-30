# Changelog

## 0.4.2

- **An icon.** DSH's Plugins page now shows the plugin's own icon instead of the default artwork, in the light and dark themes. Nothing else changes.

## 0.4.1

- Chip labels and previews use the shared rs-dsh core's text helper. No change you can see.

## 0.4.0

- **The replier reads files.** To answer, it can open files in the session's working directory, list folders, find files by name and search their contents. It still cannot change anything. Turn it off with `reply.files: false`.
- **The replier can use the web**, if you set `reply.web: true`: web search and fetching a page, through the same providers as the agent's web tools. Off by default.

## 0.3.0

- **Chinese wording** reviewed: a thread is 评论 throughout (not 讨论), the post button says 发布, and the code toolbar says 自动换行 as DSH does.
- **Unread replies.** A thread's badge fills in and shows a dot when an AI reply arrives while the thread is closed, until you open it. Remembered per browser.
- From dsh-core: a triple-click selection now gets **Comment**, the comment box takes focus when it opens, and the selected passage stays highlighted while you type.

## 0.2.0

- **One toolbar with Quote.** **Comment** now sits in the one selection toolbar it shares with the other rs-dsh plugins, such as **Quote** from dsh-quote, instead of a box of its own. It shows only where a comment can go: not on tool output or a collapsed reasoning block. Installing dsh-threads also installs `@rs-dsh/dsh-core`.
- **DSH's own look.** The comment box and the thread use DSH's components and theme: its text box, buttons, menu surface and icons. AI replies render as Markdown, as chat messages do, and **Thinking…** shimmers like DSH's running rows.
- **Simpler thread actions.** Delete is an icon button, and Esc or a click outside closes the thread. **Close** shows only on threads you can't reply to.
- **Chips keep their order** with other rs-dsh chips.

## 0.1.0

The first release, published under npm's `latest` tag. It is 0.1.0-rc.2, tried in daily use, with no code changes.

- **Comment on a passage** in a reply, your own message, or an expanded reasoning block, and get a brief reply from the session's current model in a thread next to it. The replier reads more of the session when it needs to, and cannot act.
- **Threads, highlights and badges** stay after a reload. **Send to chat** passes a thread to the agent.
- **Formerly `@rs-dsh/dsh-comment`.** Threads saved with dsh-comment 0.1.0-rc.1 keep showing.

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
