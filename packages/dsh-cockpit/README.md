# @romany-saad/dsh-cockpit

A durable task board for a DeepSeek Harness hub session: the session that coordinates builders across many pull requests.

**Status: design.** Nothing is published yet. The design is tracked in this repository's issues.

## Scope (first iteration: the board only)

- Each task carries link fields: issue, pull request, branch, worktree, provider, model, reasoning effort, and the next action.
- It syncs with a GitHub tracking issue. The issue is the record, and the board rebuilds from it when the hub starts.
- Its state is readable outside the session that keeps it.

Remote control (following and steering a hub from another device) is the next iteration.

## License

[MIT](../../LICENSE)
