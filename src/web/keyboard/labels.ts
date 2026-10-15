import type { Binding, Layout, Mod } from "../../layout/schema.ts";

export interface KeyLabel {
  // Tap output or the binding's name. Empty when the key is blank.
  main: string;
  // Hold glyph or layer name for hold-taps, the action for layer keys.
  sub?: string;
  // Firmware badge for `native` bindings, for example "QMK".
  badge?: string;
  // Transparent keys show the binding they fall through to, faded.
  faded: boolean;
}

// `satisfies` keeps the literal keys, and still fails to compile if a Mod is missing.
const MOD_GLYPH = {
  LCTL: "⌃",
  RCTL: "⌃",
  LSFT: "⇧",
  RSFT: "⇧",
  LALT: "⌥",
  RALT: "⌥",
  LGUI: "⌘",
  RGUI: "⌘",
} satisfies Record<Mod, string>;

const LAYER_ACTION = {
  momentary: "hold",
  toggle: "toggle",
  to: "go to",
  oneShot: "one-shot",
} satisfies Record<LayerAction, string>;

type LayerAction = Extract<Binding, { kind: "layer" }>["action"];

const BLANK: KeyLabel = { main: "", faded: false };

// Each lookup goes through find, so ids such as "constructor" resolve like any other id.
function layerName(layout: Layout, layerId: string): string {
  return layout.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
}

function modGlyphs(mods: readonly Mod[]): string {
  return [...new Set(mods.map((mod) => MOD_GLYPH[mod]))].join("");
}

// TODO(integration): replace with the keycode display names from src/layout/keycodes.ts
// once W1 lands it. Until then the stored code name is shown as-is.
function codeLabel(code: string, mods: readonly Mod[] | undefined): string {
  return `${mods ? modGlyphs(mods) : ""}${code}`;
}

export function bindingLabel(binding: Binding, layout: Layout): KeyLabel {
  switch (binding.kind) {
    case "key":
      return { main: codeLabel(binding.code, binding.mods), faded: false };
    case "modifier":
      return { main: modGlyphs(binding.mods), faded: false };
    case "holdTap": {
      const hold = binding.hold;
      const sub = "layerId" in hold ? layerName(layout, hold.layerId) : modGlyphs(hold.mods);
      return { main: codeLabel(binding.tap.code, binding.tap.mods), sub, faded: false };
    }
    case "layer":
      return {
        main: layerName(layout, binding.layerId),
        sub: LAYER_ACTION[binding.action],
        faded: false,
      };
    case "macro": {
      const macro = layout.macros.find((candidate) => candidate.id === binding.macroId);
      return { main: macro?.name ?? binding.macroId, faded: false };
    }
    case "transparent":
      return { main: "", faded: true };
    case "none":
      return BLANK;
    case "native":
      return { main: binding.label, badge: binding.firmware.toUpperCase(), faded: false };
  }
}

// Transparent keys fall through to the base layer, which is where QMK resolves them for
// layers entered from the base. Falling through further is not modelled here.
export function keyLabelAt(layout: Layout, layerIndex: number, keyIndex: number): KeyLabel {
  const binding = layout.layers[layerIndex]?.bindings[keyIndex];
  if (!binding) return BLANK;
  if (binding.kind !== "transparent") return bindingLabel(binding, layout);
  const underlying = layout.layers[0]?.bindings[keyIndex];
  if (!underlying || underlying.kind === "transparent") return { main: "", faded: true };
  return { ...bindingLabel(underlying, layout), faded: true };
}
