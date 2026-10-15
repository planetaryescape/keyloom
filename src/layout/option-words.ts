// Hold-tap timing options in the words the tuner uses ("Permissive hold"), so a firmware name such as
// CHORDAL_HOLD or tapping-term-ms never reaches a chip, a card or the key panel (18#words, D-101).
// The tuner's form (web/editor/tuning.ts) takes its labels from here, so the two cannot drift.
import type { HoldTapProfile } from "./schema.ts";

type OptionValue = HoldTapProfile["options"][string];

const LABELS: Readonly<Record<string, string>> = {
  TAPPING_TERM: "Tapping term",
  QUICK_TAP_TERM: "Quick tap term",
  PERMISSIVE_HOLD: "Permissive hold",
  HOLD_ON_OTHER_KEY_PRESS: "Hold on other key press",
  CHORDAL_HOLD: "Chordal hold",
  "tapping-term-ms": "Tapping term",
  "quick-tap-ms": "Quick tap",
  "require-prior-idle-ms": "Require prior idle",
  flavor: "Flavor",
  "retro-tap": "Retro tap",
  "hold-trigger-on-release": "Hold trigger on release",
  "hold-trigger-key-positions": "Hold trigger keys",
};

/** The plain name of an option; an option keyloom has no name for is spelled out from its key. */
export function optionLabel(key: string): string {
  const known = LABELS[key];
  if (known !== undefined) return known;
  const words = key.replace(/-ms$/, "").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const isMs = (key: string) => key.endsWith("-ms") || key.endsWith("_TERM");

/** "Tapping term 200 ms", "Permissive hold", "Chordal hold off", "Flavor balanced". */
export function optionWords(key: string, value: OptionValue): string {
  const label = optionLabel(key);
  if (typeof value === "boolean") return value ? label : `${label} off`;
  if (Array.isArray(value)) return `${label} ${value.length} ${value.length === 1 ? "key" : "keys"}`;
  if (typeof value === "number") return isMs(key) ? `${label} ${value} ms` : `${label} ${value}`;
  return `${label} ${value}`;
}

/** Every option of a profile as plain phrases, in a steady order. */
export function profileWords(profile: Pick<HoldTapProfile, "options">): string[] {
  return Object.entries(profile.options)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => optionWords(key, value));
}

/**
 * What sets each profile apart from the others: the phrases not every profile shares. Profiles that
 * differ in nothing get an empty list, and the card says what the profile is for instead.
 */
export function distinguishingWords(profiles: readonly Pick<HoldTapProfile, "id" | "options">[]): Map<string, string[]> {
  const all = profiles.map((profile) => new Set(profileWords(profile)));
  const shared = profiles.length < 2 ? new Set<string>() : new Set([...(all[0] ?? [])].filter((word) => all.every((words) => words.has(word))));
  return new Map(profiles.map((profile, index) => [profile.id, [...(all[index] ?? [])].filter((word) => !shared.has(word))]));
}
