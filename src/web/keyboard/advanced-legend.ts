// The legend a cap prints in the Advanced view (D-101): the firmware's own names, such as KC_A or
// MO(1), where the default view prints plain labels. Pure, so the names are tested without a browser.
import { isKeyCode, keyCodeInfo } from "../../layout/keycodes.ts";
import type { Legend } from "../../layout/legend.ts";
import type { Binding, Firmware, Layout, Mod } from "../../layout/schema.ts";

const QMK_WRAP: Readonly<Record<Mod, string>> = { LCTL: "LCTL", LSFT: "LSFT", LALT: "LALT", LGUI: "LGUI", RCTL: "RCTL", RSFT: "RSFT", RALT: "RALT", RGUI: "RGUI" };
const ZMK_WRAP: Readonly<Record<Mod, string>> = { LCTL: "LC", LSFT: "LS", LALT: "LA", LGUI: "LG", RCTL: "RC", RSFT: "RS", RALT: "RA", RGUI: "RG" };

const keyName = (code: string, firmware: Firmware): string => {
  // A code outside the table (a hand-written layout) is shown as written.
  if (!isKeyCode(code)) return code;
  const info = keyCodeInfo(code);
  return (firmware === "qmk" ? info.qmk[0] : info.zmk[0]) ?? code;
};

function keyText(code: string, mods: readonly Mod[] | undefined, firmware: Firmware): string {
  const wraps = firmware === "qmk" ? QMK_WRAP : ZMK_WRAP;
  return (mods ?? []).reduceRight((inner, mod) => `${wraps[mod]}(${inner})`, keyName(code, firmware));
}

const modsText = (mods: readonly Mod[], firmware: Firmware): string => mods.map((mod) => (firmware === "qmk" ? mod : ZMK_WRAP[mod])).join("+");

const QMK_LAYER = { momentary: "MO", toggle: "TG", to: "TO", oneShot: "OSL" } as const;
const ZMK_LAYER = { momentary: "&mo", toggle: "&tog", to: "&to", oneShot: "&sl" } as const;

/** The firmware's names for a binding, or null for a binding with nothing to rename (transparent, none). */
export function advancedLegend(binding: Binding, layout: Layout): Pick<Legend, "tap" | "hold"> | null {
  const firmware = layout.firmware;
  const layerIndex = (id: string) => Math.max(0, layout.layers.findIndex((layer) => layer.id === id));
  switch (binding.kind) {
    case "key":
      return { tap: keyText(binding.code, binding.mods, firmware) };
    case "modifier":
      return { tap: modsText(binding.mods, firmware) };
    case "holdTap":
      return {
        tap: keyText(binding.tap.code, binding.tap.mods, firmware),
        hold: "mods" in binding.hold ? modsText(binding.hold.mods, firmware) : `${firmware === "qmk" ? "LT" : "&lt"}(${layerIndex(binding.hold.layerId)})`,
      };
    case "layer": {
      const index = layerIndex(binding.layerId);
      return { tap: firmware === "qmk" ? `${QMK_LAYER[binding.action]}(${index})` : `${ZMK_LAYER[binding.action]} ${index}` };
    }
    case "macro":
      return { tap: binding.macroId };
    case "native":
      return { tap: binding.source };
    case "transparent":
    case "none":
      return null;
  }
}
