import { describe, expect, test } from "bun:test";
import type { ChatPresentation } from "../../src/api/http.ts";
import type { ApiConfig } from "../../src/api/configs.ts";
import { autoOpenTarget, configToOpen, madeConfigs } from "../../src/web/configs/agent-made-configs.ts";
import { configCardView, type ConfigCardData } from "../../src/web/configs/config-card.ts";

type Op = ChatPresentation["operations"][number];
const op = (id: string, tool: string, status: Op["status"], ...references: Op["references"]): Op => ({
  id, tool, label: tool, status, durationMs: 1, validationCodes: [], references, accepted: 0, declined: 0,
});
const presentation = (operations: Op[], status: ChatPresentation["status"] = "completed"): ChatPresentation => ({
  version: 1, userMessageId: "m", status, operations, messages: [], effectsMayHaveOccurred: true, warning: null, detailsTruncated: false,
});
const config = (id: string) => ({ kind: "config" as const, id });
const ctx = { currentId: "x", opened: new Set<string>(), busy: false };

describe("which config a reply opens", () => {
  test("a completed put_config or create_config opens the config it made", () => {
    expect(configToOpen(presentation([op("op_1", "put_config", "succeeded", config("c1"), { kind: "proposal", id: "cs_1" })]))).toBe("c1");
    expect(configToOpen(presentation([op("op_1", "create_config", "succeeded", config("c2"))]))).toBe("c2");
  });

  test("several configs in one turn open the last one called, whatever order they were stored in", () => {
    const ops = [op("op_1", "put_config", "succeeded", config("zzz")), op("op_2", "create_config", "succeeded", config("aaa"))];
    expect(configToOpen(presentation(ops))).toBe("aaa");
    expect(madeConfigs(presentation(ops)).map((c) => c.id)).toEqual(["zzz", "aaa"]);
  });

  test("a reference that is not from a making tool, or not a config, opens nothing", () => {
    expect(configToOpen(presentation([op("op_1", "propose_changes", "succeeded", config("c1"))]))).toBeNull();
    expect(configToOpen(presentation([op("op_1", "put_config", "succeeded", { kind: "proposal", id: "cs_1" })]))).toBeNull();
  });

  test("a stopped, failed, incomplete, waiting or disconnected run does not open, but its committed config still gets a card", () => {
    for (const status of ["cancelled", "failed", "incomplete", "waiting_user", "unobserved", "running"] as const) {
      const p = presentation([op("op_1", "put_config", "succeeded", config("c1"))], status);
      expect(configToOpen(p)).toBeNull();
      expect(madeConfigs(p).map((c) => c.id)).toEqual(["c1"]);
    }
  });

  test("a making operation that did not finish cleanly is not opened, and an earlier clean one still is", () => {
    expect(configToOpen(presentation([op("op_1", "put_config", "failed", config("c1"))]))).toBeNull();
    expect(configToOpen(presentation([op("op_1", "put_config", "succeeded", config("c1")), op("op_2", "create_config", "failed", config("c2"))]))).toBe("c1");
  });

  test("a presentation that is missing opens nothing", () => {
    expect(configToOpen(undefined)).toBeNull();
    expect(madeConfigs(undefined)).toEqual([]);
  });
});

describe("when the page opens it by itself", () => {
  const made = presentation([op("op_1", "put_config", "succeeded", config("c1"))]);
  test("opens when nothing stops it", () => expect(autoOpenTarget(made, ctx)).toBe("c1"));
  test("does not while BK is editing", () => expect(autoOpenTarget(made, { ...ctx, busy: true })).toBeNull());
  test("does not twice for one config", () => expect(autoOpenTarget(made, { ...ctx, opened: new Set(["c1"]) })).toBeNull());
  test("does not for the config already on screen", () => expect(autoOpenTarget(made, { ...ctx, currentId: "c1" })).toBeNull());
});

describe("the config card", () => {
  const api = (over: Partial<ApiConfig> = {}): ApiConfig => ({
    id: "c1", name: "Glove80 on Corne", boardId: "foostan/corne", boardName: "Corne", headRevisionId: "r", createdAt: 1, updatedAt: 1,
    onKeyboard: false, archivedAt: null, copiedFrom: { layoutId: "g", layoutName: "My Glove80", revisionId: "r" }, ...over,
  });
  const ready = (over: Partial<ApiConfig> = {}, waiting = 3): ConfigCardData => ({ state: "ready", config: api(over), waiting });

  test("offers Open from another config and names the board, the source and the waiting proposals", () => {
    const view = configCardView(ready(), "x", null, "c1");
    expect(view).toMatchObject({ title: "Glove80 on Corne", facts: ["Corne", "Copied from My Glove80", "3 proposals waiting"], action: { kind: "open", id: "c1", label: "Open" } });
  });

  test("offers the way back from the new config when the thread knows where it came from", () => {
    expect(configCardView(ready(), "c1", { id: "x", name: "Daily" }, "c1").action).toEqual({ kind: "back", id: "x", label: "Back to Daily" });
    expect(configCardView(ready(), "c1", null, "c1").action).toBeNull();
    expect(configCardView(ready(), "c1", { id: "c1", name: "Glove80 on Corne" }, "c1").action).toBeNull();
  });

  test("says so, with no button, for a config that is gone, archived or unreadable", () => {
    expect(configCardView({ state: "gone" }, "x", null, "c1")).toMatchObject({ note: "This config has since been deleted.", action: null });
    expect(configCardView(ready({ archivedAt: 5 }), "x", null, "c1")).toMatchObject({ action: null, note: expect.stringContaining("Archived") });
    expect(configCardView({ state: "error" }, "x", null, "c1").action).toBeNull();
    expect(configCardView({ state: "loading" }, "x", null, "c1").action).toBeNull();
  });

  test("handles a source that was deleted, a blank start and a single proposal", () => {
    expect(configCardView(ready({ copiedFrom: { layoutId: "g", layoutName: null, revisionId: "r" } }, 1), "x", null, "c1").facts).toEqual(["Corne", "Copied from a config that has been deleted", "1 proposal waiting"]);
    expect(configCardView(ready({ copiedFrom: null }, 0), "x", null, "c1").facts).toEqual(["Corne", "No proposals waiting"]);
  });
});
