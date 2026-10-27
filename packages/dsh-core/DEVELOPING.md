# dsh-core: development notes

For maintainers, and for anyone writing an rs-dsh plugin on the core. Users read [README.md](README.md).

## Why it exists

The rs-dsh plugins share one selection toolbar and draw their boxes with DSH's own UI library, `@deepseek-ai/dsh-client-ui-primitives`. That keeps them consistent with DSH, keeps them small, and lets them follow DSH's updates without restyling. It also replaced two problems:

- **Two toolbars.** Quote and Comment showed in separate boxes, with dsh-threads finding dsh-quote's box on the page to sit beside it.
- **Hand-written CSS with clashing class names.** The `dshc-` clash turned dsh-cockpit's progress bar into a floating box.

## Layout

- `client.js`: the whole core, the browser half. A hand-written bundle with no build step. Pure helpers are exported as `_internals` for tests only.
- `index.js`: the Node half, an empty plugin; DSH needs it to load the bundle.
- `cordis.patch.yml`: inserts the `dsh-core` row.
- `test/dom.mjs`: the shared test page. jsdom, real React 19, and stand-ins for the DSH components with the same names and props. The other packages' tests use it too.
- `test/namespace.test.js`: the repository-wide style rule (below).

## How a plugin gets the core

1. **Dependency.** The plugin lists `"@rs-dsh/dsh-core": "workspace:^"` under `dependencies`, which becomes `^0.1.0` on publish. Installing the plugin installs the core.
2. **Row.** The plugin's `cordis.patch.yml` inserts the row `id: dsh-core, name: '@rs-dsh/dsh-core'` before its own row. Every rs-dsh plugin inserts this same row. The loader starts it once, which was checked in a running DSH with two bundles that both insert it.
3. **Service.** The browser half declares `inject: [..., 'rsDshCore']` and reads `ctx.rsDshCore`. DSH's module loader starts the provider before its consumers. Official plugins use the same pattern (`ctx.provide('theme')`, `ctx.provide('chatFileMentions')`).

The core is not a bundle you install on its own. It does have its own `dsh.bundle.patch`, so `dsh plugin add @rs-dsh/dsh-core` would work, but no one needs to.

## The service: `ctx.rsDshCore`

| Member | What it does |
|---|---|
| `ui` | The DSH components and icons in `UI_EXPORTS`: `Button`, `MenuSurface`, `InlineEditor`, `TextShimmer`, `MarkdownText`, `Tooltip`, `Toast`, and the `Icon…Regular` set. |
| `React`, `jsx`, `jsxs` | The page's React, for plugins without a build step. |
| `selection.register({ plugin, id, label, onSelect, when?, icon?, order? })` | A button in the one selection toolbar. `when(selection)` hides it where it doesn't apply. `onSelect` gets `selectionContext()`'s value. Returns a disposer. Lower `order` comes first: quote is 10, threads is 20. |
| `selectionContext()` | `{ sessionId, region, element, row, range, rect, text }` for a selection in a conversation, else null. It is null in the composer, in inputs, and in any `[data-rs-dsh]` element. |
| `popover.open({ plugin, anchor, render, width?, prefer?, align?, onClose?, label? })` | One card at a time, on DSH's `MenuSurface`, next to `anchor` (a rect, or a function returning one). `render(close)` returns React. Outside click and Esc close it, and so does opening another. `onClose(reason)` gets `outside`, `escape`, `replaced`, `api`, `dispose`, or whatever the card passed to `close`. |
| `style(plugin, css)` | One `<style data-rs-dsh-style=plugin>` per plugin; a second call replaces the text. Returns a disposer. |
| `scope(plugin)`, `selector(plugin)` | `{ 'data-rs-dsh': plugin }` to spread on a plugin's elements, and the matching selector. |
| `composer.insertChip(sessionId, insert)` | Stack a chip at the top of a session's draft, after the rs-dsh chips already there, in the order added. Returns null, or why it couldn't. |
| `composer.claimChipSource(source)` | Mark a chip source as rs-dsh's, so other rs-dsh chips stack after it. |
| `composer.editable(sessionId)`, `composer.notify(sessionId, text)` | The composer if it can take a chip, else `{ error }`; and a notice under it. |
| `oneLine`, `stackChip` | The shared text helpers. |

## DSH's UI library

The owner's decision: build on the assumption that the library exists. DSH's web shell ships it in its shared module table, along with `react`, `react-dom/client` and `react/jsx-runtime`. There are no look-alike fallbacks. If it is missing, or lacks a name in `UI_EXPORTS`, `apply` throws one error naming what is gone, and the plugins on the core don't start.

The early warning is `test/client.test.js`. It reads the pinned `@deepseek-ai/dsh-client-ui-primitives` package's export list and fails if any name in `UI_EXPORTS` is gone. When DSH updates, bump the pinned devDependency and the peer range, then run the tests. A failure there is the signal to port.

The card's look comes from DSH's menu: `MenuSurface` material, with the elevation DSH's `Menu` list uses (`--dsw-elevation-prominent`). Colours, radii and fonts are DSH tokens only.

## The namespace rule

`test/namespace.test.js` loads every core-based plugin on one page and checks the stylesheets they register:

- Every rule sits under the plugin's own `[data-rs-dsh="<plugin>"]`. The only exception is a rule for the host's chip of the plugin's own source, `[data-composer-chip="<source>"]`.
- The classes a plugin styles carry its own short prefix: `q-` for quote, `th-` for threads. The prefixes are unique.
- Highlight and keyframe names start with the plugin's name or prefix, and are unique.
- No class is styled by two plugins in the repository, dsh-cockpit included.

A new core-based plugin needs an entry in `OWN_PREFIX` there.

## Test

```sh
pnpm --filter @rs-dsh/dsh-core test
```

## Screenshots

[CONTRIBUTING.md](../../CONTRIBUTING.md#screenshots) sets the rules. `one-toolbar.png` was taken in a separate `DSH_HOME` with dsh-threads and dsh-quote installed, in the light theme, at 1400 × 900 and 2× scale.

## Release

Bump `version`, add a `CHANGELOG.md` entry, merge, then push the tag `dsh-core@<version>`. Release the core before the plugins that need a new version of it.
