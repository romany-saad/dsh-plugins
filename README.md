# dsh-plugins

Public plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), one package each under `packages/`, under the `@romany-saad` scope.

| Package | What it does | Status |
|---|---|---|
| [`@romany-saad/dsh-cockpit`](packages/dsh-cockpit) | A durable task board for a hub session that coordinates builders: a tree of steps with free-form link fields (issue, PR, branch, worktree, model, effort), kept as one local JSON file per board that other processes can read | 0.1.0 |

## Install

Nothing is on npm yet (#2). A profile installs a package from this repository, pinned to a commit or a tag:

```json
"@romany-saad/<package>": "github:romany-saad/dsh-plugins#<commit or tag>&path:packages/<package>"
```

## Develop

```sh
pnpm install
pnpm test
```

To try a package from a checkout, install it by path into a scratch profile: `dsh plugin --profile scratch add ./packages/<package>`. A `link:` or path dependency is for local development only; profiles that others reproduce pin a commit or a tag.

## Layout

- `packages/<name>/`: one plugin, with its own `package.json`, `README.md`, `cordis.patch.yml` when it ships a patch layer, and tests.
- Each package declares the DSH packages it uses as `peerDependencies`, so it runs against the DSH the profile already has.

## Releases

Each release is a tag `<package>@<version>`, for example `dsh-cockpit@0.1.0`. Profiles pin the tag, which pnpm accepts with `&path:`, or its commit. Publishing to npm is parked (#2).

## Contributing

Pull requests are welcome. Every pull request gets one code review before the maintainer merges it.

## License

[MIT](LICENSE)
