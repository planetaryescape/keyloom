// A binding in plain words, for the viewer's inspector and for screen readers. Pure; it reads
// only the layout document, so the same sentences can serve the CLI and the agent later.
import { niceLayerName } from "./layer-ops.ts";
import { keyCodeLabel } from "./keycodes.ts";
import { profileWords } from "./option-words.ts";
import { type Legend, bindingLegend } from "./legend.ts";
import type { Binding, Layout, Macro, MacroStep, Mod, SlotAction } from "./schema.ts";
import { keptDefinitions } from "./kept-behaviours.ts";
import { readNative } from "./native-read.ts";
import type { Step } from "./native-meaning.ts";

export type Field = { label: string; value: string; code?: boolean };
export type BindingEffect = { text: string; complete: boolean };

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

export function macroStepWords(step: MacroStep): string {
  if (step.op === "waitMs") return `Wait ${step.ms} ms`;
  if (step.op === "text") return `Type "${step.text}"`;
  const verb = { tap: "Tap", press: "Press", release: "Release" }[step.op];
  return `${verb} ${outputWords(step.code, step.mods)}`;
}

/** One tap dance slot in words: "Caps Lock", "Left Shift", "Layer 1 while held", "macro Copy". */
export function slotActionWords(a: SlotAction, layout: Layout): string {
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
      const tap = binding.tap.macroId
        ? (layout.macros.find((m) => m.id === binding.tap.macroId)?.name ?? binding.tap.macroId)
        : outputWords(binding.tap.code, binding.tap.mods);
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
        headline: macro !== undefined && /^(?:ST_)?MACRO[\s_-]?\d+$/i.test(macro.name.trim()) ? `Runs a macro: ${macro.steps.map(macroStepWords).join(", then ").toLowerCase()}` : `Runs macro ${macro?.name ?? binding.macroId}`,
        fields: [{ label: "Macro", value: macro?.name ?? binding.macroId }],
        steps: macro?.steps.map(macroStepWords) ?? [],
      };
    }
    case "tapDance": {
      const td = layout.tapDances.find((candidate) => candidate.id === binding.tapDanceId);
      if (!td) return { ...base, headline: `Runs tap dance ${binding.tapDanceId}, which the layout doesn't have` };
      const slots: Array<[string, SlotAction | undefined]> = [
        ["Tapped", td.tap], ["Held", td.hold], ["Double-tapped", td.doubleTap], ["Tapped, then held", td.tapThenHold],
      ];
      const filled = slots.flatMap(([label, a]) => (a ? [{ label, value: slotActionWords(a, layout) }] : []));
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

const NATIVE_LIGHTING = {
  toggle: "Toggle keyboard lighting", hueUp: "Increase lighting hue", hueDown: "Decrease lighting hue",
  satUp: "Increase lighting saturation", satDown: "Decrease lighting saturation", briUp: "Increase lighting brightness",
  briDown: "Decrease lighting brightness", speedUp: "Increase lighting speed", speedDown: "Decrease lighting speed",
  effectNext: "Next lighting effect", effectPrev: "Previous lighting effect",
} satisfies Record<Extract<Step, { kind: "lighting" }>["op"], string>;

function nativeStepWords(step: Step): string {
  switch (step.kind) {
    case "oneShot": return `One-shot ${modsWords(step.mods)}`;
    case "capsWord": return "Turn on Caps Word";
    case "bootloader": return "Enter bootloader";
    case "reset": return "Restart the keyboard";
    case "lighting": return NATIVE_LIGHTING[step.op];
    case "bluetooth": return ({ clear: "Unpair this Bluetooth profile", clearAll: "Unpair every Bluetooth profile", next: "Select the next Bluetooth profile", previous: "Select the previous Bluetooth profile" })[step.op];
    case "bluetoothSelect": return `Select Bluetooth profile ${step.profile + 1}`;
    case "output": return step.to === "usb" ? "Use USB output" : "Use Bluetooth output";
  }
}

function macroWords(macro: Macro): string {
  return `macro ${macro.name}: ${macro.steps.map(macroStepWords).join(", then ")}`;
}

function actionComplete(action: SlotAction, layout: Layout): boolean {
  return action.kind !== "macro" || layout.macros.some((macro) => macro.id === action.macroId);
}

/** A comparison-safe account of a binding's modeled effect. Unknown native source stays verbatim and explicitly unverified. */
export function bindingEffectDescription(binding: Binding, layout: Layout): BindingEffect {
  switch (binding.kind) {
    case "key": return { text: `Sends ${outputWords(binding.code, binding.mods)}`, complete: true };
    case "modifier": return { text: `Holds ${modsWords(binding.mods)}`, complete: true };
    case "holdTap": {
      const tapMacro = binding.tap.macroId === undefined ? undefined : layout.macros.find((macro) => macro.id === binding.tap.macroId);
      const tap = tapMacro === undefined ? outputWords(binding.tap.code, binding.tap.mods) : macroWords(tapMacro);
      const hold = "mods" in binding.hold ? modsWords(binding.hold.mods) : layerName(layout, binding.hold.layerId);
      const profile = layout.holdTapProfiles.find((candidate) => candidate.id === binding.profileId);
      const holdLayerId = "layerId" in binding.hold ? binding.hold.layerId : undefined;
      const missing = (binding.tap.macroId !== undefined && tapMacro === undefined) || (holdLayerId !== undefined && !layout.layers.some((layer) => layer.id === holdLayerId));
      return { text: `Tap ${tap}; hold ${hold}; profile ${profile?.name ?? "unavailable"}`, complete: profile !== undefined && !missing };
    }
    case "layer": {
      const target = layout.layers.find((layer) => layer.id === binding.layerId);
      return { text: describeBinding(binding, layout).headline, complete: target !== undefined };
    }
    case "macro": {
      const macro = layout.macros.find((candidate) => candidate.id === binding.macroId);
      return macro === undefined
        ? { text: `Macro definition unavailable (${binding.macroId})`, complete: false }
        : { text: `Runs ${macroWords(macro)}`, complete: true };
    }
    case "tapDance": {
      const dance = layout.tapDances.find((candidate) => candidate.id === binding.tapDanceId);
      if (dance === undefined) return { text: `Tap-dance definition unavailable (${binding.tapDanceId})`, complete: false };
      const slots: Array<[string, SlotAction | undefined]> = [["tap", dance.tap], ["hold", dance.hold], ["double-tap", dance.doubleTap], ["tap then hold", dance.tapThenHold]];
      const actions = slots.flatMap(([label, action]) => action === undefined ? [] : [`${label}: ${slotActionWords(action, layout)}`]);
      if (dance.termMs !== undefined) actions.push(`term: ${dance.termMs} ms`);
      return { text: `Tap dance ${dance.name} (${actions.join("; ")})`, complete: slots.every(([, action]) => action === undefined || actionComplete(action, layout)) };
    }
    case "transparent": return { text: "Falls through to a lower layer", complete: true };
    case "none": return { text: "Does nothing", complete: true };
    case "native": {
      const reading = readNative(binding, keptDefinitions(layout.passthrough));
      if (reading.kind === "steps") return { text: reading.steps.map(nativeStepWords).join(", then "), complete: reading.steps.length > 0 };
      if (reading.kind === "holdLayer") {
        const target = layout.layers.find((layer) => layer.id === reading.layerId);
        if (target === undefined) {
          return { text: `Custom ${binding.firmware.toUpperCase()} source “${binding.source}” (hold target not established)`, complete: false };
        }
        if (reading.tapSteps.length === 0) {
          return { text: `Tap uses &${reading.tap} (effect not established); hold to use ${layerName(layout, reading.layerId)}; source “${binding.source}”`, complete: false };
        }
        return { text: `Tap ${reading.tapSteps.map(nativeStepWords).join(", then ")}; hold to use ${layerName(layout, reading.layerId)}`, complete: true };
      }
      return { text: `Custom ${binding.firmware.toUpperCase()} source “${binding.source}” (meaning not established)`, complete: false };
    }
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
