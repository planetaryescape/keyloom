// config.h: `#define KEY [value]` lines become FirmwareSettings (05).
import type { FirmwareSetting } from "../../layout/schema.ts";

/** `raw` is the line as written, for Passthrough. */
export type Define = { name: string; value: string; raw: string };

// Removes line and block comments that sit outside string literals ("http://x" keeps its slashes).
function stripComments(line: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (inString) {
      out += ch;
      if (ch === "\\") out += line[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && line[i + 1] === "/") {
      break;
    } else if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Object-like `#define`s. Backslash continuations are joined; function-like macros are returned in `functionLike`. */
export function parseDefines(text: string): { defines: Define[]; functionLike: Array<{ name: string; source: string }>; hasConditionals: boolean } {
  const defines: Define[] = [];
  const functionLike: Array<{ name: string; source: string }> = [];
  let hasConditionals = false;
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  for (const raw of lines) {
    const line = stripComments(raw).trim();
    if (/^#\s*(if|ifdef|ifndef|elif|else)\b/.test(line)) hasConditionals = true;
    const fn = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\(/.exec(line);
    if (fn?.[1]) {
      functionLike.push({ name: fn[1], source: raw.trim() });
      continue;
    }
    const m = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/.exec(line);
    if (m?.[1]) defines.push({ name: m[1], value: (m[2] ?? "").trim(), raw: raw.trim() });
  }
  return { defines, functionLike, hasConditionals };
}

function settingValue(raw: string): FirmwareSetting["value"] {
  if (raw === "") return true;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^0[xX][0-9a-fA-F]+$/.test(raw)) return Number.parseInt(raw, 16);
  if (raw === "true" || raw === "false") return raw === "true";
  // Anything else stays C source text, quotes included, so the generator can write it back as it was.
  return raw;
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
