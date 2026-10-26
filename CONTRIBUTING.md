# Contributing

Pull requests are welcome. Every pull request gets one code review before the maintainer merges it.

These rules apply to every package under `packages/`, and to people and coding agents alike.

## Package READMEs

`packages/<name>/README.md` is the page a consumer reads on npm and on GitHub before installing. It is written for someone who wants to **use** the plugin, not for someone who works on its code.

### Written for the consumer

The README answers, in this order:

1. **What it does**, in one or two sentences under the title, followed by a screenshot of it working.
2. **Install**: the `dsh plugin --profile <name> add @rs-dsh/<name>@<version>` command for the current release, and the git-pin fallback.
3. **Requirements**: the DSH version it is tested with, and what the profile needs, for example `@deepseek-ai/dsh-web-app` for a web GUI half.
4. **Use**: what the user does and what they see, step by step, with a screenshot for each thing the plugin shows on screen.
5. **Configure**, when the plugin has config: each option, its default, and an example patch.
6. **Limits**: what it does not do, and known problems.
7. Links to `CHANGELOG.md` and the license.

Leave out what only a maintainer needs: file-by-file layout, internals, extension points used, design reasoning, test and build commands, and the history of decisions. Put those in `packages/<name>/DEVELOPING.md` and link it in one line at the bottom of the README.

Write in plain words and second person ("select text", "you see"). Name what the user sees on screen, not the code behind it.

### Screenshots

- **Real and current.** Take screenshots of the released plugin running in DSH, never mockups. Every pull request that changes something a user sees retakes the screenshots it affects, in the same pull request. Delete screenshots that no longer match.
- **Every visible feature.** Each panel, toolbar, card, dialog or state the plugin adds has at least one screenshot. The first one, under the title, shows the main feature in use.
- **Where they live.** `packages/<name>/docs/images/`, as PNG, named for what they show (`composer-chips.png`, not `screenshot-3.png`). The folder is not in the package's `files`, so it does not ship in the tarball.
- **How the README links them.** Use the absolute `raw.githubusercontent.com` URL on `main`, so the image shows on npm as well as GitHub:

  ```markdown
  ![Quotes stacked as chips above the question](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-quote/docs/images/composer-chips.png)
  ```

  A relative path renders on GitHub but not always on npm. Until the pull request merges, the URL points at a file not yet on `main`; check the images in the pull request's file view.
- **How to take them.** A browser window about 1400 × 900, the DSH light theme, cropped to the part that matters with enough around it to see where it sits. No personal data, tokens, session titles or paths you would not publish. Every image has alt text that says what it shows.

### Checked in review

The pull request template asks whether the README and screenshots match the change. A pull request that changes what a user sees, and does not update the README and its screenshots, is not ready to merge.

## Develop

```sh
pnpm install
pnpm test
```

To try a package from a checkout, install it by path into a scratch profile: `dsh plugin --profile scratch add ./packages/<package>`.
