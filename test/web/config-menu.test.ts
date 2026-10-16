// The config switcher's line under each config (D-315).
import { describe, expect, test } from "bun:test";
import type { ApiConfig } from "../../src/api/configs.ts";
import { configLine } from "../../src/web/configs/ConfigMenu.tsx";

const NOW = new Date("2026-10-16T18:00:00").getTime();
const config = (over: Partial<ApiConfig>): ApiConfig => ({
  id: "lay_x", name: "Colemak", boardId: "zsa/moonlander", boardName: "Moonlander", headRevisionId: "rev_x", createdAt: 0,
  updatedAt: new Date("2026-10-15T21:00:00").getTime(), onKeyboard: false, archivedAt: null, copiedFrom: null, ...over,
});

describe("configLine", () => {
  test("says where a copy came from and when it was edited", () => {
    expect(configLine(config({ copiedFrom: { layoutId: "lay_s", layoutName: "synchronized", revisionId: "rev_s" } }), NOW)).toMatch(/^Copied from synchronized · edited yesterday \d/);
  });
  test("a config made blank or imported says only when it was edited, and a deleted source is said plainly", () => {
    expect(configLine(config({}), NOW)).toMatch(/^Edited yesterday \d/);
    expect(configLine(config({ copiedFrom: { layoutId: "lay_s", layoutName: null, revisionId: "rev_s" } }), NOW)).toMatch(/^Copied from a deleted config · /);
  });
});
