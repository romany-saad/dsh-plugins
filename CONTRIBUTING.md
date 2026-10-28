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

## Translations

The plugins speak the language DSH is set to. DSH ships English and Chinese, so every plugin carries both: each `client.js` has an `en` and a `zh` dictionary, registered with `ctx.locale.register`.

### Every string in every language

- **English is the reference.** A new or changed string goes into `en` and into every other dictionary in the same pull request. A string missing from a language falls back to English, which looks broken in an otherwise translated UI.
- **Keep the placeholders.** `{n}` and the like appear in every translation, exactly as in English.
- **Checked by a test.** `packages/dsh-core/test/locale.test.js` fails when a language misses a key, has an extra one, or drops a placeholder. It checks any language a plugin registers, not just Chinese.

### Chinese style

Follow the words DSH's own Chinese UI uses, so a plugin reads as part of DSH:

- **Terms.** A comment and its replies are **评论** (not 讨论). Slash commands are **指令**. The message box is **输入框**. A session is **会话**; the chat in it is **对话**. Code-block wrapping is **自动换行 / 取消自动换行**; plain **换行** is a line break (Shift+Enter).
- **Buttons and labels** are short verbs or nouns with no final punctuation: 发布, 保存, 取消.
- **Messages** that are full sentences end with **。** and ask politely: 输入框暂时无法编辑，请稍后再试。
- **Keyboard hints** separate actions with **，**: `Enter 发布，Shift+Enter 换行，Esc 取消`.
- **Punctuation and spacing.** Full-width punctuation in Chinese text （，。？）, and a space between Chinese and Latin words or numbers: `{n} 条未读`, `Enter 发送`.

If you can't read Chinese, say so in the pull request: a reviewer who can will check the strings. A rough translation marked for review is better than a missing one.

### Other languages welcome

Translations into more languages are welcome, and you don't need to write code to help:

- **Correct a translation.** Open a pull request that changes the string, or an issue that quotes it and the better wording.
- **Add a language.** Add a dictionary with the same keys as `en` to each plugin's `client.js`, and register it next to the others: `ctx.locale.register(NS, { zh, en, ja })`. Use the locale id DSH uses for that language. The plugins show it whenever DSH runs in that language, for example through a DSH language pack. Name the language in the pull request title, and keep its terms consistent with DSH's own wording where DSH has it.

`pnpm test` checks a new language for missing keys and placeholders. Native speakers review its wording.

## Develop

```sh
pnpm install
pnpm test
```

To try a package from a checkout, install it by path into a scratch profile: `dsh plugin --profile scratch add ./packages/<package>`.
