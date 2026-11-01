# Changelog

## 0.1.0-rc.1

First release candidate, published under the name `@rs-dsh/dsh-frosty-castle-theme` (Frosty Castle Theme).

- Add the Frost palette and decorative frame for DSH Web. Revise the frame with quieter iron rails using the full generated horizontal artwork, crystal medallions and a central rune crest while keeping the full trim visible. Add stone and ice texture to selected controls.
- **Frost controls.** Buttons, text boxes, menus, dialogs, tooltips and switches take the frost palette, carved corners and a frosted sheen, in both appearances.
- **Main text box frame.** Apply the stone and iron panel border styling to the composer card.
- **Section surface.** Give the collapsible section a flat, low-texture surface with an ice edge, so the textured inputs inside keep their contrast.
- **Settings grouping.** Move the page inset toggle and its per-side adjustments into one collapsible "Experimental page inset" section.
- **Frame defaults.** Set width to 48px, displacements to 9/12/9/12px, and inset adjustments to −16/0/−16/0px (top/right/bottom/left).
- **Border controls.** Use numeric width and per-edge displacement inputs; existing uniform displacement remains the fallback for unset edges.
- **Compatibility inset.** Add a default-on, guarded Web layout inset for the verified 0.2.1-rc.2 build, with a collapsible group of independent per-side adjustments and a setting to disable it.
- **Side rails.** Use vertically oriented frost and downward-hanging ice rather than rotated horizontal icicles.
- **Frame transitions.** Replace old rail-backed corners and crest with isolated transparent ornaments over continuous rails.
- **Border opacity.** Keep the iron rails opaque in light mode, regenerate the rail silhouettes with transparent backgrounds and soften the crest overlay edges.
- **Border displacement.** Move the full frame outward uniformly by 0–48 pixels, saved per profile.
- **Border width setting.** Set the frame from 12 to 48 pixels (default 30) on Frost's page under Plugins. It is saved in the active profile and applies without a reload.
