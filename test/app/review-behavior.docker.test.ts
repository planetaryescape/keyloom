// Hardware-free acceptance of affected behavior checks through each production firmware core.
import { expect, test } from "bun:test";
import { assessAffectedBehavior } from "../../src/app/review-behavior.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { key, tinyLayout, workloadApp } from "../helpers/workload.ts";

for (const [firmware, boardId] of [["qmk", "zsa/moonlander"], ["zmk", "moergo/glove80"]] as const) {
  const run = ["1", firmware].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? test : test.skip;
  run(`affected tap, hold, roll and release checks execute the real ${firmware} core`, async () => {
    const layout = tinyLayout([{ kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LGUI"] }, profileId: "home" }, key("H")]);
    layout.firmware = firmware; layout.boardId = boardId;
    const option = firmware === "qmk" ? "TAPPING_TERM" : "tapping-term-ms";
    layout.holdTapProfiles = [{ id: "home", name: "Home", firmware, options: { [option]: 200, ...(firmware === "zmk" ? { flavor: "tap-preferred" } : {}) } }];
    const w = workloadApp(layout);
    try {
      const before = getLayout(w.app, w.layoutId);
      const evidence = await assessAffectedBehavior(w.app, before, [{ op: "upsertHoldTapProfile", profile: { ...layout.holdTapProfiles[0]!, options: { ...layout.holdTapProfiles[0]!.options, [option]: 180 } } }], {
        enabled: true, signal: AbortSignal.timeout(280_000),
      });
      expect(evidence.checks).toEqual([
        { name: "base/0: tap", status: "verified", reason: null },
        { name: "base/0: hold chord", status: "verified", reason: null },
        { name: "base/0: rolling tap", status: "verified", reason: null },
        { name: "base/0: hold release", status: "verified", reason: null },
      ]);
      expect(evidence.status).toBe("verified");
      expect(getLayout(w.app, w.layoutId)).toEqual(before);
    } finally { w.app.db.close(); }
  }, 300_000);
}
