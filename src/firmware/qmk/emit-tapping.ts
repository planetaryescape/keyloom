// Hold-tap profiles that differ from the layout-wide settings need QMK's per-key callbacks
// (get_tapping_term and friends). Profiles equal to the settings need nothing: config.h already
// carries them. A difference QMK can't express per key is an error, because the alternative is
// firmware that silently ignores the profile.
import type { Binding, HoldTapProfile, Layout } from "../../layout/schema.ts";
import { GenerateError } from "./generate-error.ts";

type Option = { fn: string; perKey: string; returns: "uint16_t" | "bool"; global: (v: boolean | number | string | undefined) => string };

const flag = (v: boolean | number | string | undefined): string => (v === true ? "true" : "false");

const PER_KEY: Record<string, Option> = {
  TAPPING_TERM: { fn: "get_tapping_term", perKey: "TAPPING_TERM_PER_KEY", returns: "uint16_t", global: (v) => (typeof v === "number" ? String(v) : "TAPPING_TERM") },
  QUICK_TAP_TERM: { fn: "get_quick_tap_term", perKey: "QUICK_TAP_TERM_PER_KEY", returns: "uint16_t", global: (v) => (typeof v === "number" ? String(v) : "QUICK_TAP_TERM") },
  PERMISSIVE_HOLD: { fn: "get_permissive_hold", perKey: "PERMISSIVE_HOLD_PER_KEY", returns: "bool", global: flag },
  HOLD_ON_OTHER_KEY_PRESS: { fn: "get_hold_on_other_key_press", perKey: "HOLD_ON_OTHER_KEY_PRESS_PER_KEY", returns: "bool", global: flag },
};

export type Tapping = { defines: string[]; functions: string[] };

const defines = (source: string, fn: string): boolean => new RegExp(`\\b(?:bool|uint16_t)\\s+${fn}\\s*\\(`).test(source);

export function tappingCallbacks(
  layout: Layout,
  /** The keymap expression for a binding; callbacks match keys by it. */
  exprOf: (b: Binding) => string,
  /** The keycode a tap dance has, `TD(DANCE_0)`; QMK asks get_tapping_term for it while the dance waits for another tap. */
  danceExpr: (tapDanceId: string) => string,
): Tapping {
  const profiles = new Map<string, HoldTapProfile>(layout.holdTapProfiles.filter((p) => p.firmware === "qmk").map((p) => [p.id, p]));
  const globals = new Map(layout.settings.filter((s) => s.firmware === "qmk").map((s) => [s.key, s.value]));
  const passthrough = layout.passthrough.filter((p) => p.firmware === "qmk" && p.file === "keymap.c").map((p) => p.source).join("\n");

  // option -> expression -> value. The expression is the case label.
  const overrides = new Map<string, Map<string, boolean | number>>();
  for (const layer of layout.layers) {
    for (const [position, b] of layer.bindings.entries()) {
      if (b.kind !== "holdTap") continue;
      const profile = profiles.get(b.profileId);
      if (!profile) throw new GenerateError(`layer ${layer.id} position ${position}: hold-tap profile "${b.profileId}" doesn't exist`);
      for (const [key, value] of Object.entries(profile.options)) {
        const global = globals.get(key);
        if (value === global) continue;
        const spec = PER_KEY[key];
        if (!spec || typeof value === "string" || Array.isArray(value)) {
          throw new GenerateError(
            `hold-tap profile "${profile.id}" sets ${key} to ${JSON.stringify(value)} but the layout-wide setting is ${JSON.stringify(global ?? null)}, and QMK can't set ${key} per key. Make them equal, or change the setting.`,
          );
        }
        // A bool option equal to "off" when the setting is absent is not a difference.
        if (typeof value === "boolean" && global === undefined && value === false) continue;
        const expr = exprOf(b);
        const byExpr = overrides.get(key) ?? new Map<string, boolean | number>();
        const previous = byExpr.get(expr);
        if (previous !== undefined && previous !== value) {
          throw new GenerateError(`${expr} is on more than one key with different ${key} values (${previous} and ${value}); QMK picks by keycode, so they must agree`);
        }
        byExpr.set(expr, value as boolean | number);
        overrides.set(key, byExpr);
      }
    }
  }

  for (const td of layout.tapDances) {
    if (td.termMs === undefined) continue;
    const byExpr = overrides.get("TAPPING_TERM") ?? new Map<string, boolean | number>();
    byExpr.set(danceExpr(td.id), td.termMs);
    overrides.set("TAPPING_TERM", byExpr);
  }

  const out: Tapping = { defines: [], functions: [] };
  for (const [key, byExpr] of [...overrides].sort(([a], [b]) => a.localeCompare(b))) {
    const spec = PER_KEY[key] as Option;
    if (defines(passthrough, spec.fn)) {
      throw new GenerateError(`keymap.c already defines ${spec.fn}, which hold-tap profile ${key} also needs. Remove one of them.`);
    }
    if (!globals.has(spec.perKey)) out.defines.push(spec.perKey);
    const cases = [...byExpr].map(([expr, v]) => `    case ${expr}: return ${typeof v === "boolean" ? flag(v) : v};`);
    out.functions.push(
      [
        `${spec.returns} ${spec.fn}(uint16_t keycode, keyrecord_t *record) {`,
        "  switch (keycode) {",
        ...cases,
        `    default: return ${spec.global(globals.get(key))};`,
        "  }",
        "}",
      ].join("\n"),
    );
  }
  return out;
}
