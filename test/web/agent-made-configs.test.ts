import { describe, expect, test } from "bun:test";
import type { ChatPresentation } from "../../src/api/http.ts";
import type { ApiConfig } from "../../src/api/configs.ts";
import { autoOpenTarget, configToOpen, madeConfigs } from "../../src/web/configs/agent-made-configs.ts";
import { MAKERS as APP_MAKERS } from "../../src/app/made-configs.ts";
import { MAKERS as WEB_MAKERS } from "../../src/web/configs/agent-made-configs.ts";
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

test("the CLI and the web read the same making tools", () => {
  expect([...APP_MAKERS].sort()).toEqual([...WEB_MAKERS].sort());
  expect([...WEB_MAKERS].sort()).toEqual(["create_config", "put_config"]);
});

describe("the config card", () => {
  const api = (over: Partial<ApiConfig> = {}): ApiConfig => ({
    id: "c1", name: "Glove80 on Corne", boardId: "foostan/corne", boardName: "Corne", headRevisionId: "r", createdAt: 1, updatedAt: 1,
    onKeyboard: false, archivedAt: null, copiedFrom: { layoutId: "g", layoutName: "My Glove80", revisionId: "r" }, ...over,
  });
  const ready = (over: Partial<ApiConfig> = {}, waiting: number | null = 3): ConfigCardData => ({ state: "ready", config: api(over), waiting });

  test("offers Open from another config and names the board, the source and the waiting proposals", () => {
    const view = configCardView(ready(), "x", null, "c1");
    expect(view).toMatchObject({ title: "Glove80 on Corne", facts: ["Corne", "Copied from My Glove80", "3 proposals waiting"], action: { kind: "open", id: "c1", label: "Open" } });
  });

  test("offers the way back from the new config when the thread knows where it came from", () => {
    expect(configCardView(ready({}, 0), "c1", { id: "x", name: "Daily" }, "c1").action).toEqual({ kind: "back", id: "x", label: "Back to Daily" });
    expect(configCardView(ready({}, 0), "c1", null, "c1").action).toBeNull();
    expect(configCardView(ready({}, 0), "c1", { id: "c1", name: "Glove80 on Corne" }, "c1").action).toBeNull();
  });

  test("on the new config the main action reviews its waiting proposals and the way back is the second button", () => {
    const view = configCardView(ready({}, 3), "c1", { id: "x", name: "Daily" }, "c1");
    expect(view.action).toEqual({ kind: "review", id: "c1", label: "Review 3 proposals" });
    // The count is the button's words, so the facts don't repeat it.
    expect(view.facts).toEqual(["Corne", "Copied from My Glove80"]);
    expect(view.secondary).toEqual({ kind: "back", id: "x", label: "Back to Daily" });
    expect(configCardView(ready({}, 1), "c1", null, "c1")).toMatchObject({ action: { label: "Review proposal" }, secondary: null });
  });

  test("from another config Open is the only action, whatever waits", () => {
    expect(configCardView(ready({}, 3), "x", { id: "x", name: "Daily" }, "c1")).toMatchObject({ action: { kind: "open", label: "Open" }, secondary: null });
  });

  test("proposals that could not be read leave the count and the review out but keep the config and its actions", () => {
    const view = configCardView(ready({}, null), "c1", { id: "x", name: "Daily" }, "c1");
    expect(view.facts).toEqual(["Corne", "Copied from My Glove80"]);
    expect(view).toMatchObject({ action: { kind: "back" }, secondary: null });
    expect(configCardView(ready({}, null), "x", null, "c1").action).toMatchObject({ kind: "open" });
  });

  test("says so, with no button, for a config that is gone, archived or unreadable", () => {
    expect(configCardView({ state: "gone" }, "x", null, "c1")).toMatchObject({ note: "This config has since been deleted.", action: null });
    expect(configCardView(ready({ archivedAt: 5 }), "x", null, "c1")).toMatchObject({ action: null, note: expect.stringContaining("Archived") });
    const failed = configCardView({ state: "error" }, "x", null, "c1");
    expect(failed.action).toBeNull();
    expect(failed.note).toBe("Couldn't load this config right now.");
    expect(failed.note).not.toMatch(/menu/i);
    expect(configCardView({ state: "loading" }, "x", null, "c1").action).toBeNull();
  });

  test("handles a source that was deleted, a blank start and a single proposal", () => {
    expect(configCardView(ready({ copiedFrom: { layoutId: "g", layoutName: null, revisionId: "r" } }, 1), "x", null, "c1").facts).toEqual(["Corne", "Copied from a config that has been deleted", "1 proposal waiting"]);
    expect(configCardView(ready({ copiedFrom: null }, 0), "x", null, "c1").facts).toEqual(["Corne", "No proposals waiting"]);
  });
});
