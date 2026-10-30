import { expect, test } from "bun:test";
import { transferReport, REPORT_LIMITS, REPORT_TEXT, TransferReportSchema } from "../../src/app/copy-report.ts";
import { getLayout } from "../../src/app/index.ts";
import { planPut } from "../../src/app/keyboard-put.ts";
import type { PutPlan } from "../../src/agent/put-plan.ts";
import { TransferArtifactSchema } from "../../src/api/artifacts.ts";
import { copyAdaptationApp } from "../helpers/copy-adaptation.ts";

const names = { sourceBoard: "Glove80", destinationBoard: "Corne", layerName: (id: string) => `Layer ${id}` };

test("a copy with drops reports the plan's own counts, order, reasons, layers, combos and placements", async () => {
  const { app, sourceId } = copyAdaptationApp();
  try {
    const { plan } = planPut(app, { from: sourceId, board: "foostan/corne" });
    const document = getLayout(app, sourceId).document;
    const layerNames = new Map(document.layers.map((layer) => [layer.id, layer.name]));
    const report = transferReport(plan, { sourceBoard: "Glove80", destinationBoard: "Corne", layerName: (id) => layerNames.get(id) ?? id });
    const carried = plan.layers.reduce((n, layer) => n + layer.carried, 0);
    expect(report).toMatchObject({
      kind: "transfer", sourceBoard: "Glove80", destinationBoard: "Corne",
      mappedCount: carried, skippedCount: plan.notCarried.length, layerCount: plan.layers.length,
      noteCount: plan.notes.length,
    });
    // The drops keep the plan's order and its own reason for each key.
    expect(report.skipped).toEqual(plan.notCarried.map((key) => ({ key: `${key.sourceName} (${key.layerName})`, reason: key.why })));
    expect(report.layers).toEqual(plan.layers.map((layer) => ({
      source: layerNames.get(layer.source) ?? layer.source, target: layerNames.get(layer.target) ?? layer.target,
      carried: layer.carried, guessed: layer.guessed, notCarried: layer.notCarried,
    })));
    expect(report.guessedCount).toBe(plan.layers.reduce((n, layer) => n + layer.guessed, 0));
    expect(report.combos).toEqual({ copied: plan.combos.copied.length, skipped: plan.combos.skipped, skippedCount: plan.combos.skipped.length });
    expect(report.notes).toEqual(plan.notes);
    // The Glove80-only thumb key has no place on the Corne, so its layer key has a free key on offer there.
    const placeable = plan.placements.filter((placement) => placement.blocked === undefined && placement.candidates.length > 0);
    expect(report.placementCount).toBe(placeable.length);
    expect(report.placementsBlocked).toBe(plan.placements.length - placeable.length);
    expect(report.skipped.length).toBeGreaterThan(0);
    expect(TransferReportSchema.parse(report)).toEqual(report);
    expect(TransferArtifactSchema.parse(report)).toEqual(report);
  } finally { app.db.close(); }
});

test("a copy with no drops has an empty list and nothing to count beyond it", async () => {
  const plan: PutPlan = {
    ops: [], opsWithPlacements: [], placements: [],
    layers: [{ source: "layer-0", target: "base", carried: 42, guessed: 0, notCarried: 0 }],
    notCarried: [], combos: { copied: ["copy"], skipped: [] }, notes: [],
  };
  const report = transferReport(plan, names);
  expect(report).toMatchObject({ mappedCount: 42, guessedCount: 0, skipped: [], skippedCount: 0, layerCount: 1, placementCount: 0, placementsBlocked: 0 });
  expect(report.combos).toEqual({ copied: 1, skipped: [], skippedCount: 0 });
});

test("a plan past the bounds keeps the first rows, the order and a count of what was cut", () => {
  const long = "W".repeat(160);
  const plan: PutPlan = {
    ops: [], opsWithPlacements: [], placements: [],
    layers: Array.from({ length: 20 }, (_, i) => ({ source: `layer-${i}`, target: `layer-${i}`, carried: i, guessed: 0, notCarried: 1 })),
    notCarried: Array.from({ length: 81 }, (_, i) => ({ layerName: long, source: i, sourceName: `${long} ${i}`, why: long })),
    combos: { copied: [], skipped: Array.from({ length: 17 }, (_, i) => ({ id: `combo-${i}`, why: long })) },
    notes: Array.from({ length: 11 }, (_, i) => `${"N".repeat(300)} ${i}`),
  };
  const report = transferReport(plan, { sourceBoard: "S".repeat(200), destinationBoard: "D", layerName: (id) => id });
  expect(report.skipped).toHaveLength(REPORT_LIMITS.skipped);
  expect(report.skippedCount).toBe(81);
  expect(report.skipped[0]?.key).toBe(`${`${long} 0 (${long})`.slice(0, REPORT_TEXT.key - 1)}…`);
  expect(report.skipped[0]?.reason).toHaveLength(REPORT_TEXT.reason);
  expect(report.skipped[0]?.reason.endsWith("…")).toBe(true);
  expect(report.layers).toHaveLength(REPORT_LIMITS.layers);
  expect(report.layerCount).toBe(20);
  expect(report.combos.skipped).toHaveLength(REPORT_LIMITS.combos);
  expect(report.combos.skippedCount).toBe(17);
  expect(report.notes).toHaveLength(REPORT_LIMITS.notes);
  expect(report.noteCount).toBe(11);
  expect(report.notes[0]).toHaveLength(REPORT_TEXT.note);
  expect(report.notes[0]?.endsWith("…")).toBe(true);
  expect(report.sourceBoard).toHaveLength(REPORT_TEXT.board);
  // The bound rows still fit the shape the copy stores and the wire carries.
  expect(TransferReportSchema.parse(report)).toEqual(report);
  expect(TransferArtifactSchema.parse(report)).toEqual(report);
});

test("the wire schema still takes the report as it was first shipped, without the added fields", () => {
  const legacy = { kind: "transfer" as const, sourceBoard: "Moonlander", destinationBoard: "Corne", mappedCount: 12, skipped: [{ key: "Esc (Base)", reason: "no key on the new board does this" }] };
  expect(TransferArtifactSchema.parse(legacy)).toEqual(legacy);
  expect(TransferReportSchema.safeParse(legacy).success).toBe(false);
});
