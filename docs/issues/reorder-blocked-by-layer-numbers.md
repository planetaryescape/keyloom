# BK can't reorder layers, or delete one the custom code names, on either board

Move left, Move right and Delete are blocked on BK's Moonlander and Glove80, because both carry passthrough code that names layers by number (`passthrough_layer_index`, D-024): Oryx's per-layer RGB and keymap code on the Moonlander (`LT(5, ...)`, `layer_move(5)`, `case 4:` and `ledmap[4]`), and MoErgo's layer defines on the Glove80.

Removing a trailing layer that no passthrough names, including one just added, now passes. The cause was that the rule counted the removed layer itself as a layer that had moved, so it refused every removal; it now refuses only when a pinned block names a removed layer's number (`namesLayerNumber` in `src/validation/rules.ts`).

What is left: teach the generators to rewrite the known layer-number patterns (Oryx's `layer_state_cmp`/`LAYER_` enums and `ledmap` rows, ZMK `#define` layer names) so a reorder, or the removal of a layer the code names, keeps the custom code pointing at the right layers.
