---
name: dsh-plugin-icons
description: Design, draw and ship a DeepSeek Harness plugin icon in the rs-dsh style — DSH's own flat blue-gradient icon language with one glossy amber focus — wire it into package.json so DSH's Plugins page shows it, render the storefront tile, and check it next to DSH's icons.
whenToUse: A plugin needs an icon or a new one, an icon looks off next to DSH's own, a storefront or catalog asks for an icon image, or someone asks for "an icon like DSH's".
---

# DSH plugin icons, rs-dsh style

The icons look like DSH's own plugin icons, so a plugin sits naturally in DSH's Plugins page, plus one signature: a single glossy amber part that marks what the plugin is about. Start from [template.svg](template.svg); [example-drafts.svg](example-drafts.svg) is a finished one.

## 1. Look at DSH's icons first

DSH ships one `icon.svg` per optional package. Read two or three before drawing, from the installed DSH, not from memory:

```sh
M=$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai
ls $M/*/icon.svg          # dsh-experimental-tool-worktree, -auto-review, -inspector, -voice-input-bundle, …
```

What they share, and what ours keep:

- A `0 0 36 36` view box, no background, no tile: DSH draws the 48 × 48 tile with a hairline border around the 36 × 36 icon.
- Flat filled shapes, not outlines. Two or three shapes, at most.
- Gradients run top-left light to bottom-right deep.
- White for detail inside a shape: text lines, a check mark. Detail lines are 1.5 wide with round caps.
- Shapes keep about 6 units of margin: content within 6–30.

## 2. Palette

| Role | Colour |
|---|---|
| Main shape | gradient `#6DB9FB` → `#3650DE` (DSH's blue) |
| Secondary shape | `#7FB7FC`, at 0.4–0.8 opacity for things behind or less important |
| Alternative main | gradient `#51CFDB` → `#3F77D8` (DSH's cyan), so a second icon in a family differs |
| Pale accent | `#B9D7FB` (a folded corner, an eraser) |
| Detail | `#FFFFFF` |
| **Focus (the rs-dsh touch)** | gradient `#FFD59A` → `#F2AF63` (0.55) → `#E08A2E` |

Amber appears in DSH only in the Agent Teams icon, so it reads as DSH's family and still marks the icon as ours. Use it on exactly one part.

## 3. Choose the metaphor

1. Name the one thing the plugin is about, in a word: a step in progress, a quoted passage, a highlighted sentence, the pen still writing.
2. Draw the object it acts on in blue (a board, a message box, a bubble, a page), and that one thing in amber.
3. Check it against the family: no two rs-dsh icons share their main silhouette. Bubble = threads, quote marks = quote, board = cockpit, message box with a pen = drafts.
4. When unsure, draw two or three options and show them side by side at 36 px on light and dark tiles (step 6). Let the owner pick.

Prefer what reads at 36 px over what is clever. Something that sticks out of the main shape (a pencil over the edge) gives the icon movement.

## 4. Character: the shine

- **Focus:** the amber gradient, plus a white rim light on its top-left edge: the same shape inset by 0.4, stroked 0.8 wide with white fading from 0.95 to 0 opacity by 45%.
- **Main shape:** a fainter rim on the same edge, so both catch one light: the same path stroked 2 wide inside a `clipPath` of itself (so only the inner half shows), white 0.6 fading to 0 by 40%.
- A focus part narrower than 3 units shows no shine; make it 3 wide.

## 5. Pitfalls

- **Unique ids.** Prefix every gradient and clip id with the plugin's name (`drafts-page`, `quote-bar`). DSH puts all icons on one page as images, and storefronts may inline them; a shared id paints another icon's shape.
- **Gradients under a transform.** With `gradientUnits="userSpaceOnUse"`, a gradient used inside `transform="…"` is measured in the transformed shape's own coordinates. Give it coordinates in that space, or the shape picks up one end of the gradient and looks flat. This is what made the quote marks look flat at first.
- **Nothing outside 0–36.** It is clipped.
- **No text or letters.** They are unreadable at 36 px and wrong in the other language.

## 6. Check it

Preview at the real size before calling it done: a page with each candidate in a 48 × 48 tile with a 0.5 px border, 36 × 36 image, on white and on `#18181a`, next to two of DSH's own icons, plus a large zoom. Render it with headless Chrome at 2× and look at it:

```sh
google-chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=700,560 --screenshot=preview.png file:///path/to/preview.html
```

Look for: a gradient you can see, a rim on the focus, the icon matching DSH's weight next to Git Worktrees and Auto Review, and both themes working.

## 7. Ship it

1. Save the icon as `packages/<name>/icon.svg`. In its `package.json`, add `"icon": "./icon.svg"` (after `keywords`) and `icon.svg` to `files`. DSH reads the manifest icon and shows it on its Plugins page, cards and details; without one it shows the default artwork.
2. Render the storefront tile: `node scripts/render-icons.mjs <name>` writes `docs/icon.png`, 512 × 512, the icon on DSH's plugin-card tile. Catalogs need it because they accept only raster images hosted on GitHub.
3. Verify in DSH, never in the user's own profile: a scratch `DSH_HOME` with the package added by path and `@deepseek-ai/dsh-web-app`, then open **Plugins** and screenshot **Installed plugins** in light and dark (the dsh-plugin-dev skill, step 4, has the setup). Close the sign-in dialog with Escape first.
4. The icon reaches users with the next release of the package. With no other change, that is a patch version whose CHANGELOG entry says the plugin now has an icon.

Outside this repository the same steps apply. Without `scripts/render-icons.mjs`, render the tile from an HTML page: a 512 × 512 white box with radius 128 and a 6 px `#E4E4E7` border, the icon centred at 384 × 384, screenshotted with `--default-background-color=00000000`.
