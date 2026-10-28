# @rs-dsh/dsh-core

The shared base of the rs-dsh plugins for DeepSeek Harness. It gives them one selection toolbar, so their buttons share one box, and draws their boxes with DSH's own components. You don't install it yourself: [dsh-threads](https://github.com/romany-saad/dsh-plugins/tree/main/packages/dsh-threads) and [dsh-quote](https://github.com/romany-saad/dsh-plugins/tree/main/packages/dsh-quote) bring it with them.

![Quote and Comment side by side in one toolbar above a selected sentence](https://raw.githubusercontent.com/romany-saad/dsh-plugins/main/packages/dsh-core/docs/images/one-toolbar.png)

## Install

Install the plugins you want. Each one brings this package and adds it to the profile:

```sh
dsh plugin --profile <name> add @rs-dsh/dsh-threads@0.3.0 @rs-dsh/dsh-quote@0.2.0
```

Then reload the DSH web page. However many rs-dsh plugins you install, the core runs once.

## Requirements

- DSH 0.2.1-rc.2 or later. It is tested with 0.2.1-rc.2.
- A profile with the web GUI (`@deepseek-ai/dsh-web-app`), such as `web`.

## What you see

- **One selection toolbar.** Select text in a conversation and the actions of every installed rs-dsh plugin show in one box, such as **Quote** and **Comment**. An action only shows where it applies: for example, there's no **Comment** on tool output.
- **Boxes that look like DSH.** Buttons, text boxes, menus and replies are DSH's own components, so they follow DSH's theme and its updates. A box closes with **Esc** or a click outside it, and only one is open at a time.

## Limits

- **Web GUI only.**
- **Needs DSH's UI library.** The core uses `@deepseek-ai/dsh-client-ui-primitives`, which DSH's web app ships. If a DSH release drops it or renames a part the core uses, the rs-dsh plugins stop at start with a message saying so, until they're updated.

## More

- [CHANGELOG.md](https://github.com/romany-saad/dsh-plugins/blob/main/packages/dsh-core/CHANGELOG.md)
- [MIT License](https://github.com/romany-saad/dsh-plugins/blob/main/packages/dsh-core/LICENSE)
- For maintainers, and for writing a plugin on the core: [DEVELOPING.md](https://github.com/romany-saad/dsh-plugins/blob/main/packages/dsh-core/DEVELOPING.md)
