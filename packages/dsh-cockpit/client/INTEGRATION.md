# Integrating the Board panel into dsh-cockpit

The panel branch (poc/dsh-cockpit-panel) adds only new files:

- `client/src/panel.js`: the browser half, a read-only "Board" tab in the right sidebar;
- `client/build.mjs` and its committed output `client/client.js`: `node client/build.mjs`
  wraps the source in the module-loader factory (no bundler; its only requires are
  `react` and `@deepseek-ai/dsh-client-ui-primitives`, both in the shell's module table);
- `lib/route.js`: three owner-only GET/HEAD Fetch routes on the host connection;
- `test/route.test.js` and `test/client.test.js`.

After both branches merge, apply these four changes to the core's files.

## 1. `package.json`

In `exports`, add the client bundle:

```json
    "./client": "./client/client.js",
```

In `files`, add:

```json
    "client/client.js",
```

In `scripts`, add:

```json
    "build:client": "node client/build.mjs",
```

In `dsh`, next to `bundle`, add:

```json
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-renderer"
      ]
    }
```

## 2. `index.js`

Add the import:

```js
import { registerRoutes } from './lib/route.js'
```

In `apply`, right after `const store = createStore({ dataDir })` and before the
`if (!config.tools.enabled) return` line, so the routes do not depend on the tools:

```js
  if (rawConfig.route?.enabled !== false) ctx.inject(['connection'], (connCtx) => registerRoutes(connCtx, dataDir))
```

(`resolveConfig` drops unknown keys, so this reads `route` from the raw config;
moving `route: { enabled: true }` into `DEFAULT_CONFIG` is equivalent.)

## 3. `cordis.patch.yml`

Under `config:`, next to `tools:`:

```yaml
        route:
          enabled: true
```

## 4. `test/plugin.test.js`

Its two stub contexts assume `apply` injects only `['tools']`; the route adds an
`['connection']` injection. Replace line 14:

```js
  const ctx = { inject: (deps, fn) => { if (deps[0] === 'connection') return; assert.deepEqual(deps, ['tools']); fn({ tools: { register: (d) => { registered.push(d); return () => {} } } }) } }
```

and line 39:

```js
  const ctx = { inject: (deps) => { if (deps[0] !== 'connection') assert.fail('inject called') } }
```

`test` already runs `test/*.test.js`, which picks up both new tests.

## The routes (lib/route.js)

| Path | Answer |
|---|---|
| `GET /api/dsh-cockpit/boards` | `{ boards: string[] }` |
| `GET /api/dsh-cockpit/board?key=K` | the board file's bytes; 404 for an unknown key |
| `GET /api/dsh-cockpit/view?sessionId=S` | `{ key, board, tree, flags, driftConfigured }` for the session's bound board, else `{ key: null, boards }` |

The panel polls `view` every 2 s for the tab's session.

## Shared rules

`client/build.mjs` inlines `lib/rows.js` (the row model: wait line, blocked by, progress, Needs you, Open link) and
`lib/present.js` (tool card titles) into `client/client.js`, so the panel, the hub's tree text and the chat cards
use one copy. Both files must stay import-free. The client also registers a `tool.call.toolview` view for
`board_open`, `board_read`, `board_add` and `board_update`: one row, "Board · <title>", expandable to the result.
