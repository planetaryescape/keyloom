// Hold-tap profiles on kanata (21). A kanata profile names one of kanata's tap-hold variants and its timings. Profiles
// that came from a QMK or ZMK board are translated by `translateHoldTapProfile`; the table below is the whole mapping,
// with where each row comes from. Nothing is dropped silently (D-024): what has no kanata equivalent comes back as a note.
//
// Sources. kanata: docs/config.adoc at jtroo/kanata@02242ef (v1.12.0), "tap-hold" and "defhands and tap-hold-opposite-hand".
// QMK/ZMK semantics: docs/research/software-remappers.md "Is kanata the closest to QMK?" and blueprint 05/06. The rows
// marked (S6) are inferences from those docs, to be confirmed by the differential tests of spike S6.
//
//   QMK                                          kanata
//   TAPPING_TERM n                               hold-ms n (default 200)
//   QUICK_TAP_TERM n                             tap-repress-ms n (QMK defaults it to TAPPING_TERM)
//   PERMISSIVE_HOLD                              tap-hold-release
//   HOLD_ON_OTHER_KEY_PRESS                      tap-hold-press (wins over PERMISSIVE_HOLD)
//   CHORDAL_HOLD                                 tap-hold-tap-keys over the key's own hand (S33: tap-hold-opposite-hand also
//                                                holds the moment an opposite-hand key goes down, which QMK does not)
//   CHORDAL_HOLD + HOLD_ON_OTHER_KEY_PRESS       tap-hold-opposite-hand (S33)
//   CHORDAL_HOLD + PERMISSIVE_HOLD               tap-hold-opposite-hand-release (S33)
//   FLOW_TAP_TERM n                              require-prior-idle-ms n
//   RETRO_TAPPING and the rest                   no equivalent: reported
//
//   ZMK flavor hold-preferred                    tap-hold-press
//   ZMK flavor balanced                          tap-hold-release
//   ZMK flavor tap-preferred                     tap-hold-tap-keys over every key: another key's press makes this a tap (S6)
//   ZMK flavor tap-unless-interrupted            tap-hold-press-timeout with the tap as the timeout action
//   tapping-term-ms / quick-tap-ms               hold-ms / tap-repress-ms
//   require-prior-idle-ms                        require-prior-idle-ms
//   hold-trigger-key-positions on the opposite hand     tap-hold-opposite-hand (-release with hold-trigger-on-release or balanced)
//   hold-trigger-key-positions anywhere else, retro-tap  no equivalent: reported
import type { FirmwareSetting, HoldTapProfile } from "../schema.ts";

export const KANATA_VARIANTS = [
  "tap-hold", "tap-hold-press", "tap-hold-release", "tap-hold-press-timeout", "tap-hold-tap-keys", "tap-hold-opposite-hand", "tap-hold-opposite-hand-release",
] as const;
export type KanataVariant = (typeof KANATA_VARIANTS)[number];

/** Which keys make a `tap-hold-tap-keys` key a tap: every key, or only the keys on its own hand. */
export type TapKeys = "all" | "same-hand";

export type KanataTapHold = { variant: KanataVariant; holdMs: number; tapRepressMs: number; requirePriorIdleMs: number | undefined; tapKeys: TapKeys };

export const isOppositeHand = (v: KanataVariant): boolean => v === "tap-hold-opposite-hand" || v === "tap-hold-opposite-hand-release";

const MS_MAX = 65535;
const isMs = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MS_MAX;

export const DEFAULT_KANATA_PROFILE: KanataTapHold = { variant: "tap-hold-release", holdMs: 200, tapRepressMs: 0, requirePriorIdleMs: undefined, tapKeys: "all" };

/** The profile's options as a spec, or what is wrong with them. */
export function readKanataProfile(profile: HoldTapProfile): { ok: true; spec: KanataTapHold } | { ok: false; problems: string[] } {
  const o = profile.options;
  const problems: string[] = [];
  const variant = o.variant ?? DEFAULT_KANATA_PROFILE.variant;
  if (typeof variant !== "string" || !(KANATA_VARIANTS as readonly string[]).includes(variant)) problems.push(`variant must be one of ${KANATA_VARIANTS.join(", ")}, not ${JSON.stringify(variant)}`);
  const num = (key: string, fallback: number | undefined): number | undefined => {
    const v = o[key];
    if (v === undefined) return fallback;
    if (!isMs(v)) {
      problems.push(`${key} must be a whole number of milliseconds from 0 to ${MS_MAX}, not ${JSON.stringify(v)}`);
      return fallback;
    }
    return v;
  };
  const holdMs = num("hold-ms", DEFAULT_KANATA_PROFILE.holdMs) as number;
  const tapRepressMs = num("tap-repress-ms", 0) as number;
  const requirePriorIdleMs = num("require-prior-idle-ms", undefined);
  const tapKeys = o["tap-keys"] ?? "all";
  if (tapKeys !== "all" && tapKeys !== "same-hand") problems.push(`tap-keys must be "all" or "same-hand", not ${JSON.stringify(tapKeys)}`);
  else if (tapKeys === "same-hand" && variant !== "tap-hold-tap-keys") problems.push(`tap-keys is only for tap-hold-tap-keys, not ${JSON.stringify(variant)}`);
  const known = new Set(["variant", "hold-ms", "tap-repress-ms", "require-prior-idle-ms", "tap-keys"]);
  for (const key of Object.keys(o)) if (!known.has(key)) problems.push(`"${key}" is not a kanata hold-tap option`);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, spec: { variant: variant as KanataVariant, holdMs, tapRepressMs, requirePriorIdleMs, tapKeys: tapKeys as TapKeys } };
}

/** `(tap-hold ...)` for one key. `tapKeys` is the defvar list of keys that make a tap-hold-tap-keys key a tap: `$all-keys` or the key's own hand. */
export function tapHoldAction(spec: KanataTapHold, tap: string, hold: string, tapKeys = "$all-keys"): string {
  const idle = spec.requirePriorIdleMs === undefined ? "" : ` (require-prior-idle ${spec.requirePriorIdleMs})`;
  switch (spec.variant) {
    case "tap-hold":
    case "tap-hold-press":
    case "tap-hold-release":
      return `(${spec.variant} ${spec.tapRepressMs} ${spec.holdMs} ${tap} ${hold}${idle})`;
    case "tap-hold-press-timeout":
      // The timeout action is the tap: a key held alone is still a tap, and only another key's press makes it a hold.
      return `(tap-hold-press-timeout ${spec.tapRepressMs} ${spec.holdMs} ${tap} ${hold} ${tap}${idle})`;
    case "tap-hold-tap-keys":
      return `(tap-hold-tap-keys ${spec.tapRepressMs} ${spec.holdMs} ${tap} ${hold} ${tapKeys}${idle})`;
    case "tap-hold-opposite-hand":
    case "tap-hold-opposite-hand-release": {
      // Held past the timeout is a hold, as on QMK and ZMK; the same hand's keys are a tap, which is what stops a roll becoming a modifier.
      const repress = spec.tapRepressMs > 0 ? ` (tap-repress-timeout ${spec.tapRepressMs})` : "";
      return `(${spec.variant} ${spec.holdMs} ${tap} ${hold} (timeout hold) (same-hand tap)${repress}${idle})`;
    }
  }
}

export type Translated = { profile: HoldTapProfile; notes: string[] };

const settingOf = (settings: readonly FirmwareSetting[], firmware: "qmk" | "zmk", key: string) => settings.find((s) => s.firmware === firmware && s.key === key)?.value;
const truthy = (v: unknown): boolean => v === true || (typeof v === "number" && v !== 0);

/**
 * A QMK or ZMK hold-tap profile as a kanata one. `handOf` says whether a ZMK `hold-trigger-key-positions` list is the
 * opposite hand's keys, which is the one list kanata can express.
 */
export function translateHoldTapProfile(
  profile: HoldTapProfile,
  settings: readonly FirmwareSetting[],
  handsOfTrigger?: (positions: number[]) => "opposite" | "other",
): Translated {
  if (profile.firmware === "kanata") return { profile, notes: [] };
  const notes: string[] = [];
  const o = profile.options;
  const out: Record<string, number | string> = {};
  let variant: KanataVariant;
  if (profile.firmware === "qmk") {
    const get = (key: string) => o[key] ?? settingOf(settings, "qmk", key);
    const term = get("TAPPING_TERM");
    const holdMs = isMs(term) ? term : 200;
    const quick = get("QUICK_TAP_TERM");
    out["hold-ms"] = holdMs;
    out["tap-repress-ms"] = isMs(quick) ? quick : holdMs;
    if (isMs(quick) && quick > 0) {
      notes.push(`${profile.name}: QUICK_TAP_TERM ${quick} ms runs from the first tap's release in QMK, but kanata's tap-repress-ms (${quick}) runs from its press, so a re-press that QMK treats as a repeat can be a hold on kanata by as much as the first tap lasted (S33)`);
    }
    const flow = get("FLOW_TAP_TERM");
    if (isMs(flow) && flow > 0) out["require-prior-idle-ms"] = flow;
    const permissive = truthy(get("PERMISSIVE_HOLD"));
    const onPress = truthy(get("HOLD_ON_OTHER_KEY_PRESS"));
    if (truthy(get("CHORDAL_HOLD"))) {
      // QMK settles on a tap when the next key is on the same hand; an opposite-hand key decides nothing by itself
      // unless HOLD_ON_OTHER_KEY_PRESS (hold at once) or PERMISSIVE_HOLD (hold on its release) says so (S33).
      variant = onPress ? "tap-hold-opposite-hand" : permissive ? "tap-hold-opposite-hand-release" : "tap-hold-tap-keys";
      if (variant === "tap-hold-tap-keys") out["tap-keys"] = "same-hand";
    } else if (onPress) variant = "tap-hold-press";
    else if (permissive) variant = "tap-hold-release";
    else variant = "tap-hold";
    if (onPress && permissive) notes.push(`${profile.name}: QMK has both HOLD_ON_OTHER_KEY_PRESS and PERMISSIVE_HOLD on; HOLD_ON_OTHER_KEY_PRESS decides, as it does in QMK`);
    for (const key of ["RETRO_TAPPING", "TAPPING_FORCE_HOLD", "IGNORE_MOD_TAP_INTERRUPT"]) {
      if (truthy(get(key))) notes.push(`${profile.name}: ${key} has no kanata equivalent and was not carried over`);
    }
  } else {
    const flavor = o.flavor;
    const term = o["tapping-term-ms"];
    out["hold-ms"] = isMs(term) ? term : 200;
    const quick = o["quick-tap-ms"];
    out["tap-repress-ms"] = isMs(quick) && quick > 0 ? quick : 0;
    const idle = o["require-prior-idle-ms"];
    if (isMs(idle) && idle > 0) out["require-prior-idle-ms"] = idle;
    const trigger = Array.isArray(o["hold-trigger-key-positions"]) ? (o["hold-trigger-key-positions"] as number[]) : undefined;
    const onRelease = truthy(o["hold-trigger-on-release"]);
    const base: KanataVariant =
      flavor === "hold-preferred" ? "tap-hold-press"
        : flavor === "tap-preferred" ? "tap-hold-tap-keys"
          : flavor === "tap-unless-interrupted" ? "tap-hold-press-timeout"
            : "tap-hold-release"; // balanced, and ZMK's own default
    variant = base;
    if (trigger !== undefined) {
      if (handsOfTrigger?.(trigger) === "opposite") variant = onRelease || flavor === "balanced" || flavor === undefined ? "tap-hold-opposite-hand-release" : "tap-hold-opposite-hand";
      else notes.push(`${profile.name}: hold-trigger-key-positions lists keys kanata can't express (only "the opposite hand's keys" can be); it was not carried over, so the hold decision follows the ${flavor ?? "balanced"} flavour alone`);
    }
    if (truthy(o["retro-tap"])) notes.push(`${profile.name}: retro-tap has no kanata equivalent and was not carried over`);
  }
  out.variant = variant;
  return { profile: { id: profile.id, name: profile.name, firmware: "kanata", options: out }, notes };
}
