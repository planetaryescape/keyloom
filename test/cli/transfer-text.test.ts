import { expect, test } from "bun:test";
import type { AgentArtifact } from "../../src/api/artifacts.ts";
import { transferReportText } from "../../src/cli/transfer-text.ts";

type Transfer = Extract<AgentArtifact, { kind: "transfer" }>;
const report = (over: Partial<Transfer> = {}): Transfer => ({ kind: "transfer", sourceBoard: "Moonlander", destinationBoard: "Corne", mappedCount: 10, skipped: [], ...over });
const layers = Array.from({ length: 12 }, (_, i) => ({ source: `L${i}`, target: `l${i}`, carried: 1, guessed: 0, notCarried: 0 }));
const text = (over: Partial<Transfer> = {}) => transferReportText(report(over), { continues: false }).join("\n");

test("the layer overflow line pluralises like the others", () => {
  expect(text({ layers, layerCount: 13 })).toContain("and 1 more layer");
  expect(text({ layers, layerCount: 13 })).not.toContain("1 more layers");
  expect(text({ layers, layerCount: 15 })).toContain("and 3 more layers");
});

test("no combos means no combo line, as the card does", () => {
  expect(text({ combos: { copied: 0, skipped: [], skippedCount: 0 } })).not.toContain("combo");
  expect(text({ combos: { copied: 2, skipped: [], skippedCount: 0 } })).toContain("2 combos copied");
});
