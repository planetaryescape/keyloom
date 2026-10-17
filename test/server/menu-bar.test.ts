// The words the menu-bar extra shows come from the server (D-325), so they are tested here rather than in the Rust shell.
import { describe, expect, test } from "bun:test";
import { MenuBarSchema, type BoardSync } from "../../src/api/http.ts";
import { menuBar } from "../../src/server/menu-bar.ts";

const board = (id: string, name: string, state: BoardSync["state"], extra: Partial<BoardSync> = {}): BoardSync => ({
  boardId: id, boardName: name, layoutId: `lay_${id}`, layoutName: "Mine", headRevisionId: "rev_1", otherLayouts: 0, state,
  auto: { on: true, choice: null, paused: false, proven: true, provenAt: null, dueAt: null }, last: null, ...extra,
});

const moon = (state: BoardSync["state"]) => board("zsa/moonlander", "Moonlander", state);
const glove = board("moergo/glove80", "Glove80", { kind: "in_sync" });

describe("menuBar", () => {
  test("says what the header says, per board, and nothing needs looking at when every board is in sync or idle", () => {
    const bar = menuBar([glove, moon({ kind: "not_connected", changes: null })], undefined);
    expect(MenuBarSchema.parse(bar)).toBeTruthy();
    expect(bar.lines.map((l) => l.text)).toEqual(["On your Glove80", "Moonlander not connected"]);
    expect(bar.summary).toBe("All keyboards are on their latest change");
    expect(bar.title).toBeNull();
    expect(bar.syncLayoutId).toBeNull();
  });

  test("a board behind decides the summary, the title and what Sync now targets", () => {
    const bar = menuBar([glove, moon({ kind: "behind", changes: 2, why: "auto_off", error: null })], undefined);
    expect(bar.summary).toBe("2 changes not on your Moonlander");
    expect(bar.title).toBe("Behind");
    expect(bar.syncLayoutId).toBe("lay_zsa/moonlander");
  });

  test("an unplugged board with changes waiting counts as needing a look, but cannot be synced", () => {
    const bar = menuBar([glove, moon({ kind: "not_connected", changes: 1 })], undefined);
    expect(bar.summary).toBe("1 change not on your Moonlander");
    expect(bar.syncLayoutId).toBeNull();
  });

  test("needs a hand outranks behind", () => {
    const bar = menuBar([moon({ kind: "behind", changes: 1, why: "waiting", error: null }), board("a/b", "Corne", { kind: "needs_hand", instruction: "Hold the reset button", reason: "it did not restart" })], undefined);
    expect(bar.title).toBe("Needs a hand");
  });

  test("notices are what changed since the previous frame on the stream, and the first frame has none", () => {
    const syncing = moon({ kind: "syncing", step: "writing", syncId: "syn_1", startedAt: 0, trigger: "manual" });
    const done = moon({ kind: "in_sync" });
    expect(menuBar([done], undefined).notices).toEqual([]);
    expect(menuBar([done], [syncing]).notices).toEqual([{ title: "On your Moonlander", body: "" }]);
    expect(menuBar([done], [done]).notices).toEqual([]);
    const failed = moon({ kind: "behind", changes: 1, why: "failed", error: "no device" });
    expect(menuBar([failed], [syncing]).notices).toEqual([{ title: "Couldn't put the change on your Moonlander", body: "no device" }]);
  });

  test("no boards", () => {
    expect(menuBar([], undefined).summary).toBe("No keyboards");
  });
});
