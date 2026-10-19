// The names generation writes for things keyloom models, and the firmware names they must not clash with
// (07#warnings `identifier_clash`). Shared by src/firmware/zmk, which writes them, and src/validation, which
// warns about them before a build, so the writer and the check can't drift. Pure: no imports beyond the IR.

import type { Combo } from "./schema.ts";

/** A devicetree label or node name ZMK accepts: letters, digits and underscores. */
export const labelOf = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, "_");

// A combo is written as a child node of `combos`, and the devicetree grammar allows these characters in a node name.
const NODE_NAME = /[^A-Za-z0-9_,.+-]/g;

/** The devicetree node name a combo is written as, from its display name (06). It has no label, so it can't shadow a behaviour. */
export const comboNodeName = (c: Combo): string => c.name.replace(NODE_NAME, "_");

/**
 * Labels ZMK's own behaviours use; a keymap that defined one of these would shadow it for every binding.
 * ZMK's `app/dts/behaviors/*.dtsi` at moergo-sc/zmk ce69e85.
 */
export const ZMK_BEHAVIOR_LABELS: ReadonlySet<string> = new Set([
  "kp", "mo", "to", "tog", "sl", "lt", "mt", "trans", "none", "sk", "kt", "caps_word", "key_repeat", "bt", "out", "rgb_ug", "ext_power",
  "sys_reset", "bootloader", "studio_unlock", "mkp", "mmv", "msc", "macro_tap", "macro_press", "macro_release", "macro_wait_time",
  "macro_tap_time", "macro_pause_for_release", "gresc", "sel_dn", "soft_off",
]);

/**
 * ZMK's own hold-taps: `&mt` and `&lt`. A layout tunes one by overriding it (`&mt { ... }`) instead of
 * defining a node, so a hold-tap profile with one of these ids is that override, not a clash
 * (src/firmware/zmk/builtins.ts, whose BUILTIN_PROFILES keys a test pins to this set).
 */
export const ZMK_BUILTIN_HOLD_TAPS: ReadonlySet<string> = new Set(["mt", "lt"]);
