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
