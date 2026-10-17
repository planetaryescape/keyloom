// S33: kanata's simulator against keyloom's QMK emulator for home-row mods (docs/research/spikes/S33.md). Gated, because it
// needs a kanata_simulated_input built from source (the release zip has none):
//   KEYLOOM_KANATA_SIM=~/.cache/keyloom-s33/target/release/kanata_simulated_input bun test test/firmware/kanata/sim.test.ts
// The QMK side is read from test/fixtures/kanata-sim/qmk.json, recorded by scripts/record-hrm-qmk.ts (the only part that
// needs Docker). The simulator reads a script file; it never opens a keyboard.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OPTION_SETS, SCENARIOS, type State, type Verdict, compare, kanataConfig, runSim } from "../../helpers/hrm-differential.ts";
import { tempDir } from "../../helpers/tmp.ts";

const sim = process.env.KEYLOOM_KANATA_SIM;
const gated = sim && existsSync(sim) ? describe : describe.skip;
const qmk: Record<string, Record<string, State[]>> = await Bun.file(join(import.meta.dir, "..", "..", "fixtures", "kanata-sim", "qmk.json")).json();

/** Every pair not listed here must be a `match`. Each entry is a real difference between the two, explained in S33.md. */
const KNOWN: Record<string, Verdict["kind"]> = {
  // kanata keeps the first tapped key down until the second home-row key has resolved; QMK releases it first. Same keys typed.
  "plain/two-hrm-roll": "order",
  "permissive-hold/two-hrm-roll": "order",
  "chordal-hold/two-hrm-roll": "order",
  "chordal-hold-permissive/two-hrm-roll": "order",
  "quick-tap-120/two-hrm-roll": "order",
  // kanata's tap-repress-ms runs from the first press, QMK's QUICK_TAP_TERM from the first tap's release.
  "quick-tap-120/slow-retap": "differs",
};

gated("kanata's simulator against the QMK emulator, home-row mods", () => {
  const dir = tempDir("keyloom-s33-");
  for (const set of OPTION_SETS) {
    describe(set.id, () => {
      const { kbd } = kanataConfig(set);
      for (const scenario of SCENARIOS) {
        const key = `${set.id}/${scenario.id}`;
        test(`${scenario.id}: ${KNOWN[key] ?? "match"}`, () => {
          const kanata = runSim(sim as string, kbd, scenario, join(dir, set.id));
          const verdict = compare(qmk[set.id]![scenario.id]!, kanata);
          expect(verdict.kind).toBe(KNOWN[key] ?? "match");
        });
      }
    });
  }
});

describe("the recorded QMK side", () => {
  test("both PERMISSIVE_HOLD and HOLD_ON_OTHER_KEY_PRESS behave as HOLD_ON_OTHER_KEY_PRESS alone on QMK, which is what the translation says", () => {
    expect(qmk["both-permissive-and-hold-on-other"]).toEqual(qmk["hold-on-other-key-press"]);
  });

  test("covers every option set and scenario", () => {
    for (const set of OPTION_SETS) for (const s of SCENARIOS) expect(qmk[set.id]?.[s.id]?.length).toBeGreaterThan(0);
  });
});
