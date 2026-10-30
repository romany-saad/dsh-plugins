# Agent instructions

Follow [CONTRIBUTING.md](CONTRIBUTING.md). It applies to coding agents as it does to people.

In particular, when a change touches anything a user of a package sees, update that package's `README.md` and retake its screenshots in the same change (see "Package READMEs" there). The README is written for consumers; maintainer notes go in `packages/<name>/DEVELOPING.md`.

Before building, changing, verifying or releasing a plugin, load the `dsh-plugin-dev` skill ([.agents/skills/dsh-plugin-dev/SKILL.md](.agents/skills/dsh-plugin-dev/SKILL.md)). Its hard rules:

- Before designing, check whether DSH already has an extension point for it. If the right fix belongs in DSH or in another plugin, say so and propose that instead of working around it.
- Use DSH's components and dsh-core's helpers; never copy a core helper into a plugin.
- Show a change working in a scratch profile under a separate `DSH_HOME`, with real screenshots, before you call it done. Never touch the user's own profiles or GUI server.
- Publish only when asked, dsh-core first, and confirm the install from npm.

For a plugin icon, load the `dsh-plugin-icons` skill ([.agents/skills/dsh-plugin-icons/SKILL.md](.agents/skills/dsh-plugin-icons/SKILL.md)).

`pnpm test` starts with `scripts/check-repo.mjs`, the repository rules. CI, the `pre-push` hook and the publish workflow run it too. Fix what it reports; do not skip it with `--no-verify`.
