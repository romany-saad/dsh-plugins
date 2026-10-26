# dsh-plugins

Public plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), one package each under `packages/`, under the `@rs-dsh` npm scope.

| Package | What it does | Status |
|---|---|---|
| [`@rs-dsh/dsh-cockpit`](packages/dsh-cockpit) | A durable task board for a hub session that coordinates builders: a tree of steps with free-form link fields (issue, PR, branch, worktree, model, effort), kept as one local JSON file per board that other processes can read | 0.1.1 |
| [`@rs-dsh/dsh-quote`](packages/dsh-quote) | Quote passages from a Web conversation into your next message as composer chips, each with an optional note you can edit; hover shows the full quote, and sent quotes render as cards | 0.1.0 |

## Install

A profile installs a package from npm, at an exact version:

```sh
dsh plugin --profile <name> add @rs-dsh/<package>@<version>
```

As a fallback, it installs one from this repository, pinned to a commit or a tag:

```json
"@rs-dsh/<package>": "github:romany-saad/dsh-plugins#<commit or tag>&path:packages/<package>"
```

## Develop

```sh
pnpm install
pnpm test
```

To try a package from a checkout, install it by path into a scratch profile: `dsh plugin --profile scratch add ./packages/<package>`. A `link:` or path dependency is for local development only; profiles that others reproduce pin a commit or a tag.

## Layout

- `packages/<name>/`: one plugin, with its own `package.json`, a consumer-facing `README.md` with screenshots in `docs/images/`, `DEVELOPMENT.md` for maintainer notes, `cordis.patch.yml` when it ships a patch layer, and tests.
- Each package declares the DSH packages it uses as `peerDependencies`, so it runs against the DSH the profile already has.

## Releases

Each release is a tag `<package>@<version>`, for example `dsh-cockpit@0.1.0`. Profiles pin the tag, which pnpm accepts with `&path:`, or its commit. Pushing the tag runs `.github/workflows/publish.yml`, which publishes that version to npm. `<package>` is the folder under `packages/`. The workflow refuses a tag whose version differs from that package's `package.json`, a private package, and a tag whose commit is not on `main`. A version with `-` (such as `0.2.0-rc.1`) goes to npm's `next` tag, any other to `latest`.

## Contributing

Pull requests are welcome. Every pull request gets one code review before the maintainer merges it. See [CONTRIBUTING.md](CONTRIBUTING.md): among other rules, a change a user can see updates that package's README and retakes its screenshots.

## License

[MIT](LICENSE)
