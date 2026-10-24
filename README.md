# dsh-plugins

Public plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), one package each under `packages/`, published to npm under the `@romany-saad` scope.

| Package | What it does | Status |
|---|---|---|
| [`@romany-saad/dsh-cockpit`](packages/dsh-cockpit) | A durable task board for a hub session that coordinates builders: link fields (issue, PR, branch, worktree, model, effort), sync with a GitHub tracking issue, and state readable outside the session | design |

## Install

```sh
dsh plugin --profile <profile> add @romany-saad/<package>
```

## Develop

```sh
pnpm install
pnpm test
```

To try a package from a checkout, install it by path into a scratch profile: `dsh plugin --profile scratch add ./packages/<package>`. A `link:` or path dependency is for local development only; profiles that others reproduce pin published versions.

## Layout

- `packages/<name>/`: one plugin, with its own `package.json`, `README.md`, `cordis.patch.yml` when it ships a patch layer, and tests.
- Each package declares the DSH packages it uses as `peerDependencies`, so it runs against the DSH the profile already has.

## Releases

Each package is published from a tag `<package>@<version>` by a GitHub Actions workflow holding an npm token. The workflow is added with the first release.

## Contributing

Pull requests are welcome. Every pull request gets one code review before the maintainer merges it.

## License

[MIT](LICENSE)
