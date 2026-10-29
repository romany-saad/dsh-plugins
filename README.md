# dsh-plugins

Public plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), one package each under `packages/`, under the `@rs-dsh` npm scope.

| Package | What it does | Status |
|---|---|---|
| [`@rs-dsh/dsh-core`](packages/dsh-core) | The shared base of the rs-dsh plugins: one selection toolbar for all their actions, and boxes drawn with DSH's own components. Installed by the plugins that use it | 0.1.2 |
| [`@rs-dsh/dsh-threads`](packages/dsh-threads) | Comment on any passage of a Web conversation and get a brief reply from the session's own model in a small thread next to it; passages stay highlighted, and a thread can be sent to the chat. Formerly `@rs-dsh/dsh-comment` | 0.4.2 |
| [`@rs-dsh/dsh-cockpit`](packages/dsh-cockpit) | A durable task board for a hub session that coordinates builders: a tree of steps with free-form link fields (issue, PR, branch, worktree, model, effort), kept as one local JSON file per board that other processes can read | 0.3.2 |
| [`@rs-dsh/dsh-quote`](packages/dsh-quote) | Quote passages from a Web conversation into your next message as composer chips, each with an optional note you can edit; hover shows the full quote, and sent quotes render as cards | 0.3.2 |
| [`@rs-dsh/dsh-drafts`](packages/dsh-drafts) | Get back what you typed into a new Web conversation and left before sending: unsent drafts are listed above the message box of a new conversation, with Open and Discard | 0.1.1 |
| [`@rs-dsh/dsh-automations`](packages/dsh-automations) | Keep automation tasks in YAML, JSON or JS files: the Schedule is synced to match them, with each task's schedule, prompt, model, permission and working folder | 0.1.0 |

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

- `packages/<name>/`: one plugin, with its own `package.json`, a consumer-facing `README.md` with screenshots in `docs/images/`, `DEVELOPING.md` for maintainer notes, `cordis.patch.yml` when it ships a patch layer, and tests.
- Each package declares the DSH packages it uses as `peerDependencies`, so it runs against the DSH the profile already has.

## Releases

Each release is a tag `<package>@<version>`, for example `dsh-cockpit@0.1.0`. Profiles pin the tag, which pnpm accepts with `&path:`, or its commit. Pushing the tag runs `.github/workflows/publish.yml`, which publishes that version to npm. `<package>` is the folder under `packages/`. The workflow refuses a tag whose version differs from that package's `package.json`, a private package, and a tag whose commit is not on `main`. A version with `-` (such as `0.2.0-rc.1`) goes to npm's `next` tag, any other to `latest`.

## Contributing

Pull requests are welcome. Every pull request gets one code review before the maintainer merges it. See [CONTRIBUTING.md](CONTRIBUTING.md): among other rules, a change a user can see updates that package's README and retakes its screenshots.

**Translations are welcome too.** The plugins come in English and Chinese, following DSH. Corrections to either and new languages are welcome, and a correction needs no coding; see [Translations](CONTRIBUTING.md#translations).

## License

[MIT](LICENSE)
