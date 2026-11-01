import { expect, test } from "bun:test";
import { assessAffectedBehavior } from "../../src/app/review-behavior.ts";
import { groundedLayout, retargetMode } from "../helpers/grounded-review.ts";
import { workloadApp, replayResult, stroke } from "../helpers/workload.ts";
import { getLayout } from "../../src/app/layouts.ts";

test("an affected hold-tap is not called verified merely because the workload text still types", async () => {
  const layout = groundedLayout();
  layout.holdTapProfiles = [{ id: "hrm", name: "Home row", firmware: "zmk", options: { "tapping-term-ms": 200 } }];
  layout.layers[0]!.bindings[1] = { kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LGUI"] }, profileId: "hrm" };
  layout.layers[0]!.bindings[2] = { kind: "key", code: "H" };
  const w = workloadApp(layout);
  try {
    const evidence = await assessAffectedBehavior(w.app, getLayout(w.app, w.layoutId), [{ op: "upsertHoldTapProfile", profile: { ...layout.holdTapProfiles[0]!, options: { "tapping-term-ms": 180 } } }], {
      enabled: true, signal: new AbortController().signal,
      // A broken firmware path can type the isolated tap but loses its modifier on a chord.
      replay: async () => ({ ...replayResult(stroke(40, "G")), firmware: "zmk" }),
    });
    expect(evidence.status).toBe("failed");
    expect(evidence.checks.some((c) => c.name.includes("hold") && c.status === "failed")).toBe(true);
    expect(evidence.checks.some((c) => c.name.includes("tap") && c.status === "verified")).toBe(true);
    expect(evidence.limitations.join(" ")).toContain("comfort");
  } finally { w.app.db.close(); }
});

test("a successful layer witness does not claim to have tested an RGB-status tap", async () => {
  const w = workloadApp(groundedLayout());
  try {
    const view = getLayout(w.app, w.layoutId);
    const evidence = await assessAffectedBehavior(w.app, view, retargetMode(), {
      enabled: true, signal: new AbortController().signal,
      replay: async () => ({ ...replayResult([...stroke(1200, "B"), ...stroke(1400, "A")]), firmware: "zmk" }),
    });
    expect(evidence.status).toBe("partial");
    expect(evidence.checks).toContainEqual({ name: "base/0: custom tap", status: "unsupported", reason: "The tap calls indicator; non-HID effects are retained in source but are not measured by HID reports." });
    expect(evidence.checks).toContainEqual({ name: "base/0: layer hold and release", status: "verified", reason: null });
    expect(getLayout(w.app, w.layoutId).revision.id).toBe(view.revision.id);
  } finally { w.app.db.close(); }
});

test("without explicit activity selection affected behavior causes no firmware replay", async () => {
  const w = workloadApp(groundedLayout());
  try {
    const result = await assessAffectedBehavior(w.app, getLayout(w.app, w.layoutId), retargetMode(), {
      enabled: false, signal: new AbortController().signal, replay: async () => { throw new Error("must not run"); },
    });
    expect(result.status).toBe("not-tested");
    expect(result.checks).toEqual([]);
  } finally { w.app.db.close(); }
});
