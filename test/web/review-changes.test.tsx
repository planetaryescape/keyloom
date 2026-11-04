import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalCard } from "../../src/api/http.ts";
import type { ReviewResponse } from "../../src/api/review.ts";
import type { BoardDefinition } from "../../src/boards/schema.ts";
import { showBoard } from "../../src/app/boards.ts";
import { boardSensorDefaults } from "../../src/boards/sensors.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { retargetLayerHold } from "../../src/layout/behavior-facts.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { ReviewPanel, reviewTextWords } from "../../src/web/review/ReviewPanel.tsx";
import { formatFindingRepairRequest } from "../../src/api/review.ts";
import type { Review } from "../../src/web/review/useReview.ts";
import { glove80, STYLE_FIXTURE } from "../helpers/zmk.ts";
import { tinyBoard, tinyLayout } from "../helpers/workload.ts";

const fullBoard = await glove80();
const fullLayout = (await importZmkSource(STYLE_FIXTURE, fullBoard.definition)).layout;
const sensorBoard = (await loadBoardDir(`${import.meta.dir}/../../boards/keebart/corne-choc-pro-bt`)).definition;

function panel(layout: Layout, board: BoardDefinition, ops: ChangeOp[]) {
  const validation = evaluate(board, layout, ops).result;
  const card: ProposalCard = { changeSetId: "proposal", proposalGroup: null, title: "Synthetic proposal", explanation: "Legacy prose must not hide the current/proposed values.", status: "proposed", ops, validation, tradeoffs: { gains: [], costs: [] }, decisionDraft: null };
  const response: ReviewResponse["review"] = { id: "review", layoutId: "layout", revisionId: "revision", trigger: "manual", checkedAt: 0, checks: { status: "done", summary: { layers: layout.layers.length, keys: board.keyCount, combos: layout.combos.length } }, ai: { status: "done", reason: null, model: null }, freshness: { current: true, reason: null }, fixed: [], items: [{ id: "suggestion", source: "agent", kind: "suggestion", severity: "info", code: "suggestion", title: "Synthetic proposal", body: "Old stored body", keys: [], layers: [], proposalId: card.changeSetId, fixes: [], dismissedAt: null }] };
  const review: Review = { review: response, stale: false, loaded: true, busy: false, refreshing: false, problem: null, activities: [], justFixed: [], clearJustFixed() {}, run: async () => {}, dismiss: async () => {}, restore: async () => {}, reload: () => undefined };
  return { validation, html: renderToStaticMarkup(createElement(ReviewPanel, { token: "synthetic", review, layout, board, rows: {}, boardName: "Synthetic", configName: "Synthetic config", proposals: [card], pinnedId: null, onPin() {}, onApply: async () => {}, onShowLayer() {}, onPlanRepair() {}, onClose() {} })) };
}

test("combo-only proposal renders concrete keys, scope, output and timeout, with Apply available", () => {
  const layout = tinyLayout(undefined, [{ kind: "key", code: "N1" }, { kind: "key", code: "N2" }, { kind: "none" }, { kind: "key", code: "N4" }]);
  const { html, validation } = panel(layout, tinyBoard(), [{ op: "upsertCombo", combo: { id: "save", name: "Save shortcut", positions: [0, 3], layerIds: "all", output: { kind: "key", code: "S", mods: ["LCTL"] }, timeoutMs: 45 } }]);
  expect(validation.ok).toBe(true);
  expect(html).toContain("Combo · Save shortcut");
  expect(html).toContain("Keys");
  expect(html).toContain("Active on");
  expect(html).toContain("All layers");
  expect(html).toContain("Sends Left Ctrl + S");
  expect(html).toContain("45 ms");
  expect(html).toContain("source checked");
  expect(html).toMatch(/class="bar-apply"[^>]*>Apply/);
  expect(html).not.toContain("combos changed");
});

test("tap-dance timing is a named Current/Proposed delta rather than a category-only note", () => {
  const layout = tinyLayout(undefined, [{ kind: "key", code: "N1" }, { kind: "key", code: "N2" }, { kind: "none" }, { kind: "key", code: "N4" }]);
  layout.tapDances = [{ id: "esc-caps", name: "Escape or Caps", tap: { kind: "key", code: "ESCAPE" }, termMs: 200 }];
  const { html, validation } = panel(layout, tinyBoard(), [{ op: "upsertTapDance", tapDance: { ...layout.tapDances[0]!, termMs: 240 } }]);
  expect(validation.ok).toBe(true);
  expect(html).toContain("Tap dance · Escape or Caps");
  expect(html).toContain("Tapping term");
  expect(html).toContain("200 ms");
  expect(html).toContain("240 ms");
  expect(html).not.toContain("Tap dances changed");
});

test("changed keys on a newly added layer use its human-readable name", () => {
  const layout = tinyLayout([{ kind: "key", code: "A" }, { kind: "key", code: "B" }, { kind: "none" }, { kind: "key", code: "D" }]);
  const { html } = panel(layout, tinyBoard(), [
    { op: "addLayer", layer: { id: "function-layer", name: "Function" }, afterLayerId: "base" },
    { op: "setBinding", at: { layerId: "function-layer", position: 0 }, binding: { kind: "key", code: "F17" } },
  ]);
  expect(html).toContain("Function");
  expect(html).not.toContain("function-layer");
});

test("native hold retarget shows distinct named effects beside unchanged legends and no serialized facts", () => {
  const layout = structuredClone(fullLayout);
  layout.layers[1]!.name = "Navigation";
  layout.layers[1]!.shortLabel = "MAG";
  layout.layers[2]!.name = "Numbers";
  layout.layers[2]!.shortLabel = "MAG";
  layout.passthrough.push({ firmware: "zmk", file: "glove80.keymap", anchor: "behavior:magic", source: "magic: magic_hold_tap { compatible = \"zmk,behavior-hold-tap\"; #binding-cells = <2>; bindings = <&mo>, <&bootloader>; };", refersToLayerIndices: false });
  layout.layers[0]!.bindings[14] = { kind: "native", firmware: "zmk", source: "&magic 1 0", label: "Magic", layerRefs: [{ start: 7, end: 8, layerId: layout.layers[1]!.id }] };
  const ops = retargetLayerHold(layout, { layerId: layout.layers[0]!.id, position: 14 }, layout.layers[2]!.id).ops;
  const { html, validation } = panel(layout, fullBoard.definition, ops);
  expect(validation.ok).toBe(true);
  expect(html).toContain("Magic");
  expect(html).toContain("Tap Enter bootloader; hold to use Navigation");
  expect(html).toContain("Tap Enter bootloader; hold to use Numbers");
  expect(html).not.toContain("{layer:");
  expect(html).not.toContain("source effects [");
  expect(html).not.toContain('"kind":"');
});

test("unknown native source stays verbatim and unverified, with preview and Apply blocked", () => {
  const layout = tinyLayout(undefined, [{ kind: "key", code: "N1" }, { kind: "key", code: "N2" }, { kind: "none" }, { kind: "key", code: "N4" }]);
  layout.layers[0]!.bindings[1] = { kind: "native", firmware: "qmk", source: "MYSTERY_ACTION(9)", label: "Custom action" };
  const { html, validation } = panel(layout, tinyBoard(), [{ op: "swapBindings", a: { layerId: "base", position: 0 }, b: { layerId: "base", position: 1 } }]);
  expect(validation.ok).toBe(true);
  expect(html).toContain("Custom QMK source “MYSTERY_ACTION(9)” (meaning not established)");
  expect(html).toContain("Comparison incomplete. Preview and Apply are unavailable.");
  expect(html).toContain("comparison incomplete");
  expect(html).not.toContain("source checked");
  expect(html).not.toContain('"kind":"');
  expect(html).toMatch(/class="bar-apply" disabled=""[^>]*>Apply/);
  expect(html).toMatch(/class="sheet-action" disabled=""[^>]*>Show it on the board/);
});

test("valid sensor edits are explicitly incomplete, with no source-checked claim or Apply", () => {
  const sensors = boardSensorDefaults(sensorBoard);
  const layout: Layout = { schemaVersion: 1, boardId: sensorBoard.id, firmware: "zmk", layers: [{ id: "base", name: "Base", bindings: Array.from({ length: sensorBoard.keyCount }, () => ({ kind: "none" as const })), sensorBindings: structuredClone(sensors) }], macros: [], combos: [], tapDances: [], conditionalLayers: [], holdTapProfiles: [], settings: [], passthrough: [] };
  const proposed = structuredClone(sensors);
  const first = proposed[0];
  if (first?.kind !== "rotation") throw new Error("expected a rotation sensor fixture");
  proposed[0] = { ...first, clockwise: { kind: "key", code: "A" } };
  const { html, validation } = panel(layout, sensorBoard, [{ op: "setSensorBindings", layerId: "base", sensorBindings: proposed }]);
  expect(validation.ok).toBe(true);
  expect(html).toContain("Comparison incomplete. Preview and Apply are unavailable.");
  expect(html).toContain("Encoder actions on Base are not represented");
  expect(html).toContain("comparison incomplete");
  expect(html).not.toContain("source checked");
  expect(html).toMatch(/class="bar-apply" disabled=""[^>]*>Apply/);
  expect(html).toMatch(/class="sheet-action" disabled=""[^>]*>Show it on the board/);
});

test("repair finding words distinguish same-row blank keys by hand and layer", () => {
  const moonlander = showBoard("zsa/moonlander");
  const layout = tinyLayout();
  layout.layers[0]!.id = "layer-0";
  layout.layers[0]!.name = "Base";
  const words = reviewTextWords("{key:layer-0:33} and {key:layer-0:36} on {layer:layer-0}", layout, moonlander.definition, moonlander.geometry);
  expect(words).toContain("blank (left index");
  expect(words).toContain("blank (right index");
  expect(words).toContain("Base");
  expect(words).not.toContain("an empty key on the home row and an empty key on the home row");
});

test("repair request formatting preserves distinct scope slots even when labels repeat", () => {
  const request = formatFindingRepairRequest({ title: "Unused keys", body: "Two keys are blank.", scope: ["blank (left index, home row, Base)", "blank (right index, home row, Base)"] });
  expect(request).toContain("Marked scope: blank (left index, home row, Base); blank (right index, home row, Base).");
});
