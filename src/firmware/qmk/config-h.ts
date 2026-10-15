// config.h: `#define KEY [value]` lines become FirmwareSettings (05).
import type { FirmwareSetting } from "../../layout/schema.ts";

export type Define = { name: string; value: string };

/** Object-like `#define`s. Backslash continuations are joined; function-like macros are returned in `functionLike`. */
export function parseDefines(text: string): { defines: Define[]; functionLike: Array<{ name: string; source: string }>; hasConditionals: boolean } {
  const defines: Define[] = [];
  const functionLike: Array<{ name: string; source: string }> = [];
  let hasConditionals = false;
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").trim();
    if (/^#\s*(if|ifdef|ifndef|elif|else)\b/.test(line)) hasConditionals = true;
    const fn = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\(/.exec(line);
    if (fn?.[1]) {
      functionLike.push({ name: fn[1], source: raw.trim() });
      continue;
    }
    const m = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/.exec(line);
    if (m?.[1]) defines.push({ name: m[1], value: (m[2] ?? "").trim() });
  }
  return { defines, functionLike, hasConditionals };
}

function settingValue(raw: string): FirmwareSetting["value"] {
  if (raw === "") return true;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^0[xX][0-9a-fA-F]+$/.test(raw)) return Number.parseInt(raw, 16);
  if (raw === "true" || raw === "false") return raw === "true";
  const quoted = /^"(.*)"$/.exec(raw);
  return quoted?.[1] !== undefined ? quoted[1] : raw;
}

/** Defines that the generator derives from the layout, so importing them as settings would let them go stale. */
const DERIVED = new Set(["COMBO_COUNT"]);
/** Kept verbatim as Passthrough instead (05, S3). */
export const PASSTHROUGH_DEFINES = new Set(["SERIAL_NUMBER"]);

export function settingsFrom(defines: readonly Define[]): FirmwareSetting[] {
  const seen = new Set<string>();
  const out: FirmwareSetting[] = [];
  for (const d of defines) {
    if (DERIVED.has(d.name) || PASSTHROUGH_DEFINES.has(d.name)) continue;
    if (seen.has(d.name)) out.splice(out.findIndex((s) => s.key === d.name), 1); // a later #define wins
    seen.add(d.name);
    out.push({ firmware: "qmk", key: d.name, value: settingValue(d.value) });
  }
  return out;
}

/** The tap-hold options a HoldTapProfile mirrors from config.h. */
const TAP_HOLD_KEYS = new Set([
  "TAPPING_TERM", "TAPPING_TERM_PER_KEY", "PERMISSIVE_HOLD", "PERMISSIVE_HOLD_PER_KEY", "CHORDAL_HOLD", "FLOW_TAP_TERM",
  "QUICK_TAP_TERM", "QUICK_TAP_TERM_PER_KEY", "HOLD_ON_OTHER_KEY_PRESS", "HOLD_ON_OTHER_KEY_PRESS_PER_KEY", "RETRO_TAPPING",
  "RETRO_TAPPING_PER_KEY", "TAPPING_FORCE_HOLD", "IGNORE_MOD_TAP_INTERRUPT",
]);

export function tapHoldOptions(settings: readonly FirmwareSetting[]): Record<string, number | boolean | string> {
  const options: Record<string, number | boolean | string> = {};
  for (const s of settings) if (TAP_HOLD_KEYS.has(s.key)) options[s.key] = s.value;
  return options;
}
