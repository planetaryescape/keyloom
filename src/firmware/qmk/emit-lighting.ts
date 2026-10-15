// Per-layer LED colours as ZSA's Oryx writes them (D-190): a `ledmap[][LED][3]` of HSV triples, `set_layer_color()` to
// push one layer's row to the matrix, and `rgb_matrix_indicators_user()` choosing the row by the top layer. The text is
// Oryx's, whitespace included, so a layout imported from Oryx regenerates byte for byte (emit-lighting.test.ts reads
// BK's export to prove it) and the firmware it builds is the one Oryx builds.
import { DARK, colourAt } from "../../layout/colour.ts";
import type { Hsv, Layer } from "../../layout/schema.ts";

/** Layers that set LED colours, with their index in keymaps[]: the index is what the C compares layer_state against. */
export const litLayers = (layers: readonly Layer[]): Array<{ index: number; layer: Layer }> =>
  layers.flatMap((layer, index) => (layer.lighting === undefined ? [] : [{ index, layer }]));

const triple = ([h, s, v]: Hsv) => `{${h},${s},${v}}`;

export function renderLedmap(layers: readonly Layer[], ledPositions: readonly number[]): string {
  const rows = litLayers(layers).map(({ index, layer }) => {
    const leds = ledPositions.map((position) => triple(colourAt(layer, position)));
    return `    [${index}] = { ${leds.join(", ")} },\n`;
  });
  return `const uint8_t PROGMEM ledmap[][RGB_MATRIX_LED_COUNT][3] = {\n${rows.join("\n")}\n};`;
}

export const SET_LAYER_COLOR = `void set_layer_color(int layer) {
  for (int i = 0; i < RGB_MATRIX_LED_COUNT; i++) {
    HSV hsv = {
      .h = pgm_read_byte(&ledmap[layer][i][0]),
      .s = pgm_read_byte(&ledmap[layer][i][1]),
      .v = pgm_read_byte(&ledmap[layer][i][2]),
    };
    if (!hsv.h && !hsv.s && !hsv.v) {
        rgb_matrix_set_color( i, 0, 0, 0 );
    } else {
        RGB rgb = hsv_to_rgb_with_value(hsv);
        rgb_matrix_set_color(i, rgb.r, rgb.g, rgb.b);
    }
  }
}`;

export function renderIndicators(layers: readonly Layer[]): string {
  // The default branch sits one space shallower than the cases: that is how Oryx writes it.
  const cases = litLayers(layers).map(({ index }) => `      case ${index}:\n        set_layer_color(${index});\n        break;\n`);
  return `bool rgb_matrix_indicators_user(void) {
  if (rawhid_state.rgb_control) {
      return false;
  }
  if (!keyboard_config.disable_layer_led) { 
    switch (biton32(layer_state)) {
${cases.join("")}     default:
        if (rgb_matrix_get_flags() == LED_FLAG_NONE) {
          rgb_matrix_set_color_all(0, 0, 0);
        }
    }
  } else {
    if (rgb_matrix_get_flags() == LED_FLAG_NONE) {
      rgb_matrix_set_color_all(0, 0, 0);
    }
  }

  return true;
}`;
}

/**
 * What the colours above need from the rest of the file: Oryx's brightness-scaling helper and the post-init that turns the
 * matrix on. A layout imported from Oryx already carries them as passthrough; one that gains its first colour in keyloom doesn't.
 */
export const LIGHTING_PRELUDE = `extern rgb_config_t rgb_matrix_config;

RGB hsv_to_rgb_with_value(HSV hsv) {
  RGB rgb = hsv_to_rgb( hsv );
  float f = (float)rgb_matrix_config.hsv.v / UINT8_MAX;
  return (RGB){ f * rgb.r, f * rgb.g, f * rgb.b };
}

void keyboard_post_init_user(void) {
  rgb_matrix_enable();
}`;

export function renderLighting(layers: readonly Layer[], ledPositions: readonly number[]): string[] {
  return litLayers(layers).length === 0 ? [] : [renderLedmap(layers, ledPositions), SET_LAYER_COLOR, renderIndicators(layers)];
}
