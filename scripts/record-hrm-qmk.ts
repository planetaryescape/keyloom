// Records what keyloom's QMK emulator does with the S33 scenarios, for each option set, to
// test/fixtures/kanata-sim/qmk.json. Needs Docker and the pinned QMK checkout (run through agent-work):
//   agent-work run -- bun scripts/record-hrm-qmk.ts
// One emulator run per option set: the scenarios are laid end to end, GAP_MS apart, and cut apart by time.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutDirFor } from "../src/app/firmware.ts";
import { getLayout } from "../src/app/layouts.ts";
import { emulateQmk } from "../src/firmware/qmk/emulate.ts";
import type { EmulatorEvent } from "../src/firmware/emulate/types.ts";
import { moonlander } from "../test/helpers/board.ts";
import { commandShiftApp } from "../test/helpers/command-shift.ts";
import { KEYS, OPTION_SETS, type State, dedupe, moonlanderLayout, scenarioStarts, GAP_MS } from "../test/helpers/hrm-differential.ts";

const board = await moonlander();
const fixture = await commandShiftApp();
const base = getLayout(fixture.app, fixture.layoutId).document;
const starts = scenarioStarts();
const events: EmulatorEvent[] = starts.flatMap(({ scenario, start }) =>
  scenario.steps.map(([key, action, at]) => ({ at: start + at, position: (KEYS[key] as { moonlander: number }).moonlander, action: action === "d" ? ("press" as const) : ("release" as const) })),
);

const out: Record<string, Record<string, State[]>> = {};
for (const set of OPTION_SETS) {
  const result = await emulateQmk({
    board: board.definition, boardRevisionId: "reva", layout: moonlanderLayout(base, set), checkoutDir: checkoutDirFor(board),
    events, leadMs: 500, settleMs: GAP_MS, onLine: () => {},
  });
  const keyboard = result.reports.flatMap((r) => (r.kind === "keyboard" ? [{ at: r.at, mods: [...r.mods].sort(), keys: [...r.keys].sort() }] : []));
  out[set.id] = {};
  for (const { scenario, start } of starts) {
    const mine = keyboard.filter((r) => r.at >= start && r.at < start + GAP_MS).map((r) => ({ ...r, at: r.at - start }));
    // Every scenario ends with everything up, so the next window starts from an empty report.
    out[set.id]![scenario.id] = dedupe(mine);
  }
  console.error(`${set.id}: ${result.reports.length} reports, warnings ${JSON.stringify(result.warnings)}`);
}
writeFileSync(join(import.meta.dir, "..", "test", "fixtures", "kanata-sim", "qmk.json"), `${JSON.stringify(out, null, 1)}\n`);
