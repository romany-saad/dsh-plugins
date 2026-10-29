---
name: dsh-plugin-dev
description: Build, change, verify and release an @rs-dsh DeepSeek Harness plugin in this repository — finding the DSH extension point, reusing DSH and dsh-core UI, testing in a scratch profile with real screenshots, and publishing in dependency order.
whenToUse: Adding a package under packages/, changing what a plugin shows or does, answering "can a plugin do X in the DSH GUI", or tagging a release.
---

# Developing an @rs-dsh plugin

CONTRIBUTING.md is the rulebook; this skill is how to work so you follow it. `pnpm test` runs `scripts/check-repo.mjs` first, and CI, the pre-push hook and the publish workflow run it too: it fails on stale versions, a missing CHANGELOG entry, unused or relative screenshots, a missing class prefix, a core helper copied into a plugin, or a release tag pushed before its dsh-core is on npm. Fix what it names; never bypass it.

## 1. Check what DSH already offers, and where the fix belongs

Before designing, check whether DSH already has an extension point for it. If the right fix belongs in DSH or in another plugin, say so and propose that instead of working around it. For a small change to an existing plugin, look up only what that change touches.

Look in the installed DSH, not from memory. It is the global install: `$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/`. The places, in order:

1. The owning package's `README.md` (`dsh-client-ui-conversation`, `-workspace`, `-sidebar`, …): behaviour and its decisions.
2. The slot catalogue in `dsh-cordis-client-runner/lib/client.js`: search `key: "<slot name>"` for kind, scope, standard props, owner props and current occupants.
3. The `.d.ts` contracts under `lib/types/` (for example `dsh-api-session-controller/lib/types/client/contract/`).
4. Only then the bundled `lib/client.js`, to confirm a detail.

Then choose, and say why in the proposal:

- **An extension point fits** (a slot, a service, a hook): use it. Don't patch another plugin's methods or DOM to get the same result.
- **The behaviour itself is wrong** in DSH or another plugin: the fix belongs there. Propose the upstream change (an issue or a patch). A plugin that hides the problem is a stopgap, and the proposal says that, if it is offered at all.
- **The behaviour is right but a plugin can add to it**: build the plugin.

In every case, name which DSH behaviour the design changes. Example: drafts were lost because New Session always creates a fresh blank Session, and DSH documents that as intended. Patching New Session would have worked around documented behaviour. The drafts card adds to it without changing it.

Useful facts, true for DSH 0.2.1-rc.2:

- Slot entries get standard props: `useSession`, `useSessions`, `useWorkspaces`, `useInput`, `inputActions`, `useProjection`, `sessionId`, …. Use them instead of subscribing to services yourself.
- `conversation.input.dock` is a full-width list above the composer, on every Session including a blank one; `conversation.hero.options` is the compact row of the new-session hero.
- A Session's composer draft lives in `localStorage` under `dsh.conversation.<sessionId>`. A plugin that depends on a private key like this ships a test that reads the pinned DSH bundle and fails when the key moves.
- `sessions.create({ sessionId })` reuses a named blank Session; `uiWorkspace.openSession(id)` navigates.

## 2. Draw it with DSH's own UI

Use, in this order:

1. `rsDshCore.ui`: DSH's `Button`, `MenuSurface`, `InlineEditor`, `Tooltip`, `Toast`, icons and `relativeTime`. When you need another ui-primitives export, add it to `UI_EXPORTS` in dsh-core (a test checks every name against the pinned library).
2. `rsDshCore` helpers: `oneLine`, `stackChip`, `composer.*`, `popover.open`, `selection.register`. Never copy one into a plugin; the check fails if you do.
3. DSH's design tokens (`--dsw-…`) and the CSS of the closest DSH component, copied with its token names when DSH does not export it. Put it in the plugin first; move it into core when a second plugin needs it.

Text DSH already words — times, workspace names, actions — uses DSH's wording. Bucket times with `ui.relativeTime` and copy the sidebar's `time.*` strings; show `default-workspace` as **Default workspace** / **默认工作区**. Every string goes into `en` and `zh` (CONTRIBUTING.md, Translations).

Styles go through `core.style(plugin, css)` under `[data-rs-dsh="<plugin>"]`, with one class prefix per plugin, registered in `OWN_PREFIX` in `packages/dsh-core/test/namespace.test.js`.

## 3. A new package

Copy the layout of the closest sibling (dsh-quote for a core-based client plugin): `package.json` (`exports`, `files`, `dsh.client.inject` listing every DSH package whose services you inject, `dependencies: { "@rs-dsh/dsh-core": "workspace:^" }`), `index.js`, `cordis.patch.yml` inserting the `dsh-core` row and then yours, `LICENSE`, `CHANGELOG.md`, `README.md`, `DEVELOPING.md`, `test/no-network.mjs`. Add the package to the root README table. The shared guard tests in `packages/dsh-core/test/` start every core-based plugin with a fake context: give it any new service your `inject` names.

Tests: pure helpers in a `vm` (`client.test.js`), and the rendered UI on dsh-core's `test/dom.mjs` page with real React (`apply.test.js`). Objects from the bundle's realm compare by value: `JSON.parse(JSON.stringify(x))`.

## 4. Verify in a real DSH before saying it works

Unit tests do not prove a slot renders or a flow survives navigation. Run it:

```sh
export DSH_HOME=/tmp/<plugin>-home             # never the user's real profiles
dsh plugin --profile scratch add ./packages/dsh-core ./packages/<plugin>
# add @deepseek-ai/dsh-web-app to dsh.profile.bundles in $DSH_HOME/profiles/scratch/package.json
# skip the welcome dialog: in that profile's cordis.patch.yml
#   - id: ui-settings-general
#     name: "@deepseek-ai/dsh-client-ui-settings-general"
#     config: { welcomeNoticeVersion: 2026-09-28.1 }
cd <a demo folder> && dsh --profile scratch --no-open --port 3190   # background job; read its token URL
```

Never start a server on the user's GUI port or restart their server. Drive the flow with Playwright (`playwright-core` from any local checkout, `executablePath: '/usr/bin/google-chrome'`), 1400 × 900, `deviceScaleFactor: 2`, light theme: do what a user does, read the result back from the DOM, and include a page reload. Look at every screenshot before keeping it. Edits to `client.js` reach the scratch page on reload; a new dependency or `inject` needs a server restart.

Screenshots: crop to the feature with context, no personal data, PNG under `packages/<name>/docs/images/` named for what they show, linked from the README with the absolute `raw.githubusercontent.com/.../main/...` URL and alt text, and listed in DEVELOPING.md. Retake every one a change affects.

When done, stop the server job and delete the temporary `DSH_HOME`.

## 5. Release

Ask before publishing; "publish it" is the go-ahead.

1. Per package: bump `version`, add the CHANGELOG entry (newest first), update the README install lines and the root table. Without a user-visible change, the entry says so and screenshots stay.
2. One branch, one PR using `.github/pull_request_template.md`, with the release order in its body. Wait for CI (`gh pr checks <n> --watch`), then squash-merge.
3. Tag on `main`, one package at a time: **dsh-core first**, wait until its publish run succeeds, then its dependents. The pre-push hook and the publish workflow refuse a dependent tag while its core is not on npm.
4. Watch each run (`gh run watch <id> --exit-status`), then confirm from a fresh `DSH_HOME` that `dsh plugin --profile check add @rs-dsh/<pkg>@<version>` installs. A brand-new package name can 404 on install for a few minutes after a successful publish: the abbreviated metadata (`Accept: application/vnd.npm.install-v1+json`) lags the full document. Wait and retry; do not republish.
