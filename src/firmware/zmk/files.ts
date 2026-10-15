// The two files MoErgo's template builds from (06#generation-writes-glove80keymap-and-glove80conf).
export const KEYMAP_FILE = "glove80.keymap";
export const CONF_FILE = "glove80.conf";

/** The includes every keyloom-written keymap starts with, as MoErgo's default keymap has them; the importer keeps only others. */
export const BASE_INCLUDES: readonly string[] = [
  "#include <behaviors.dtsi>",
  "#include <dt-bindings/zmk/keys.h>",
  "#include <dt-bindings/zmk/bt.h>",
  "#include <dt-bindings/zmk/ext_power.h>",
  "#include <dt-bindings/zmk/outputs.h>",
  "#include <dt-bindings/zmk/rgb.h>",
];

/** ZMK's layer state is a 32-bit mask. */
export const MAX_LAYERS = 32;
