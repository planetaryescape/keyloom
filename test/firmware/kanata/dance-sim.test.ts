// The runtime behaviour of the tap-dance forms the generator writes (D-383), through kanata's simulator. Gated: the release zip has no
// kanata_simulated_input, so it is built from source (spike S33):
//   KEYLOOM_KANATA_SIM=~/.cache/keyloom-s33/target/release/kanata_simulated_input bun test test/firmware/kanata/dance-sim.test.ts
// The simulator reads a script and never opens a keyboard. Without it only the generated text is tested (generate.test.ts).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../helpers/tmp.ts";

const sim = process.env.KEYLOOM_KANATA_SIM;
const gated = sim && existsSync(sim) ? describe : describe.skip;

function typed(action: string, script: string): string {
  const dir = tempDir("keyloom-dance-");
  writeFileSync(join(dir, "c.kbd"), `(defcfg process-unmapped-keys yes)\n(defsrc a)\n(defalias td ${action})\n(deflayer base @td)\n`);
  writeFileSync(join(dir, "s.txt"), `${script}\n`);
  const r = spawnSync(sim as string, ["-c", join(dir, "c.kbd"), "-s", join(dir, "s.txt")], { encoding: "utf8", timeout: 30_000 });
  return r.stdout.split("\n").filter((l) => l.startsWith("out:↓")).map((l) => l.slice(5)).join(" ");
}

gated("a tap dance with a hold, run through kanata's simulator", () => {
  const tapHold = "(tap-hold 200 200 x lctl)";
  test("tap plus hold alone is a plain tap-hold", () => {
    expect(typed(tapHold, "d:a t:50 u:a t:1000")).toBe("X");
    expect(typed(tapHold, "d:a t:500 u:a t:500")).toBe("LCtrl");
  });
  test("a hold beside a double tap: tap, hold and double tap each fire their own action", () => {
    const nested = `(tap-dance 200 (${tapHold} y))`;
    expect(typed(nested, "d:a t:50 u:a t:1000")).toBe("X");
    expect(typed(nested, "d:a t:500 u:a t:500")).toBe("LCtrl");
    expect(typed(nested, "d:a t:50 u:a t:50 d:a t:50 u:a t:1000")).toBe("Y");
  });
  test("tap-then-hold fires on the second press held", () => {
    const nested = "(tap-dance 200 (x (tap-hold 200 200 y lsft)))";
    expect(typed(nested, "d:a t:50 u:a t:50 d:a t:500 u:a t:500")).toBe("LShift");
    expect(typed(nested, "d:a t:50 u:a t:50 d:a t:50 u:a t:1000")).toBe("Y");
  });
});
