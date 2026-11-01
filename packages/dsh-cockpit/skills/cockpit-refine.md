# Refine Inbox items into board tasks

You are the coordinator. The Inbox holds rough items the user noted for later. Your job is to turn the items the user picked into tasks on the board that fit the rest of the work, with the user's agreement. A delegate skill may do the domain analysis. You own everything that touches the board.

## 1. Pick the items

- Read the board: `board_read`. The result has `inbox` and the task tree.
- The items are the ids the user named (`/cockpit-refine i3 i5`). With none named, take every open item. If there are more than five, ask which to start with.
- An item that is refined or dropped is not refined again unless the user asks; reopen it with `board_inbox` first.
- If no board is bound or the Inbox has no open items, say so and stop.

## 2. Choose the delegate skill

Take the first that applies:

1. The skill the user named for this run (`using <skill>`).
2. {{refineSkill}}
3. A skill in this session's skill catalog that is clearly meant for turning ideas into requirements, such as one for interviewing the user, writing specs or finding gaps. Suggest it once and ask before using it.
4. Otherwise, the checklist in step 3.

If the named skill is not in the catalog or fails to load, say so and use the checklist. Do not stop.

## 3. Analyse each item

Work on one item at a time, or a group that clearly belongs together. Before any analysis, give the delegate, or yourself, this context:

- the item's text and note, as written;
- the board tasks it touches: a likely parent, tasks it depends on or blocks, and any task or item that already covers it, which may make it a duplicate;
- what is already decided on the board or in this conversation.

With a delegate skill, load it with the `skill` tool and follow its instructions for this item. It decides how to analyse and what to ask. Ask it for, or write down from its work, this result:

- requirements: what must be true when the work is done;
- acceptance: how to check each one;
- open questions, and the answers the user gave;
- assumptions;
- out of scope.

The checklist, used without a delegate:

- **Goal:** what problem does it solve, and for whom?
- **Scope:** what is in, and what is explicitly out?
- **Acceptance:** how will we know it works?
- **Relations:** what must come first, what does it block, and what does it overlap?
- **Risks and unknowns:** what could make it larger than it looks?

Ask the user only what you cannot work out from the code, the board or the conversation. Ask a few questions at a time; `ask_user_question` suits choices.

A delegate decides how to analyse. You decide what gets written and where. If it says to write a spec file, open an issue or start building, do that only if the user asks; it never replaces the board write.

## 4. Propose the tasks

For each item, propose the tasks it becomes, in board terms:

- `what` (one line), `why` (the goal), `parent` (an existing task or a new one), `dependsOn`, `startWhen` when it waits on something, and `issue` only when one exists;
- leave `pr`, `branch`, `worktree`, `provider`, `model` and `effort` empty: they describe work under way, and refining starts none;
- one item may become several tasks; several items may become one task; an item may be dropped, with a reason;
- keep acceptance and open questions in the conversation, or in `extra` as short strings when they must stay with the task.

Show the proposal as a short list and wait for the user's yes or changes. Do not write before that.

## 5. Write

- Add each task with `board_add`, passing `refines: ["i3"]` (every item it came from) and `refinedWith: "<skill>"` when a delegate did the analysis. This marks the items refined and links them to their tasks in the same write.
- Add parents before their children, and a task before another depends on it: a parent or dependency must already be on the board.
- To link an item to a task that already exists, call `board_update` with that task and `refines`.
- Drop an item the user decided against with `board_inbox` action `drop` and a note.
- Finally, read the board once more and report what each item became, in one line each, such as: "i3 → 12, 13 (with grill-me)".

## Where it runs

Run it in this session by default, so the user answers the questions here. For an item that needs research rather than the user's answers (reading a large codebase, comparing libraries), you may give that item to a subagent. Ask it for the result in step 3 and no board writes. Then propose and write the tasks yourself, so this session stays the board's only writer.
