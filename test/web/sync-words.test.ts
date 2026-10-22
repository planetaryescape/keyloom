import { lightFor } from "../../src/web/sync/SyncStatus.tsx";
// What the header says about each keyboard state (17), and the toast for a change of state. The words are the product here:
// every state from the blueprint's table has its sentence, and a failure says why.
import { describe, expect, test } from "bun:test";
import { type BoardSync, BoardSyncSchema } from "../../src/api/http.ts";
import { autoSyncLine, syncLine, syncNotice } from "../../src/web/sync/words.ts";

const board = (state: BoardSync["state"], over: Partial<BoardSync> = {}): BoardSync =>
  BoardSyncSchema.parse({
    boardId: "moergo/glove80", boardName: "Glove80", layoutId: "lay_1", layoutName: "main", headRevisionId: "rev_1", otherLayouts: 0, state,
    auto: { on: true, choice: null, paused: false, proven: true, provenAt: 1, dueAt: null }, last: null, ...over,
  });

describe("syncLine", () => {
  test("in sync reads 'On your Glove80'", () => {
    expect(syncLine(board({ kind: "in_sync" }), "lay_1")).toMatchObject({ label: "On your Glove80", tone: "success", action: null });
  });

  test("syncing says the step, and never asks for anything", () => {
    const labels = (["building", "restarting", "writing", "verifying"] as const).map((step) => syncLine(board({ kind: "syncing", step, syncId: "syn_1", startedAt: 1, trigger: "auto" }), "lay_1"));
    expect(labels.map((l) => l.label)).toEqual(["Building…", "Restarting it…", "Flashing…", "Checking it came back…"]);
    expect(labels.every((l) => l.tone === "busy" && l.action === null)).toBe(true);
  });

  test("behind counts the changes, offers Sync now, and says why nothing is happening", () => {
    const behind = (changes: number | null, why: "waiting" | "auto_off" | "paused" | "unproven" | "failed" | "unknown_build" | "changed_since", error: string | null = null) =>
      syncLine(board({ kind: "behind", changes, why, error }), "lay_1");
    expect(behind(2, "waiting")).toMatchObject({ label: "2 changes not on your Glove80", action: { id: "sync_now", label: "Sync now" }, detail: "Syncing in a moment." });
    expect(behind(1, "waiting").label).toBe("1 change not on your Glove80");
    expect(behind(null, "paused").label).toBe("Changes not on your Glove80");
    expect(behind(3, "paused").detail).toBe("Auto-sync is paused.");
    expect(behind(3, "auto_off").detail).toBe("Auto-sync is off for this keyboard.");
    expect(behind(3, "unproven").detail).toContain("flashes this keyboard by itself once");
    expect(behind(3, "unknown_build").detail).toContain("won't replace it by itself");
    // A failure is the one behind that is red, and it names the error.
    expect(behind(3, "failed", "compile error in keymap.c")).toMatchObject({ tone: "error", detail: "compile error in keymap.c" });
    expect(behind(3, "paused").tone).toBe("neutral");
  });

  test("needs a hand carries the instruction and the reason", () => {
    const line = syncLine(board({ kind: "needs_hand", instruction: "Press the reset button.", reason: "keyloom couldn't restart it by itself" }), "lay_1");
    expect(line).toMatchObject({ label: "Needs a hand", tone: "warning" });
    expect(line.detail).toBe("Press the reset button. Keyloom couldn't restart it by itself.");
    // The flasher's own words already say why; the reason isn't said twice.
    const said = syncLine(board({ kind: "needs_hand", instruction: "keyloom couldn't restart the keyboard by itself (no HID). Press reset.", reason: "keyloom couldn't restart it by itself" }), "lay_1");
    expect(said.detail).toBe("keyloom couldn't restart the keyboard by itself (no HID). Press reset.");
  });

  test("not connected names the board, and firmware that isn't keyloom's offers Flash keyloom's build, not Sync now", () => {
    expect(syncLine(board({ kind: "not_connected" }), "lay_1").label).toBe("Glove80 not connected");
    // A change applied while it is unplugged is what the line says, with the amber light (D-263, P3 review).
    const waiting = board({ kind: "not_connected", changes: 1 });
    expect(syncLine(waiting, "lay_1")).toMatchObject({ label: "1 change not on your Glove80", detail: "Your Glove80 isn't connected. Plug it in and keyloom sends it." });
    expect(lightFor(waiting, syncLine(waiting, "lay_1"))).toBe("pending");
    expect(syncLine(board({ kind: "not_connected", changes: 2 }, { auto: { on: false, choice: false, paused: false, proven: true, provenAt: 1, dueAt: null } }), "lay_1").detail).toBe("Your Glove80 isn't connected. Plug it in, then sync.");
    const other = syncLine(board({ kind: "not_keyloom", detail: "USB serial moergo.com:GLV80" }), "lay_1");
    expect(other).toMatchObject({ tone: "warning", action: { id: "flash_keyloom", label: "Flash keyloom's build" } });
    expect(other.more).toContain("never replaces it by itself");
    expect(other.detail).toBe("Flash keyloom's build once to sync from then on.");
  });

  test("a keyboard that runs another layout of the board says so and offers to put this one on it", () => {
    expect(syncLine(board({ kind: "in_sync" }), "lay_2")).toMatchObject({ label: "Your Glove80 runs “main”", action: { id: "sync_now", label: "Put this layout on it" } });
    // Not-keyloom's and not-connected are the same for any layout.
    expect(syncLine(board({ kind: "not_connected" }), "lay_2").label).toBe("Glove80 not connected");
    // No layout on screen for the board: its own state.
    expect(syncLine(board({ kind: "in_sync" }), null).label).toBe("On your Glove80");
  });

  test("every state has a short word for a phone", () => {
    const states: BoardSync["state"][] = [
      { kind: "in_sync" }, { kind: "syncing", step: "building", syncId: "s", startedAt: 1, trigger: "auto" }, { kind: "behind", changes: 1, why: "waiting", error: null },
      { kind: "needs_hand", instruction: "x", reason: "y" }, { kind: "not_connected" }, { kind: "not_keyloom", detail: "d" },
    ];
    for (const s of states) expect(syncLine(board(s), "lay_1").short.length).toBeGreaterThan(0);
  });
});

describe("autoSyncLine", () => {
  test("auto-sync can't be turned on until it is proven, and says why", () => {
    const unproven = board({ kind: "in_sync" }, { auto: { on: false, choice: null, paused: false, proven: false, provenAt: null, dueAt: null } });
    expect(autoSyncLine(unproven)).toMatchObject({ on: false, canTurnOn: false });
    expect(autoSyncLine(unproven).note).toContain("by itself once");
    expect(autoSyncLine(board({ kind: "in_sync" }))).toEqual({ on: true, canTurnOn: true, note: null });
  });
});

describe("syncNotice", () => {
  const at = (state: BoardSync["state"], last: BoardSync["last"] = null) => board(state, { last });
  const syncing: BoardSync["state"] = { kind: "syncing", step: "writing", syncId: "s", startedAt: 1, trigger: "auto" };
  const timings = { waitMs: 3000, buildMs: 20_000, flashMs: 18_000, totalMs: 41_000 };
  const run = (status: "succeeded" | "failed") => ({ id: "s", trigger: "auto" as const, status, step: "done", revisionId: "rev_1", failure: null, error: null, startedAt: 1, finishedAt: 2, timings });

  test("a change that reached the keyboard says so, with the time", () => {
    expect(syncNotice(at(syncing), at({ kind: "in_sync" }, run("succeeded")))).toEqual({
      kind: "success", message: "On your Glove80", detail: "41 s from your change.",
    });
  });

  test("a failed sync says what failed", () => {
    expect(syncNotice(at(syncing), at({ kind: "behind", changes: 1, why: "failed", error: "zapp exited with code 1" }))).toEqual({
      kind: "error", message: "Couldn't put the change on your Glove80", detail: "zapp exited with code 1",
    });
  });

  test("a failed latest sync cannot produce a success toast from a stale in-sync reading", () => {
    const failed = { ...run("failed"), error: "the left half is absent" };
    expect(syncNotice(at(syncing), at({ kind: "in_sync" }, failed))).toMatchObject({ kind: "error", detail: failed.error });
  });

  test("a final recovery error is news even when the bootloader prompt already needed a hand", () => {
    const error = "Rollback is incomplete. The left half is absent or in its bootloader.";
    expect(syncNotice(at({ kind: "needs_hand", instruction: "Restore the left half", reason: "" }), at({ kind: "needs_hand", instruction: error, reason: "" }, run("failed"))))
      .toMatchObject({ kind: "error", detail: error });
  });

  test("needing a hand is news, whatever came before", () => {
    expect(syncNotice(at(syncing), at({ kind: "needs_hand", instruction: "Press reset", reason: "r" }))).toMatchObject({ kind: "error", message: "Your Glove80 needs a hand", detail: "Press reset" });
  });

  test("the first state, an unchanged state and a quiet change say nothing", () => {
    expect(syncNotice(undefined, at({ kind: "in_sync" }))).toBeNull();
    expect(syncNotice(at({ kind: "in_sync" }), at({ kind: "in_sync" }))).toBeNull();
    expect(syncNotice(at({ kind: "in_sync" }), at({ kind: "not_connected" }))).toBeNull();
    expect(syncNotice(at({ kind: "behind", changes: 1, why: "waiting", error: null }), at(syncing))).toBeNull();
  });
});

describe("a software remapper (the MacBook's keyboard)", () => {
  const mac = (state: BoardSync["state"], over: Partial<BoardSync> = {}) => board(state, { boardId: "apple/macbook-ansi", boardName: "MacBook keyboard (ANSI)", remapper: true, ...over });

  test("says writing, not flashing, and never asks to be plugged in", () => {
    expect(syncLine(mac({ kind: "syncing", step: "writing", syncId: "syn_1", startedAt: 1, trigger: "auto" }), "lay_1").label).toBe("Writing…");
    const off = syncLine(mac({ kind: "not_connected" }), "lay_1");
    expect(off.label).toBe("kanata isn't running");
    expect(off.detail).not.toMatch(/plug/i);
  });

  test("remapping off is its own state, and its action turns remapping back on", () => {
    expect(syncLine(mac({ kind: "behind", changes: null, why: "remapping_off", error: null }), "lay_1")).toMatchObject({ label: "Remapping is off", action: { id: "sync_now", label: "Turn remapping on" } });
  });

  test("a config keyloom didn't write offers no flash", () => {
    expect(syncLine(mac({ kind: "not_keyloom", detail: "kanata is running a config keyloom didn't write" }), "lay_1").action).toBeNull();
  });

  test("the auto-apply note names the exit chord, not a flash", () => {
    expect(autoSyncLine(mac({ kind: "in_sync" }, { auto: { on: false, choice: null, paused: false, proven: false, provenAt: null, dueAt: null } })).note).toContain("emergency exit");
  });

  test("a sync under a second says so in milliseconds", () => {
    const last = { id: "syn_1", trigger: "auto" as const, status: "succeeded" as const, step: "done", revisionId: "rev_1", failure: null, error: null, startedAt: 1, finishedAt: 2, timings: { waitMs: 3000, buildMs: null, flashMs: 120, totalMs: 340 } };
    const notice = syncNotice(mac({ kind: "syncing", step: "writing", syncId: "s", startedAt: 1, trigger: "auto" }), mac({ kind: "in_sync" }, { last }));
    expect(notice).toMatchObject({ kind: "success", detail: "340 ms from your change." });
  });
});
