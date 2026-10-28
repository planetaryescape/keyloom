// The change set for edits on the settings page (D-191). One option can need more than one op: a hold-tap profile that
// copied the option from the layout-wide setting would otherwise keep the old value and QMK would emit a per-key callback
// that undoes the edit on exactly the keys the person meant to change.
import type { ChangeOp } from "./change.ts";
import { type OptionBoard, type OptionSpec, baselineOf, currentValue, forcedOn, isSet } from "./firmware-options.ts";
import type { HoldTapProfile, Layout } from "./schema.ts";

/** The options a hold-tap profile can carry a copy of (src/firmware/qmk/config-h.ts TAP_HOLD_KEYS, the ones the page offers). */
const MIRRORED = new Set(["TAPPING_TERM", "PERMISSIVE_HOLD", "HOLD_ON_OTHER_KEY_PRESS", "CHORDAL_HOLD", "RETRO_TAPPING"]);

export type SettingEdit = { spec: OptionSpec; value: number | boolean };

export type SettingsChange = {
  ops: ChangeOp[];
  summary: string;
  /** Profiles that keep their own value for an option the person changed, for the page to say so. */
  keptOwn: Array<{ profile: string; label: string }>;
};

const valueWords = (spec: OptionSpec, value: number | boolean): string =>
  spec.kind === "flag" ? (value === true ? "on" : "off") : value === 0 && spec.zero !== undefined ? spec.zero.toLowerCase() : `${value}${spec.unit === "" ? "" : ` ${spec.unit}`}`;

/** Edits that change nothing (the value shown is already the one in force) are dropped; no edits at all gives null. */
export function settingsChange(layout: Layout, board: Pick<OptionBoard, "settingDefaults">, edits: readonly SettingEdit[]): SettingsChange | null {
  const ops: ChangeOp[] = [];
  const words: string[] = [];
  const keptOwn: SettingsChange["keptOwn"] = [];
  const profiles = new Map<string, HoldTapProfile>();

  for (const { spec, value } of edits) {
    // A forced setting takes no edit: the firmware gets the forced value whatever is stored, so an op would say off and do on.
    if (value === currentValue(spec, layout, board) || forcedOn(spec, layout) !== null) continue;
    const backToBaseline = value === baselineOf(spec, layout, board);
    const previous = layout.settings.find((s) => s.firmware === spec.firmware && s.key === spec.key)?.value;
    if (backToBaseline) {
      if (isSet(spec, layout)) ops.push({ op: "removeFirmwareSetting", firmware: spec.firmware, key: spec.key });
    } else {
      ops.push({ op: "setFirmwareSetting", setting: { firmware: spec.firmware, key: spec.key, value } });
    }
    words.push(`${spec.label} ${valueWords(spec, value)}`);

    if (spec.firmware !== "qmk" || !MIRRORED.has(spec.key)) continue;
    for (const original of layout.holdTapProfiles) {
      if (original.firmware !== "qmk") continue;
      const own = (profiles.get(original.id) ?? original).options[spec.key];
      if (own === undefined) continue;
      // A copy of the old layout-wide value follows the edit; a different value is the profile's own choice and stays.
      if (previous !== undefined && own === previous) {
        const options = { ...(profiles.get(original.id) ?? original).options };
        if (backToBaseline) delete options[spec.key];
        else options[spec.key] = value;
        profiles.set(original.id, { ...original, options });
      } else keptOwn.push({ profile: original.name, label: spec.label });
    }
  }
  if (words.length === 0) return null;
  for (const profile of profiles.values()) ops.push({ op: "upsertHoldTapProfile", profile });
  return { ops, summary: `Settings: ${words.join(", ")}`, keptOwn };
}
