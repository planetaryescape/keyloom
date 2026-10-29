// Keyloom's existing per-layer colours become static RGB-matrix overlays. Keep the same overlay
// registry on both halves: the module synchronizes their gates by declaration order.
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { colourAt, hsvToHex } from "../../layout/colour.ts";
import { GenerateError } from "./generate-error.ts";

export function renderZmkLighting(layout: Layout, board: BoardDefinition): string[] {
  const build = board.revisions[0]?.build;
  const rgb = build?.kind === "zmk-west-docker" ? build.rgbMatrix : undefined;
  if (!rgb) {
    if (layout.layers.some((layer) => layer.lighting !== undefined)) throw new GenerateError(`${board.id} has no per-key ZMK lighting adapter`);
    return [];
  }
  if (build?.kind !== "zmk-west-docker" || build.targets.length !== 2 || !build.targets.some((target) => target.id === rgb.leftTarget)) {
    throw new GenerateError(`${board.id} needs two RGB targets and a matching leftTarget`);
  }
  const positions = board.lighting?.ledPositions;
  if (!positions || rgb.leftLedCount >= positions.length || new Set(positions).size !== positions.length || positions.some((p) => p >= board.keyCount)) {
    throw new GenerateError(`${board.id} needs a unique, in-range LED map for both halves`);
  }
  if (layout.passthrough.some((p) => /keypaw,rgb-|\bklrgb\b|\bklfx\b/.test(p.source))) {
    throw new GenerateError("This keymap already contains RGB matrix source. Keep its original source or remove it before generating keyloom colours; two controllers cannot drive the same LEDs.");
  }
  const halves = [positions.slice(0, rgb.leftLedCount), positions.slice(rgb.leftLedCount)];
  const perHalf = (property: string, values: string[][]) => [
    "#if KEYLOOM_RGB_LEFT",
    `        ${property} = <${values[0]?.join(" ")}>;`,
    "#else",
    `        ${property} = <${values[1]?.join(" ")}>;`,
    "#endif",
  ];
  const layers = layout.layers.flatMap((layer, index) => layer.lighting === undefined ? [] : [{ layer, index }]);
  return [
    `// keyloom-rgb-begin ${JSON.stringify(layout.layers.map((layer) => layer.lighting ?? null))}`,
    "#include <dt-bindings/keypaw/rgb_matrix.h>",
    "#ifndef KEYLOOM_RGB_LEFT",
    '#error "Build with keyloom: each RGB target needs KEYLOOM_RGB_LEFT set to 0 or 1"',
    "#endif",
    "/ {",
    "    chosen { /delete-property/ zmk,underglow; };",
    "    klrgb: klrgb {",
    '        compatible = "keypaw,rgb-matrix";',
    "        #binding-cells = <2>;",
    `        strip = <&${rgb.strip}>;`,
    `        physical-layout = <&${rgb.physicalLayout}>;`,
    ...perHalf("mapping", halves.map((ps) => ps.map(String))),
    `        max-brightness = <${rgb.maxBrightness}>;`,
    "        initial-brightness = <60>;",
    "        initial-on;",
    "        klfx: klfx {",
    '            compatible = "keypaw,rgb-overlay";',
    "            controllable;",
    "            #binding-cells = <2>;",
    "            all-leds;",
    '            solid { compatible = "keypaw,rgb-matrix-solid"; color = <0x00b8d4>; };',
    '            breathe { compatible = "keypaw,rgb-matrix-breathe"; color = <0x00b8d4>; duration = <2400>; };',
    '            spectrum { compatible = "keypaw,rgb-matrix-spectrum"; duration = <4000>; };',
    "        };",
    ...layers.flatMap(({ layer, index }) => [
      `        layer_${index} {`,
      '            compatible = "keypaw,rgb-overlay";',
      `            condition = <&klcond_${index}>;`,
      "            all-leds;",
      "            colours {",
      '                compatible = "keypaw,rgb-matrix-static";',
      ...perHalf("led-colors", halves.map((ps) => ps.map((p) => hsvToHex(colourAt(layer, p)).replace("#", "0x")))),
      "            };",
      "        };",
    ]),
    "    };",
    ...(layers.length ? [
      "    klconditions {",
      '        compatible = "keypaw,rgb-conditions";',
      ...layers.flatMap(({ index }) => [
        `        klcond_${index}: layer_${index} {`,
        '            compatible = "keypaw,rgb-condition-layer";',
        `            layer = <${index}>;`,
        "            only-topmost;",
        "        };",
      ]),
      "    };",
    ] : []),
    "};",
    "// keyloom-rgb-end",
  ];
}

/** Preserve the imported RGB controls while replacing the engine. Both behaviours take the same
 * two cells, including RGB_COLOR_HSB's packed value. Unknown calls fail rather than silently vanish. */
export function matrixControls(source: string): string {
  return source.replace(/&rgb_ug\s+(RGB_[A-Z_]+)/g, (_call, command: string) => {
    const global = /^RGB_(TOG|ON|OFF|BRI|BRD)(?:_CMD)?$/.test(command);
    const effect = /^RGB_(HUI|HUD|SAI|SAD|SPI|SPD|EFF|EFR|EFS|COLOR_HSB)(?:_CMD)?$/.test(command);
    if (!global && !effect) throw new GenerateError(`RGB matrix does not support ${command}`);
    return `&${global ? "klrgb" : "klfx"} ${command}`;
  });
}
