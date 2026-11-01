import { expect, test } from "bun:test";
import { assessAffectedBehavior } from "../../src/app/review-behavior.ts";
import { groundedLayout, retargetMode } from "../helpers/grounded-review.ts";
import { workloadApp, replayResult, stroke } from "../helpers/workload.ts";
import { getLayout } from "../../src/app/layouts.ts";

for (const firmware of ["qmk", "zmk"] as const) test(`${firmware} hold-preferred rolls use the hold oracle, including global settings`, async () => {
  const layout = groundedLayout();
  layout.firmware = firmware;
  layout.holdTapProfiles = [{ id: "hrm", name: "Home", firmware, options: firmware === "qmk" ? { TAPPING_TERM: 200 } : { flavor: "hold-preferred", "tapping-term-ms": 200 } }];
  if (firmware === "qmk") { layout.passthrough = []; layout.settings = [{ firmware, key: "HOLD_ON_OTHER_KEY_PRESS", value: true }]; }
  layout.layers[0]!.bindings = [{ kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LGUI"] }, profileId: "hrm" }, { kind: "key", code: "H" }];
  const w = workloadApp(layout);
  try {
    const evidence = await assessAffectedBehavior(w.app, getLayout(w.app, w.layoutId), [{ op: "upsertHoldTapProfile", profile: { ...layout.holdTapProfiles[0]!, options: { ...layout.holdTapProfiles[0]!.options, [firmware === "qmk" ? "TAPPING_TERM" : "tapping-term-ms"]: 180 } } }], {
      enabled: true, signal: new AbortController().signal,
      replay: async (_app, _view, events) => {
        const reports = events.length === 2 ? stroke(40, "G") : events.length === 6 ? [...stroke(400, "H", ["LGUI"]), ...stroke(500, "H")] : stroke(400, "H", ["LGUI"]);
        return { ...replayResult(reports), firmware };
      },
    });
    expect(evidence.status).toBe("verified");
    expect(evidence.checks).toContainEqual({ name: "{key:base:0}: rolling tap", status: "verified", reason: null });
  } finally { w.app.db.close(); }
});

test("a modifier released while its chord key remains down fails the hold oracle", async () => {
  const layout = groundedLayout();
  layout.holdTapProfiles = [{ id: "h", name: "Home", firmware: "zmk", options: { flavor: "tap-preferred", "tapping-term-ms": 200 } }];
  layout.layers[0]!.bindings = [{ kind: "holdTap", tap: { code: "G" }, hold: { mods: ["LGUI"] }, profileId: "h" }, { kind: "key", code: "H" }];
  const w = workloadApp(layout);
  try {
    const result = await assessAffectedBehavior(w.app, getLayout(w.app, w.layoutId), [{ op: "upsertHoldTapProfile", profile: { ...layout.holdTapProfiles[0]!, options: { "tapping-term-ms": 180 } } }], {
      enabled: true, signal: new AbortController().signal,
      replay: async (_app, _view, events) => ({ ...replayResult([{ kind: "keyboard", at: events[1]!.at, keys: ["H"], mods: ["LGUI"] }, { kind: "keyboard", at: events[1]!.at + 5, keys: ["H"], mods: [] }, { kind: "keyboard", at: events[1]!.at + 10, keys: [], mods: [] }]), firmware: "zmk" }),
    });
    expect(result.checks).toContainEqual({ name: "{key:base:0}: hold chord", status: "failed", reason: expect.any(String) });
  } finally { w.app.db.close(); }
});

test("a changed plain key cannot disappear from the coverage beside a passing native hold", async () => {
  const w = workloadApp(groundedLayout());
  try {
    const evidence = await assessAffectedBehavior(w.app, getLayout(w.app, w.layoutId), [...retargetMode(), { op: "setBinding", at: { layerId: "base", position: 3 }, binding: { kind: "key", code: "D" } }], {
      enabled: true, signal: new AbortController().signal,
      replay: async () => ({ ...replayResult([...stroke(1200, "B"), ...stroke(1400, "A")]), firmware: "zmk" }),
    });
    expect(evidence.status).toBe("partial");
    expect(evidence.checks).toContainEqual({ name: "{key:base:3}", status: "unsupported", reason: expect.any(String) });
  } finally { w.app.db.close(); }
});

for (const term of [2000, 6000]) test(`a custom hold term of ${term}ms is bounded honestly`, async () => {
  const layout = groundedLayout();
  layout.passthrough[0]!.source = `/* tapping-term-ms = <5>; */ ${layout.passthrough[0]!.source.replace("<200>", `< ${term} >`)}`;
  const w = workloadApp(layout);
  try {
    const timings: number[] = [];
    const evidence = await assessAffectedBehavior(w.app, getLayout(w.app, w.layoutId), retargetMode(), {
      enabled: true, signal: new AbortController().signal,
      replay: async (_app, _view, events) => {
        timings.push(events[1]!.at);
        return { ...replayResult([...stroke(term + 150, "B"), ...stroke(term + 350, "A")]), firmware: "zmk" };
      },
    });
    expect(timings).toEqual(term <= 5000 ? [term + 150] : []);
    expect(evidence.status).toBe("partial");
    if (term > 5000) expect(evidence.checks.some((c) => c.reason?.includes("tapping term"))).toBe(true);
  } finally { w.app.db.close(); }
});

test("an affected hold-tap fails its chord checks even when the isolated tap types", async () => {
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
    expect(evidence.checks).toContainEqual({ name: "{key:base:1}: tap", status: "verified", reason: null });
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
    expect(evidence.checks).toContainEqual({ name: "{key:base:0}: custom tap", status: "unsupported", reason: "The tap calls indicator; non-HID effects are retained in source but are not measured by HID reports." });
    expect(evidence.checks).toContainEqual({ name: "{key:base:0}: layer hold and release", status: "verified", reason: null });
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
