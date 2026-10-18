// Tool/validator contract tests, not a prediction of a live model's tool choices.
import { expect, test } from "bun:test";
import { TurnRecorder } from "../../src/agent/recorder.ts";
import { getLayoutTool } from "../../src/agent/tools/get-layout.ts";
import { analyseChangeTool } from "../../src/agent/tools/analyse-change.ts";
import { proposeChangesTool } from "../../src/agent/tools/propose-changes.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { applyOps, getLayout, listChanges, newConfig, openApp } from "../../src/app/index.ts";
import { boardCapabilities } from "../../src/boards/capabilities.ts";
import { applyOps as previewOps } from "../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { addReachableLayer, draft } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";

function setup(board = "moergo/glove80") {
  const app = openApp({ dataDir: tempDir() });
  const config = newConfig(app, { name: "Synthetic colours", from: "blank", board });
  const before = getLayout(app, config.id);
  const base = before.document.layers[0];
  if (base === undefined) throw new Error("blank config has no base layer");
  const ops: ChangeOp[] = [
    ...addReachableLayer("symbols", base.id),
    ...addReachableLayer("navigation", "symbols"),
    { op: "setLayerStyle", layerId: base.id, shortLabel: "MAIN", color: 4 },
    { op: "setLayerStyle", layerId: "symbols", shortLabel: "SYM", color: 4 },
  ];
  if (boardCapabilities(before.board.definition).lighting.supported) ops.push({ op: "setLayerLighting", layerId: base.id, lighting: { layer: [85, 255, 255], keys: { "0": [10, 255, 255] } } });
  applyOps(app, config.id, { baseRevisionId: before.revision.id, summary: "Synthetic labelled layers", ops });
  const ports = createAgentPorts(app, config.id, null);
  const recorder = new TurnRecorder();
  const propose = proposeChangesTool(ports, recorder, () => {});
  const analyse = analyseChangeTool(ports, recorder);
  return { app, config, ports, propose, analyse };
}

const alternative = (ops: ChangeOp[], scope: "display" | "led" = "display") => ({
  title: scope === "display" ? "Distinct on-screen layer colours" : "Physical keyboard LED colours", ops,
  explanation: scope === "display" ? "Different colours in keyloom only; keyboard LEDs are unchanged." : "Changes physical LEDs only; on-screen layer styling stays unchanged.",
  tradeoffs: { gains: [scope === "display" ? "Layers are easier to tell apart on screen" : "Keyboard LEDs show the layer colour"], costs: [] }, decisionDraft: draft(),
});

test("Glove80 get_layout distinguishes supported app styling from unsupported hardware LEDs", async () => {
  const { app, ports } = setup();
  try {
    const text = String(await getLayoutTool(ports).run({}));
    expect(boardCapabilities(ports.snapshot().board.definition).lighting.supported).toBe(false);
    expect(boardCapabilities(ports.snapshot().board.definition).layerStyle.supported).toBe(true);
    expect(text).toContain("On-screen layer styling");
    expect(text).toContain("setLayerStyle");
    expect(text).toContain("1 to 6");
    expect(text).toContain("shortLabel");
    expect(text).toContain("not keyboard LEDs");
    expect(text).toContain("Cannot do: per-key hardware LED colours");
    expect(text).toContain('"shortLabel":"MAIN"');
  } finally { app.db.close(); }
});

test.each(["moergo/glove80", "zsa/moonlander", "apple/macbook-ansi"])("actual analyse/propose tools accept distinct display colours on %s without changing labels, LEDs or applying", async (board) => {
  const { app, config, ports, analyse, propose } = setup(board);
  try {
    const before = ports.snapshot();
    const ops: ChangeOp[] = before.document.layers.map((layer, index) => ({ op: "setLayerStyle", layerId: layer.id, color: index + 1, shortLabel: layer.shortLabel ?? null }));
    expect(String(await analyse.run({ ops }))).toContain('"ok":true');
    expect(String(await propose.run({ alternatives: [alternative(ops)] }))).toContain("saved as");
    const changes = listChanges(app, config.id, { status: "proposed" });
    expect(changes).toHaveLength(1);
    const saved = changes[0];
    if (saved === undefined) throw new Error("proposal missing");
    expect(saved.ops).toEqual(ops);
    const result = previewOps(before.document, saved.ops);
    if (!result.ok) throw new Error(result.error.message);
    const preview = result.layout;
    expect(new Set(preview.layers.map((layer) => layer.color)).size).toBe(preview.layers.length);
    expect(preview.layers.map((layer) => layer.shortLabel)).toEqual(before.document.layers.map((layer) => layer.shortLabel));
    expect(preview.layers.map((layer) => layer.lighting)).toEqual(before.document.layers.map((layer) => layer.lighting));
    expect(getLayout(app, config.id).revision.id).toBe(before.revisionId);
    expect(getLayout(app, config.id).document).toEqual(before.document);
  } finally { app.db.close(); }
});

test("Moonlander LED proposals preserve the independently configured display colour and short label", async () => {
  const { app, config, ports, analyse, propose } = setup("zsa/moonlander");
  try {
    const before = ports.snapshot();
    const base = before.document.layers[0];
    if (base === undefined) throw new Error("base layer missing");
    const ops: ChangeOp[] = [{ op: "setLayerLighting", layerId: base.id, lighting: { layer: [170, 255, 255] } }];
    expect(String(await analyse.run({ ops }))).toContain('"ok":true');
    expect(String(await propose.run({ alternatives: [alternative(ops, "led")] }))).toContain("saved as");
    const saved = listChanges(app, config.id, { status: "proposed" })[0];
    if (saved === undefined) throw new Error("LED proposal missing");
    expect(saved.ops).toEqual(ops);
    const preview = previewOps(before.document, saved.ops);
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.layout.layers[0]).toMatchObject({ shortLabel: "MAIN", color: 4, lighting: { layer: [170, 255, 255] } });
    expect(getLayout(app, config.id).document).toEqual(before.document);
  } finally { app.db.close(); }
});

test("an explicit physical LED change still fails analyse/propose on Glove80 and saves nothing", async () => {
  const { app, config, ports, analyse, propose } = setup();
  try {
    const layer = ports.snapshot().document.layers[0];
    if (layer === undefined) throw new Error("base layer missing");
    const ops: ChangeOp[] = [{ op: "setLayerLighting", layerId: layer.id, lighting: { layer: [10, 255, 255] } }];
    expect(String(await analyse.run({ ops }))).toContain("lighting_unsupported");
    const result = String(await propose.run({ alternatives: [alternative(ops, "led")] }));
    expect(result).toContain("INVALID, not saved");
    expect(result).toContain("lighting_unsupported");
    expect(listChanges(app, config.id, { status: "proposed" })).toHaveLength(0);
  } finally { app.db.close(); }
});

test("display tool inputs keep the existing palette bounds and explicit label-preservation requirement", () => {
  const { app, analyse } = setup();
  try {
    const op = { op: "setLayerStyle", layerId: "base", color: 7, shortLabel: "MAIN" };
    expect(() => analyse.run({ ops: [op] })).toThrow("invalid input");
    expect(() => analyse.run({ ops: [{ ...op, color: 0 }] })).toThrow("invalid input");
    expect(() => analyse.run({ ops: [{ op: "setLayerStyle", layerId: "base", color: 2 }] })).toThrow("invalid input");
  } finally { app.db.close(); }
});
