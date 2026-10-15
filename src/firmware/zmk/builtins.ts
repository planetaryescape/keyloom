// ZMK's own `&mt` and `&lt` hold-taps, which a keymap uses without defining.
import type { OptionValue } from "./props.ts";

/** Which first parameter each takes: modifiers or a layer. */
export type HoldKind = "mods" | "layer";

export const BUILTIN_PROFILES = new Map<string, HoldKind>([["mt", "mods"], ["lt", "layer"]]);

/** What ZMK defines for them (app/dts/behaviors/mod_tap.dtsi and layer_tap.dtsi at moergo-sc/zmk ce69e85). */
export const BUILTIN_OPTIONS: Readonly<Record<string, Record<string, OptionValue>>> = {
  mt: { bindings: "&kp &kp", flavor: "hold-preferred", "tapping-term-ms": 200 },
  lt: { bindings: "&mo &kp", flavor: "tap-preferred", "tapping-term-ms": 200 },
};

export const BUILTIN_NAMES: Readonly<Record<string, string>> = { mt: "Mod-Tap", lt: "Layer-Tap" };

/**
 * ZMK's own default for the wait after each macro binding (CONFIG_ZMK_MACRO_DEFAULT_WAIT_MS, 15 at moergo-sc/zmk
 * ce69e85 and ZMK v0.3.0, app/Kconfig). A wait step puts the macro back on it once the pause is over.
 */
export const ZMK_MACRO_DEFAULT_WAIT_MS = 15;
