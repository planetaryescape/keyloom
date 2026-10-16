// What the layout's library lists (16#the-library-lists-what-keys-share-and-is-never-a-required-step): macros, tap dances and
// timing profiles, each with where it is used. Nothing has to be made here; it is for seeing what is shared and reusing it. Pure.
import type { Slot } from "../../layout/change.ts";
import { tapDanceSlots } from "../../layout/functions.ts";
import type { Layout } from "../../layout/schema.ts";
import { keyName } from "../editor/lost-functions.ts";
import { cardTitle, macroWords } from "../card/card-words.ts";
import { bindingLegend } from "../../layout/legend.ts";
import { layerDisplayName } from "../../layout/cap-words.ts";

// A combo by the first legends of its keys: "S + D".
function comboWords(layout: Layout, positions: readonly number[]): string {
  const base = layout.layers[0];
  const ctx = { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances };
  return positions.map((p) => (base?.bindings[p] === undefined ? "?" : bindingLegend(base.bindings[p], ctx).tap || "blank")).join(" + ");
}

/** A place an item is used: in words, and for keys the cap's legend and its layer, so the sheet can draw it as a small cap. */
export type LibraryUse = { label: string; slot?: Slot; legend?: string; layer?: string; combo?: string[] };
export type LibraryItem = { id: string; name: string; detail: string; uses: LibraryUse[] };
export type Library = { macros: LibraryItem[]; tapDances: LibraryItem[]; profiles: LibraryItem[] };

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every key and combo for which `match` holds, named the way the editor names them. */
function usesOf(layout: Layout, match: (binding: Layout["layers"][number]["bindings"][number]) => boolean): LibraryUse[] {
  const ctx = { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances };
  const keys = layout.layers.flatMap((layer) =>
    layer.bindings.flatMap((binding, position): LibraryUse[] =>
      match(binding)
        ? [{ label: keyName(layout, { layerId: layer.id, position }), slot: { layerId: layer.id, position }, legend: legendText(binding), layer: layerDisplayName(layer.name) }]
        : [],
    ),
  );
  const combos = layout.combos.filter((combo) => match(combo.output)).map((combo): LibraryUse => ({ label: `The combo ${comboWords(layout, combo.positions)}`, combo: comboWords(layout, combo.positions).split(" + ") }));
  function legendText(binding: Layout["layers"][number]["bindings"][number]): string {
    const legend = bindingLegend(binding, ctx);
    return legend.tap === "" ? "blank" : legend.hold === undefined ? legend.tap : `${legend.tap} ${legend.hold}`;
  }
  return [...keys, ...combos];
}

export function libraryOf(layout: Layout): Library {
  const dance = (id: string) => layout.tapDances.find((candidate) => candidate.id === id);
  return {
    macros: layout.macros.map((macro) => ({
      id: macro.id,
      // Oryx's slot names (ST_MACRO_1) say nothing; what it sends does (D-276).
      name: macroWords(macro),
      detail: macro.steps.length === 1 ? "One step" : `${count(macro.steps.length, "step")}, in order`,
      uses: usesOf(layout, (b) => {
        if (b.kind === "macro") return b.macroId === macro.id;
        const entry = b.kind === "tapDance" ? dance(b.tapDanceId) : undefined;
        return entry !== undefined && tapDanceSlots(entry).some(([, action]) => action.kind === "macro" && action.macroId === macro.id);
      }),
    })),
    tapDances: layout.tapDances.map((entry) => ({
      id: entry.id,
      // An imported dance is named by its slot ("Tap dance 0"); what it does says more, as its card's title does (D-276).
      name: /^(tap ?dance|td)\s*\d+$/i.test(entry.name.trim()) ? cardTitle({ kind: "tapDance", tapDanceId: entry.id }, layout) : entry.name,
      detail: tapDanceSlots(entry).map(([name]) => ({ tap: "tap", hold: "hold", doubleTap: "double-tap", tapThenHold: "tap, then hold" })[name]).join(", "),
      uses: usesOf(layout, (b) => b.kind === "tapDance" && b.tapDanceId === entry.id),
    })),
    profiles: layout.holdTapProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      detail: "How long a key waits before it counts as held",
      uses: usesOf(layout, (b) => b.kind === "holdTap" && b.profileId === profile.id),
    })),
  };
}

/** The positions of `uses` that are on `layerId`, which the board highlights. */
export const positionsOn = (uses: readonly LibraryUse[], layerId: string): number[] =>
  uses.flatMap((use) => (use.slot !== undefined && use.slot.layerId === layerId ? [use.slot.position] : []));
