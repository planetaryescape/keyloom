// The dev editor's configs fixture (R11): each KEYLOOM_FAKE_UNEXPECTED switch fails only the read it names, so one failure can be checked
// on its own (PR #318 review: configs=internal also failed the proposals read).
import { describe, expect, test } from "bun:test";
import type { LayoutSource } from "../../src/server/layout-source.ts";
import { fakeConfigsBackend } from "../helpers/fake-configs-backend.ts";

const source: LayoutSource = {
  list: async () => [{ id: "lay_daily", name: "Daily", boardId: "zsa/moonlander", revisionId: "rev_1", createdAt: 0, updatedAt: 0 }] as Awaited<ReturnType<LayoutSource["list"]>>,
  get: async () => null,
};
const backend = (over: Partial<Parameters<typeof fakeConfigsBackend>[1]>) =>
  fakeConfigsBackend(source, { boardName: "Moonlander", revisions: async () => [], ...over });

describe("the dev editor's configs fixture", () => {
  test("configs=internal|unreadable fails the list, and the proposals and versions reads still answer", async () => {
    for (const failList of ["internal", "unreadable"] as const) {
      const configs = backend({ failList });
      await expect(configs.list({ includeArchived: false })).rejects.toThrow();
      expect(await configs.proposals("lay_daily")).toEqual([]);
      expect(await configs.versions("lay_daily")).toMatchObject({ layoutId: "lay_daily", layoutName: "Daily" });
    }
  });

  test("proposals=… fails the proposals read only", async () => {
    const configs = backend({ failProposals: "gone" });
    await expect(configs.proposals("lay_daily")).rejects.toMatchObject({ code: "not_found" });
    expect((await configs.list({ includeArchived: false })).map((c) => c.id)).toEqual(["lay_daily"]);
  });
});
