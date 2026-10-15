// A binding in plain words, for the viewer's inspector and for screen readers. Pure; it reads
// only the layout document, so the same sentences can serve the CLI and the agent later.
import { keyCodeLabel } from "./keycodes.ts";
import { type Legend, bindingLegend } from "./legend.ts";
import type { Binding, Layout, MacroStep, Mod } from "./schema.ts";

export type Field = { label: string; value: string; code?: boolean };

export type ComboUse = {
  name: string;
  /** The other keys in the chord, by position. */
  partners: number[];
  output: string;
  /** "all layers", or the layer names the combo is limited to. */
  scope: string;
  activeHere: boolean;
};

export type KeyDescription = {
  kind: Binding["kind"];
  legend: Legend;
  headline: string;
  fields: Field[];
  /** Macro steps, one per line. */
  steps: string[];
  /** Hold-tap profile options such as "CHORDAL_HOLD: true". */
  options: string[];
  combos: ComboUse[];
  /** For a layer key: the layer it points at, so the viewer can offer to open it. */
  targetLayerId?: string;
};

const MOD_NAME: Record<Mod, string> = {
  LCTL: "Left Ctrl",
  LSFT: "Left Shift",
  LALT: "Left Alt",
  LGUI: "Left GUI",
  RCTL: "Right Ctrl",
  RSFT: "Right Shift",
  RALT: "Right Alt",
  RGUI: "Right GUI",
};

const same = (a: readonly Mod[], b: readonly Mod[]) => a.length === b.length && b.every((m) => a.includes(m));

/** "Left Shift + Left GUI"; the two sets people name get their names, spelled out after them. */
export function modsWords(mods: readonly Mod[]): string {
  if (same(mods, ["LCTL", "LSFT", "LALT", "LGUI"])) return "Hyper (Ctrl + Shift + Alt + GUI)";
  if (same(mods, ["LCTL", "LSFT", "LALT"])) return "Meh (Ctrl + Shift + Alt)";
  return mods.map((mod) => MOD_NAME[mod]).join(" + ");
}

// A label that is punctuation ("-", "[") says nothing in words, so the code name stands in.
function keyWords(code: string): string {
  const label = keyCodeLabel(code);
  if (/^[A-Za-z0-9]/.test(label)) return label;
  const words = code.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function outputWords(code: string | undefined, mods: readonly Mod[] | undefined): string {
  const parts = [mods ? modsWords(mods) : undefined, code === undefined ? undefined : keyWords(code)];
  return parts.filter((part) => part !== undefined).join(" + ");
}

function stepWords(step: MacroStep): string {
  if (step.op === "waitMs") return `Wait ${step.ms} ms`;
  const verb = { tap: "Tap", press: "Press", release: "Release" }[step.op];
  return `${verb} ${outputWords(step.code, step.mods)}`;
}

const layerName = (layout: Layout, layerId: string): string =>
  layout.layers.find((layer) => layer.id === layerId)?.name ?? layerId;

const LAYER_SENTENCE = {
  momentary: (name: string) => `Hold to use ${name} while the key is down`,
  toggle: (name: string) => `Press to switch ${name} on or off`,
  to: (name: string) => `Press to switch to ${name} and turn the other layers off`,
  oneShot: (name: string) => `Tap to use ${name} for the next key press only`,
} satisfies Record<Extract<Binding, { kind: "layer" }>["action"], (name: string) => string>;

function describeBinding(binding: Binding, layout: Layout): Omit<KeyDescription, "combos" | "legend"> {
  const base = { kind: binding.kind, fields: [] as Field[], steps: [] as string[], options: [] as string[] };
  switch (binding.kind) {
    case "key": {
      const output = outputWords(binding.code, binding.mods);
      return { ...base, headline: `Sends ${output}` };
    }
    case "modifier": {
      const words = modsWords(binding.mods);
      return { ...base, headline: `Holds ${words} while pressed` };
    }
    case "holdTap": {
      const tap = outputWords(binding.tap.code, binding.tap.mods);
      const hold =
        "mods" in binding.hold ? modsWords(binding.hold.mods) : layerName(layout, binding.hold.layerId);
      const profile = layout.holdTapProfiles.find((candidate) => candidate.id === binding.profileId);
      return {
        ...base,
        headline: `Tap for ${tap}, hold for ${hold}`,
        fields: [
          { label: "Tap", value: tap },
          { label: "Hold", value: hold },
          { label: "Profile", value: profile?.name ?? binding.profileId },
        ],
        options: Object.entries(profile?.options ?? {}).map(([key, value]) => `${key}: ${String(value)}`),
      };
    }
    case "layer": {
      const name = layerName(layout, binding.layerId);
      const action = { momentary: "Momentary", toggle: "Toggle", to: "Go to", oneShot: "One-shot" }[
        binding.action
      ];
      return {
        ...base,
        headline: LAYER_SENTENCE[binding.action](name),
        fields: [
          { label: "Action", value: action },
          { label: "Layer", value: name },
        ],
        targetLayerId: binding.layerId,
      };
    }
    case "macro": {
      const macro = layout.macros.find((candidate) => candidate.id === binding.macroId);
      return {
        ...base,
        headline: `Runs macro ${macro?.name ?? binding.macroId}`,
        fields: [{ label: "Macro", value: macro?.name ?? binding.macroId }],
        steps: macro?.steps.map(stepWords) ?? [],
      };
    }
    case "native":
      return {
        ...base,
        headline: `${binding.firmware.toUpperCase()} binding ${binding.source}, passed through as written`,
        fields: [
          { label: "Label", value: binding.label },
          { label: "Firmware", value: binding.firmware.toUpperCase() },
          { label: "Source", value: binding.source, code: true },
        ],
      };
    case "transparent":
      return { ...base, headline: "Transparent" };
    case "none":
      return { ...base, headline: "Does nothing" };
  }
}

/**
 * What a transparent key shows through to. Transparent keys fall to the layer beneath; the viewer
 * can't know which layers are switched on, so it reports the base layer, where a layer entered
 * from the base resolves them.
 */
export function throughBinding(layout: Layout, layerIndex: number, keyIndex: number): Binding | null {
  if (layerIndex === 0) return null;
  const below = layout.layers[0]?.bindings[keyIndex];
  return below === undefined || below.kind === "transparent" ? null : below;
}

function combosAt(layout: Layout, layerIndex: number, keyIndex: number): ComboUse[] {
  const layerId = layout.layers[layerIndex]?.id;
  return layout.combos
    .filter((combo) => combo.positions.includes(keyIndex))
    .map((combo) => ({
      name: combo.name,
      partners: combo.positions.filter((position) => position !== keyIndex),
      output: describeBinding(combo.output, layout).headline,
      scope:
        combo.layerIds === "all"
          ? "all layers"
          : combo.layerIds.map((id) => layerName(layout, id)).join(", "),
      activeHere: combo.layerIds === "all" || (layerId !== undefined && combo.layerIds.includes(layerId)),
    }));
}

export function describeKey(layout: Layout, layerIndex: number, keyIndex: number): KeyDescription | null {
  const layer = layout.layers[layerIndex];
  const binding = layer?.bindings[keyIndex];
  if (layer === undefined || binding === undefined) return null;
  const ctx = { layers: layout.layers, macros: layout.macros };
  const combos = combosAt(layout, layerIndex, keyIndex);
  if (binding.kind !== "transparent") {
    return { ...describeBinding(binding, layout), legend: bindingLegend(binding, ctx), combos };
  }
  const below = throughBinding(layout, layerIndex, keyIndex);
  const baseName = layout.layers[0]?.name ?? "the base layer";
  if (below === null) {
    return {
      ...describeBinding(binding, layout),
      legend: bindingLegend(binding, ctx),
      headline:
        layerIndex === 0
          ? "Transparent, with no layer beneath it, so it does nothing"
          : `Transparent, and ${baseName} has nothing here either`,
      combos,
    };
  }
  const through = describeBinding(below, layout);
  return {
    ...through,
    kind: "transparent",
    legend: { ...bindingLegend(below, ctx), kind: "transparent" },
    headline: `Transparent: does what ${baseName} does here. ${through.headline}`,
    combos,
  };
}
