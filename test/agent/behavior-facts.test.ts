import { expect, test } from "bun:test";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { getLayoutTool } from "../../src/agent/tools/get-layout.ts";
import { groundedWorld } from "../helpers/grounded-review.ts";
import { groundedLayout } from "../helpers/grounded-review.ts";
import { workloadApp } from "../helpers/workload.ts";

test("the reviewer sees the actual custom hold/tap and transitive macro source, not just a misleading label", async () => {
  const w = groundedWorld();
  try {
    const output = await getLayoutTool(createAgentPorts(w.app, w.layoutId, null)).run({ layers: ["base"] });
    expect(output).toContain("&indicator");
    expect(output).toContain("RGB_STATUS");
    expect(output).toContain('"tap":"indicator"');
    expect(output).toContain('"displayNumber":3');
    expect(output).toContain('"firmwareIndex":2');
    expect(output).toContain("not a runtime test");
  } finally { w.app.db.close(); }
});

test("referenced modeled macros and tap dances expose actions rather than names alone", async () => {
  const layout = groundedLayout();
  layout.macros = [{ id: "up-twice", name: "A harmless name", steps: [{ op: "tap", code: "UP" }, { op: "waitMs", ms: 37 }, { op: "tap", code: "UP" }] }];
  layout.tapDances = [{ id: "navigation", name: "Navigation", tap: { kind: "macro", macroId: "up-twice" }, doubleTap: { kind: "key", code: "HOME" } }];
  layout.layers[0]!.bindings[1] = { kind: "tapDance", tapDanceId: "navigation" };
  const w = workloadApp(layout);
  try {
    const output = await getLayoutTool(createAgentPorts(w.app, w.layoutId, null)).run({ layers: ["base"] });
    expect(output).toContain('"doubleTap":{"kind":"key","code":"HOME"}');
    expect(output).toContain('"op":"waitMs","ms":37');
  } finally { w.app.db.close(); }
});
