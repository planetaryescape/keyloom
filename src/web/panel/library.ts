// What the layout's library lists (16#the-library-lists-what-keys-share-and-is-never-a-required-step): macros, tap dances and
// timing profiles, each with where it is used. Nothing has to be made here; it is for seeing what is shared and reusing it. Pure.
import type { Slot } from "../../layout/change.ts";
import { tapDanceSlots } from "../../layout/functions.ts";
import type { Layout } from "../../layout/schema.ts";
import { keyName } from "../editor/lost-functions.ts";

export type LibraryUse = { label: string; slot?: Slot };
export type LibraryItem = { id: string; name: string; detail: string; uses: LibraryUse[] };
export type Library = { macros: LibraryItem[]; tapDances: LibraryItem[]; profiles: LibraryItem[] };

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every key and combo for which `match` holds, named the way the editor names them. */
function usesOf(layout: Layout, match: (binding: Layout["layers"][number]["bindings"][number]) => boolean): LibraryUse[] {
  const keys = layout.layers.flatMap((layer) =>
    layer.bindings.flatMap((binding, position): LibraryUse[] => (match(binding) ? [{ label: keyName(layout, { layerId: layer.id, position }), slot: { layerId: layer.id, position } }] : [])),
  );
  const combos = layout.combos.filter((combo) => match(combo.output)).map((combo): LibraryUse => ({ label: `Combo ${combo.name}` }));
  return [...keys, ...combos];
}

export function libraryOf(layout: Layout): Library {
  const dance = (id: string) => layout.tapDances.find((candidate) => candidate.id === id);
  return {
    macros: layout.macros.map((macro) => ({
      id: macro.id,
      name: macro.name,
      detail: count(macro.steps.length, "step"),
      uses: usesOf(layout, (b) => {
        if (b.kind === "macro") return b.macroId === macro.id;
        const entry = b.kind === "tapDance" ? dance(b.tapDanceId) : undefined;
        return entry !== undefined && tapDanceSlots(entry).some(([, action]) => action.kind === "macro" && action.macroId === macro.id);
      }),
    })),
    tapDances: layout.tapDances.map((entry) => ({
      id: entry.id,
      name: entry.name,
      detail: tapDanceSlots(entry).map(([name]) => ({ tap: "tap", hold: "hold", doubleTap: "double-tap", tapThenHold: "tap, then hold" })[name]).join(", "),
      uses: usesOf(layout, (b) => b.kind === "tapDance" && b.tapDanceId === entry.id),
    })),
    profiles: layout.holdTapProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      detail: profile.firmware.toUpperCase(),
      uses: usesOf(layout, (b) => b.kind === "holdTap" && b.profileId === profile.id),
    })),
  };
}

/** The positions of `uses` that are on `layerId`, which the board highlights. */
export const positionsOn = (uses: readonly LibraryUse[], layerId: string): number[] =>
  uses.flatMap((use) => (use.slot !== undefined && use.slot.layerId === layerId ? [use.slot.position] : []));
