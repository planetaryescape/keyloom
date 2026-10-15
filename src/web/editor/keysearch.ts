// Search and grouping for the key picker. The table has no free-text descriptions, so a key is
// found by its name in words, its label, every QMK and ZMK alias, and the name of its group.
import { KEYCODES, type KeyCodeCategory, type KeyCodeInfo } from "../../layout/keycodes.ts";
import type { Firmware } from "../../layout/schema.ts";

export type PickerGroup = { id: KeyCodeCategory | "fkeys"; title: string; keys: KeyCodeInfo[] };

// The order people look for things in; "function" is split out of the table's category so the
// F-keys read as F-keys.
const GROUPS: readonly { id: PickerGroup["id"]; title: string }[] = [
  { id: "letter", title: "Letters" },
  { id: "number", title: "Numbers" },
  { id: "fkeys", title: "F-keys" },
  { id: "navigation", title: "Navigation" },
  { id: "control", title: "Editing and control" },
  { id: "punctuation", title: "Symbols" },
  { id: "media", title: "Media" },
  { id: "modifier", title: "Modifier keys" },
  { id: "keypad", title: "Keypad" },
  { id: "international", title: "International" },
  { id: "system", title: "System" },
  { id: "other", title: "Other" },
];

const groupOf = (key: KeyCodeInfo): PickerGroup["id"] => (key.category === "function" ? "fkeys" : key.category);

/** The name to show for a key in the layout's own firmware, such as KC_ENTER or RETURN. */
export function firmwareName(key: KeyCodeInfo, firmware: Firmware): string {
  return (firmware === "qmk" ? key.qmk[0] : key.zmk[0]) ?? key.name;
}

function fields(key: KeyCodeInfo): string[] {
  const group = GROUPS.find((candidate) => candidate.id === groupOf(key))?.title ?? "";
  return [
    key.label.toLowerCase(),
    key.name.toLowerCase().replaceAll("_", " "),
    ...key.qmk.map((name) => name.toLowerCase()),
    ...key.zmk.map((name) => name.toLowerCase()),
    group.toLowerCase(),
  ];
}

// Lower is better: an exact label first, then a prefix of any field, then any substring.
function tokenScore(key: KeyCodeInfo, token: string): number | null {
  let best: number | null = null;
  for (const [index, field] of fields(key).entries()) {
    const bare = field.replace(/^kc_/, "");
    const score =
      field === token || bare === token
        ? index === 0 ? 0 : 1
        : field.startsWith(token) || bare.startsWith(token) || field.includes(` ${token}`)
          ? 2
          : field.includes(token)
            ? 3
            : null;
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

export type PickerQuery = { text: string; firmware: Firmware; qmkBasicOnly?: boolean };

/** Matching keys in display groups. With a query, keys are ranked and the best group comes first. */
export function searchKeys({ text, firmware, qmkBasicOnly = false }: PickerQuery): PickerGroup[] {
  const tokens = text.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
  const scored: { key: KeyCodeInfo; score: number; order: number }[] = [];
  for (const [order, key] of KEYCODES.entries()) {
    // A QMK mod-tap can only tap an 8-bit keycode (the table's qmkBasic flag).
    if (qmkBasicOnly && firmware === "qmk" && !key.qmkBasic) continue;
    let total = 0;
    let matched = true;
    for (const token of tokens) {
      const score = tokenScore(key, token);
      if (score === null) {
        matched = false;
        break;
      }
      total += score;
    }
    if (matched) scored.push({ key, score: total, order });
  }
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  const groups: (PickerGroup & { best: number })[] = [];
  for (const entry of scored) {
    const id = groupOf(entry.key);
    let group = groups.find((candidate) => candidate.id === id);
    if (group === undefined) {
      group = { id, title: GROUPS.find((candidate) => candidate.id === id)?.title ?? id, keys: [], best: entry.score };
      groups.push(group);
    }
    group.keys.push(entry.key);
  }
  if (tokens.length === 0) {
    return GROUPS.flatMap(({ id }) => groups.filter((group) => group.id === id)).map(({ best: _, ...group }) => group);
  }
  // Groups ordered by their best match, ties by the fixed order above.
  const rank = (id: PickerGroup["id"]) => GROUPS.findIndex((group) => group.id === id);
  return groups
    .sort((a, b) => a.best - b.best || rank(a.id) - rank(b.id))
    .map(({ best: _, ...group }) => group);
}
