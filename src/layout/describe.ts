// A binding in plain words, for the viewer's inspector and for screen readers. Pure; it reads
// only the layout document, so the same sentences can serve the CLI and the agent later.
import { niceLayerName } from "./layer-ops.ts";
import { keyCodeLabel } from "./keycodes.ts";
import { profileWords } from "./option-words.ts";
import { type Legend, bindingLegend } from "./legend.ts";
import type { Binding, Layout, MacroStep, Mod, SlotAction } from "./schema.ts";

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
  /** Hold-tap profile options in plain words, such as "Chordal hold" or "Tapping term 200 ms". */
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
  if (step.op === "text") return `Type "${step.text}"`;
  const verb = { tap: "Tap", press: "Press", release: "Release" }[step.op];
  return `${verb} ${outputWords(step.code, step.mods)}`;
}

/** One tap dance slot in words: "Caps Lock", "Left Shift", "Layer 1 while held", "macro Copy". */
function slotWords(a: SlotAction, layout: Layout): string {
  switch (a.kind) {
    case "key": return outputWords(a.code, a.mods);
    case "modifier": return modsWords(a.mods);
    case "layer": return `${{ momentary: "hold", toggle: "toggle", to: "go to", oneShot: "one-shot" }[a.action]} ${layerName(layout, a.layerId)}`;
    case "macro": return `macro ${layout.macros.find((m) => m.id === a.macroId)?.name ?? a.macroId}`;
  }
}

const layerName = (layout: Layout, layerId: string): string => niceLayerName(layout.layers.find((layer) => layer.id === layerId)?.name ?? layerId);

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
        options: profile === undefined ? [] : profileWords(profile),
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
        // A macro named only by its firmware slot (Oryx's ST_MACRO_1) is described by what it does, not by that name (D-270).
        headline: macro !== undefined && /^(?:ST_)?MACRO[\s_-]?\d+$/i.test(macro.name.trim()) ? `Runs a macro: ${macro.steps.map(stepWords).join(", then ").toLowerCase()}` : `Runs macro ${macro?.name ?? binding.macroId}`,
        fields: [{ label: "Macro", value: macro?.name ?? binding.macroId }],
        steps: macro?.steps.map(stepWords) ?? [],
      };
    }
    case "tapDance": {
      const td = layout.tapDances.find((candidate) => candidate.id === binding.tapDanceId);
      if (!td) return { ...base, headline: `Runs tap dance ${binding.tapDanceId}, which the layout doesn't have` };
      const slots: Array<[string, SlotAction | undefined]> = [
        ["Tapped", td.tap], ["Held", td.hold], ["Double-tapped", td.doubleTap], ["Tapped, then held", td.tapThenHold],
      ];
      const filled = slots.flatMap(([label, a]) => (a ? [{ label, value: slotWords(a, layout) }] : []));
      const sentence = filled.map((f) => `${f.label.toLowerCase()}: ${f.value}`).join("; ");
      return {
        ...base,
        headline: `Tap dance ${td.name}. ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`,
        fields: [...filled, ...(td.termMs === undefined ? [] : [{ label: "Term", value: `${td.termMs} ms` }])],
        // A layer slot lets the viewer open the layer, the way a layer key does.
        ...(() => {
          const layer = [td.hold, td.doubleTap, td.tapThenHold, td.tap].find((a) => a?.kind === "layer");
          return layer?.kind === "layer" ? { targetLayerId: layer.layerId } : {};
        })(),
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
  const ctx = { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances, passthrough: layout.passthrough };
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
