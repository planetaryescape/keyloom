// Tuning a hold-tap's feel from the editor (D-017): the fields each firmware exposes, and the ops
// that turn what was typed into a profile change. Pure, so the rules are tested without a browser.
import type { ChangeOp, Slot } from "../../layout/change.ts";
import { optionLabel } from "../../layout/option-words.ts";
import { KANATA_VARIANTS } from "../../layout/kanata/profiles.ts";
import type { Binding, Firmware, HoldTapProfile, Layout } from "../../layout/schema.ts";
import { keyIn, keyOn } from "../../validation/words.ts";

export type HoldTap = Extract<Binding, { kind: "holdTap" }>;

export type OptionSpec =
  | { key: string; label: string; kind: "number"; unit: string; hint: string }
  | { key: string; label: string; kind: "flag"; hint: string }
  | { key: string; label: string; kind: "choice"; choices: readonly string[]; hint: string };

// The options each firmware takes per profile (05, 06). Anything else a profile holds is carried through untouched.
export const OPTIONS: Record<Firmware, readonly OptionSpec[]> = {
  kanata: [
    { key: "variant", label: "When another key decides it", kind: "choice", choices: KANATA_VARIANTS, hint: "tap-hold-release holds when another key is pressed and released, tap-hold-press when it is pressed, tap-hold-tap-keys only after the time (a roll stays a tap), and the opposite-hand ones only for a key on the other hand." },
    { key: "hold-ms", label: "Hold time", kind: "number", unit: "ms", hint: "How long a hold takes. Lower is quicker to trigger the hold, and easier to trigger it by accident." },
    { key: "tap-repress-ms", label: "Repeat window", kind: "number", unit: "ms", hint: "A tap this soon after another press of the key repeats the letter instead of holding." },
    { key: "require-prior-idle-ms", label: "Quiet time before a hold", kind: "number", unit: "ms", hint: "A key pressed within this time after typing is always a tap, so fast typing never triggers a modifier." },
  ],
  qmk: [
    { key: "TAPPING_TERM", label: optionLabel("TAPPING_TERM"), kind: "number", unit: "ms", hint: "How long a hold takes. Lower is quicker to trigger the hold, and easier to trigger it by accident." },
    { key: "QUICK_TAP_TERM", label: optionLabel("QUICK_TAP_TERM"), kind: "number", unit: "ms", hint: "A tap this soon after another press of the key repeats the letter instead of holding." },
    { key: "PERMISSIVE_HOLD", label: optionLabel("PERMISSIVE_HOLD"), kind: "flag", hint: "Pressing another key and releasing it while this one is down counts as a hold." },
    { key: "HOLD_ON_OTHER_KEY_PRESS", label: optionLabel("HOLD_ON_OTHER_KEY_PRESS"), kind: "flag", hint: "Pressing another key while this one is down counts as a hold at once." },
  ],
  zmk: [
    { key: "flavor", label: optionLabel("flavor"), kind: "choice", choices: ["hold-preferred", "balanced", "tap-preferred", "tap-unless-interrupted"], hint: "When another key press decides tap or hold." },
    { key: "tapping-term-ms", label: optionLabel("tapping-term-ms"), kind: "number", unit: "ms", hint: "How long a hold takes. Lower is quicker to trigger the hold, and easier to trigger it by accident." },
    { key: "quick-tap-ms", label: optionLabel("quick-tap-ms"), kind: "number", unit: "ms", hint: "A tap this soon after another press of the key repeats the letter instead of holding." },
    { key: "require-prior-idle-ms", label: optionLabel("require-prior-idle-ms"), kind: "number", unit: "ms", hint: "A key pressed within this time after typing is always a tap, so fast typing never triggers a modifier." },
  ],
};

/** Text for numbers and choices (empty means unset), and a boolean for flags. */
export type Values = Record<string, string | boolean>;

const isOn = (v: unknown) => v !== undefined && v !== false && v !== 0 && v !== "0" && v !== "";

/** What each field shows now: the profile's own value, or for a QMK flag the layout-wide setting it falls back to. */
export function valuesFromProfile(profile: HoldTapProfile, layout: Layout): Values {
  const out: Values = {};
  for (const spec of OPTIONS[profile.firmware]) {
    const own = profile.options[spec.key];
    if (spec.kind === "flag") {
      out[spec.key] = own === undefined ? isOn(layout.settings.find((s) => s.firmware === "qmk" && s.key === spec.key)?.value) : isOn(own);
    } else {
      out[spec.key] = own === undefined ? "" : String(own);
    }
  }
  return out;
}

export type Built = { ok: true; options: HoldTapProfile["options"] } | { ok: false; problem: string };

/** The profile's options with the form's values applied. A number field left empty removes the option. */
export function optionsFromValues(profile: HoldTapProfile, values: Values, layout: Layout): Built {
  const options: HoldTapProfile["options"] = { ...profile.options };
  const shown = valuesFromProfile(profile, layout);
  for (const spec of OPTIONS[profile.firmware]) {
    const value = values[spec.key];
    if (spec.kind === "flag") {
      // An untouched flag stays as it was, so a profile that falls back to the layout-wide setting keeps doing so.
      if (value !== shown[spec.key]) options[spec.key] = value === true;
    } else if (value === "" || value === undefined) {
      delete options[spec.key];
    } else if (spec.kind === "number") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return { ok: false, problem: `${spec.label} must be a whole number of milliseconds.` };
      options[spec.key] = n;
    } else {
      options[spec.key] = String(value);
    }
  }
  return { ok: true, options };
}

export function usersOf(layout: Layout, profileId: string): Slot[] {
  return layout.layers.flatMap((layer) =>
    layer.bindings.flatMap((b, position) => (b.kind === "holdTap" && b.profileId === profileId ? [{ layerId: layer.id, position }] : [])),
  );
}

/** A profile id for one key that nothing else uses yet: `home-row-mods-key-33`, then `-2`, and so on. */
export function ownProfileId(layout: Layout, profileId: string, position: number): string {
  const taken = new Set(layout.holdTapProfiles.map((p) => p.id));
  const base = `${profileId.replace(/-key-\d+(-\d+)?$/, "")}-key-${position + 1}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export type Scope = "profile" | "key";

/**
 * The change for the typed values, or null when nothing differs. "profile" edits the shared profile
 * for every key that uses it; "key" gives this key a profile of its own with the new feel and leaves
 * the others as they were.
 */
export function tuningOps(input: {
  layout: Layout; slot: Slot; binding: HoldTap; profile: HoldTapProfile; options: HoldTapProfile["options"]; scope: Scope;
}): ChangeOp[] | null {
  const { layout, slot, binding, profile, options, scope } = input;
  if (JSON.stringify(sortKeys(options)) === JSON.stringify(sortKeys(profile.options))) return null;
  if (scope === "profile") return [{ op: "upsertHoldTapProfile", profile: { ...profile, options } }];
  const id = ownProfileId(layout, profile.id, slot.position);
  return [
    { op: "upsertHoldTapProfile", profile: { id, name: `${profile.name} (${keyIn(layout, slot).replace(/^the /, "")})`, firmware: profile.firmware, options } },
    { op: "setBinding", at: slot, binding: { ...binding, profileId: id } },
  ];
}

const sortKeys = (o: HoldTapProfile["options"]) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** A line for the revision history: "Layer 0, key 33: tapping term 170 ms". */
export function tuningSummary(layout: Layout, slot: Slot, profile: HoldTapProfile, options: HoldTapProfile["options"], scope: Scope): string {
  const layer = layout.layers.find((l) => l.id === slot.layerId)?.name ?? slot.layerId;
  const changes = OPTIONS[profile.firmware].flatMap((spec) =>
    JSON.stringify(profile.options[spec.key]) === JSON.stringify(options[spec.key])
      ? []
      : [`${spec.label.toLowerCase()} ${options[spec.key] === undefined ? "reset" : spec.kind === "number" ? `${String(options[spec.key])} ms` : String(options[spec.key])}`],
  );
  const what = changes.length === 0 ? "hold-tap feel" : changes.join(", ");
  return scope === "key" ? `${keyOn(layout, slot)}: ${what}` : `${profile.name}: ${what}`;
}
