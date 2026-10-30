# A ZMK layer-hold that taps a modified key cannot be put on a QMK board

Status: open, 2026-10-30. Surfaced while putting a Corne config on the Moonlander; the put now says so and leaves no config behind (`c13f929`), but the mapping still cannot be made.

Putting the Corne config that runs BK's Glove80 layout onto the Moonlander was refused by the validator:

```
layer "magic-layer", position 26: QMK hold-taps can't tap a modified key (SPACE with RCTL+RSFT+RALT+RGUI)
```

The source key is a ZMK layer-hold on a modified space (`&layer_on_hold 1 LA(SPACE)` in the Corne's Magic layer). The cross-board transfer reads it as a QMK hold-tap whose tap is a modified key, which QMK cannot express. Before `c13f929` the web returned "internal error" after making the config, and a retry failed with `a config named … already exists`. Now the preview names the problem, disables Make, and no config is created, but there is still no way to carry that key.

This is the same class of gap that made the Corne setup use an explicit transfer instead of the general cross-board proposal ([keebart-corne-first-flash](keebart-corne-first-flash.md): "the general cross-board proposal was not used because it omitted native passthrough behaviors").

The fix belongs in the put plan, not the validator: a key the target cannot express should be reported as not carried, with the reason and the source key, the way other uncarryable keys already are. Two options, both needing a decision:

- Leave the key out and list it among the keys that stay behind, so the rest of the layout can be put on.
- Write a QMK layer-tap with the unmodified tap (`SPACE`) and say the four modifiers were dropped.

Silently changing the key is not an option (D-014). A regression test can reproduce this without a keyboard: build a ZMK source layout with a `holdTap` whose tap has mods, put it onto a QMK target, and assert the error and that no config is left behind (`test/app/keyboard-put-atomic.test.ts` already covers the second half).
