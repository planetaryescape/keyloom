// What the key panel's one picker lists for a slot and a tab or a search (16: one picker for every
// slot, D-087). Pure, so the choice of tabs and matches is tested without a browser.
import type { Firmware, Layout, Mod } from "../../layout/schema.ts";
import { keptDefinitions } from "../../layout/kept-behaviours.ts";
import { writeOneShot } from "../../layout/one-shot-mods.ts";
import { modWords } from "../card/card-words.ts";
import { firmwareName, searchKeys, type PickerGroup } from "../editor/keysearch.ts";
import type { LayerAction } from "../editor/draft.ts";
import { modOfKey, type TapPick } from "./slots.ts";

export type PickerTab = "letters" | "punctuation" | "modifiers" | "layers" | "navigation" | "media" | "function" | "macro" | "dance" | "other" | "any";
/** "doubleTap" and "tapThenHold" are the tap dance's extra slots (16); they take what a tap takes, bar the empty keys and Any. */
export type SlotName = "tap" | "hold" | "doubleTap" | "tapThenHold";

export const isExtraSlot = (slot: SlotName): boolean => slot === "doubleTap" || slot === "tapThenHold";

export const TAB_TITLE: Readonly<Record<PickerTab, string>> = {
  letters: "Letters",
  punctuation: "Punctuation",
  modifiers: "Modifiers",
  layers: "Layers",
  navigation: "Navigation",
  media: "Media",
  function: "Function",
  macro: "Macros",
  dance: "Tap dances",
  other: "More",
  any: "Any",
};

/** The tabs a slot offers. A hold is a modifier or a layer; the tap of a hold-tap is a key; a free tap is anything. */
export function tabsFor(slot: SlotName, keysOnly: boolean): PickerTab[] {
  if (slot === "hold") return ["modifiers", "layers"];
  const keys: PickerTab[] = ["letters", "punctuation", "modifiers", "navigation", "media", "function", "macro", "other"];
  if (keysOnly) return keys;
  // A dance can't be a slot of another dance, and Any reads a whole binding.
  if (isExtraSlot(slot)) return ["letters", "punctuation", "modifiers", "layers", "navigation", "media", "function", "macro", "other"];
  return ["letters", "punctuation", "modifiers", "layers", "navigation", "media", "function", "macro", "dance", "other", "any"];
}

/** The tab a slot opens on: a hold opens on Modifiers, the tap on the first. */
export const openingTab = (slot: SlotName, current: PickerTab | null): PickerTab => current ?? (slot === "hold" ? "modifiers" : "letters");

const TAB_OF_GROUP: Readonly<Record<PickerGroup["id"], PickerTab>> = {
  letter: "letters",
  number: "letters",
  punctuation: "punctuation",
  modifier: "modifiers",
  navigation: "navigation",
  control: "navigation",
  media: "media",
  system: "media",
  fkeys: "function",
  function: "function",
  keypad: "other",
  international: "other",
  other: "other",
};

export type PickerItem = {
  id: string;
  /** The plain name on the tile. */
  label: string;
  /** The firmware's name for it; shown only in the Advanced view. */
  code?: string;
  /** One line under the label, such as "3 steps". */
  detail?: string;
  pick: TapPick;
  disabled?: boolean;
};

export type PickerSection = { id: string; title: string; items: PickerItem[] };

export interface PickerQuery {
  hasExtraSlots?: boolean;
  text: string;
  tab: PickerTab;
  slot: SlotName;
  keysOnly: boolean;
  layout: Layout;
  firmware: Firmware;
  /** The layer being edited; a hold can't usefully point at it. */
  layerId: string;
  layerAction: LayerAction;
}

const norm = (text: string) => text.toLowerCase().trim();

function keyItems(query: PickerQuery, text: string): PickerSection[] {
  const groups = searchKeys({ text, firmware: query.firmware, qmkBasicOnly: query.keysOnly });
  return groups
    .filter((group) => (query.slot === "hold" ? group.id === "modifier" : text !== "" || TAB_OF_GROUP[group.id] === query.tab))
    .map((group) => ({
      id: group.id,
      title: group.title,
      items: group.keys
        // A hold takes modifiers, so a hold's keys are the eight modifier keys.
        .filter((key) => query.slot !== "hold" || modOfKey(key.name) !== undefined)
        .map((key) => ({ id: `key-${key.name}`, label: key.label, code: firmwareName(key, query.firmware), pick: { t: "key" as const, code: key.name } })),
    }))
    .filter((section) => section.items.length > 0);
}

function layerSection(query: PickerQuery, text: string): PickerSection[] {
  const items = query.layout.layers
    .map((layer) => ({ layer }))
    .filter(({ layer }) => text === "" || norm(layer.name).includes(text) || "layer".includes(text))
    .map(({ layer }): PickerItem => {
      // Holding a key for its own layer would switch to the layer it is already on, so the tile is off and says why (R8-14).
      const own = query.slot === "hold" && layer.id === query.layerId;
      return { id: `layer-${layer.id}`, label: layer.name, pick: { t: "layer", action: query.layerAction, layerId: layer.id }, disabled: own, ...(own ? { detail: "This key's own layer" } : {}) };
    });
  return items.length === 0 ? [] : [{ id: "layers", title: "Layers", items }];
}

function macroSection(query: PickerQuery, text: string): PickerSection[] {
  const items = query.layout.macros
    .filter((macro) => text === "" || norm(macro.name).includes(text) || "macro".includes(text))
    .map((macro): PickerItem => ({
      id: `macro-${macro.id}`,
      label: macro.name,
      detail: `${macro.steps.length} ${macro.steps.length === 1 ? "step" : "steps"}`,
      pick: { t: "macro", macroId: macro.id },
    }));
  return items.length === 0 ? [] : [{ id: "macros", title: "Macros", items }];
}

function danceSection(query: PickerQuery, text: string): PickerSection[] {
  const items = query.layout.tapDances
    .filter((dance) => text === "" || norm(dance.name).includes(text) || "tap dance".includes(text) || "double".includes(text))
    .map((dance): PickerItem => {
      const slots = [dance.hold ? "hold" : "", dance.doubleTap ? "double-tap" : "", dance.tapThenHold ? "tap, then hold" : ""].filter((word) => word !== "");
      return { id: `dance-${dance.id}`, label: dance.name, ...(slots.length ? { detail: slots.join(", ") } : {}), pick: { t: "dance", danceId: dance.id } };
    });
  return items.length === 0 ? [] : [{ id: "dances", title: "Tap dances", items }];
}

// The modifiers a key can hold for the next key only (D-568), in the order the hold's own groups list them.
const ONE_SHOT_MODS: readonly Mod[][] = [["LCTL"], ["LALT"], ["LSFT"], ["LGUI"], ["LCTL", "LSFT", "LALT", "LGUI"], ["LCTL", "LSFT", "LALT"]];
const ONE_SHOT_WORDS: readonly string[] = ["one-shot", "one shot", "oneshot", "sticky", "once", "next key"];

/** The picker's id for a one-shot of `mods`, so the card can mark the one the key holds. */
export const oneShotItemId = (mods: readonly Mod[]): string => `oneshot-${mods.join("-")}`;

/** One-shot modifiers, on the tap slot of a key with no hold, and only those the layout's firmware can write. */
function oneShotSection(query: PickerQuery, text: string): PickerSection[] {
  if (query.slot !== "tap" || query.keysOnly || query.hasExtraSlots) return [];
  const kept = keptDefinitions(query.layout.passthrough);
  const items = ONE_SHOT_MODS.flatMap((mods): PickerItem[] => {
    const written = writeOneShot(mods, query.firmware, kept);
    if ("why" in written) return [];
    return [{ id: oneShotItemId(mods), label: `One-shot ${modWords(mods)}`, detail: "For the next key only", code: written.binding.source, pick: { t: "oneShot", mods } }];
  })
    // Every word typed is in the name or the one-shot words, so "sticky shift" finds Shift alone.
    .filter((item) => text === "" || text.split(/\s+/).every((word) => `${norm(item.label)} ${ONE_SHOT_WORDS.join(" ")}`.includes(word)));
  return items.length === 0 ? [] : [{ id: "oneShot", title: "For the next key only", items }];
}

const SPECIAL: readonly { words: readonly string[]; item: PickerItem }[] = [
  { words: ["transparent", "trans", "fall through", "blank"], item: { id: "special-transparent", label: "Transparent", detail: "Use the layer below", pick: { t: "transparent" } } },
  { words: ["none", "nothing", "disabled", "off"], item: { id: "special-none", label: "Nothing", detail: "Does nothing", pick: { t: "none" } } },
];

function specialSection(text: string): PickerSection[] {
  const items = SPECIAL.filter(({ words }) => text === "" || words.some((word) => word.includes(text))).map(({ item }) => item);
  return items.length === 0 ? [] : [{ id: "special", title: "Empty keys", items }];
}

/**
 * The sections to draw. With a search the whole slot is searched, across tabs; without one, only
 * the tab's own. The Any tab has no list: it has its own field.
 */
export function pickerSections(query: PickerQuery): PickerSection[] {
  const text = norm(query.text);
  const searching = text !== "";
  const allowed = new Set(tabsFor(query.slot, query.keysOnly));
  if (!searching && query.tab === "any") return [];
  const sections: PickerSection[] = [];
  if (searching || query.tab === "layers") sections.push(...(allowed.has("layers") ? layerSection(query, text) : []));
  if (searching || query.tab === "macro") sections.push(...(allowed.has("macro") ? macroSection(query, text) : []));
  if (searching || query.tab === "dance") sections.push(...(allowed.has("dance") ? danceSection(query, text) : []));
  if (searching || query.tab === "other") sections.push(...(query.slot === "tap" && !query.keysOnly ? specialSection(text) : []));
  if (searching || !["layers", "macro", "dance"].includes(query.tab)) sections.push(...keyItems(query, text));
  if (searching || query.tab === "modifiers") sections.push(...oneShotSection(query, text));
  // A search lists keys first: the best match leads, so Enter after typing takes it.
  const after = ["layers", "macros", "dances", "special", "oneShot"];
  return searching ? [...sections.filter((s) => !after.includes(s.id)), ...sections.filter((s) => after.includes(s.id))] : sections;
}
