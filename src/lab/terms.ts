// The tapping term a hold-tap profile has in force: its own, else (QMK) the layout-wide setting, else the firmware's default. Both
// firmwares' own mod-tap and layer-tap keys are 200 ms (QMK TAPPING_TERM, ZMK &mt and &lt).
import type { Layout } from "../layout/schema.ts";
import { BUILTIN_OPTIONS } from "../firmware/zmk/builtins.ts";

export const DEFAULT_TERM_MS = 200;

export function tappingTermOf(layout: Layout, profileId: string): number {
  const profile = layout.holdTapProfiles.find((p) => p.id === profileId);
  if (profile?.firmware === "zmk") {
    const own = profile.options["tapping-term-ms"] ?? BUILTIN_OPTIONS[profile.id]?.["tapping-term-ms"];
    return typeof own === "number" ? own : DEFAULT_TERM_MS;
  }
  const own = profile?.options.TAPPING_TERM;
  if (typeof own === "number") return own;
  const global = layout.settings.find((s) => s.firmware === "qmk" && s.key === "TAPPING_TERM")?.value;
  return typeof global === "number" ? global : DEFAULT_TERM_MS;
}
