// Hardware-free acceptance of affected behavior checks through each production firmware core.
import { expect, test } from "bun:test";
import { assessAffectedBehavior } from "../../src/app/review-behavior.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { key, tinyLayout, workloadApp } from "../helpers/workload.ts";

for (const [firmware, boardId] of [["qmk", "zsa/moonlander"], ["zmk", "moergo/glove80"]] as const) {
  for (const interruptAsHold of [false, true]) {
  const run = ["1", firmware].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? test : test.skip;
  run(`affected tap, hold, roll and release checks execute the real ${firmware} core (interruptAsHold=${interruptAsHold})`, async () => {
    const layout = tinyLayout([{ kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LGUI"] }, profileId: "home" }, key("H")]);
    layout.firmware = firmware; layout.boardId = boardId;
    const option = firmware === "qmk" ? "TAPPING_TERM" : "tapping-term-ms";
    layout.holdTapProfiles = [{ id: "home", name: "Home", firmware, options: { [option]: 200, ...(firmware === "zmk" ? { flavor: interruptAsHold ? "hold-preferred" : "tap-preferred" } : {}) } }];
    if (firmware === "qmk" && interruptAsHold) layout.settings = [{ firmware, key: "HOLD_ON_OTHER_KEY_PRESS", value: true }];
    const w = workloadApp(layout);
    try {
      const before = getLayout(w.app, w.layoutId);
      const evidence = await assessAffectedBehavior(w.app, before, [{ op: "upsertHoldTapProfile", profile: { ...layout.holdTapProfiles[0]!, options: { ...layout.holdTapProfiles[0]!.options, [option]: 180 } } }], {
        enabled: true, signal: AbortSignal.timeout(280_000),
      });
      expect(evidence.checks).toEqual([
        { name: "{key:base:0}: tap", status: "verified", reason: null },
        { name: "{key:base:0}: hold chord", status: "verified", reason: null },
        { name: "{key:base:0}: rolling tap", status: "verified", reason: null },
        { name: "{key:base:0}: hold release", status: "verified", reason: null },
      ]);
      expect(evidence.status).toBe("verified");
      expect(getLayout(w.app, w.layoutId)).toEqual(before);
    } finally { w.app.db.close(); }
  }, 300_000);
  }
}
