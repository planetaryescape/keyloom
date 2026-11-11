// What the release dialog and the proposal card say from the server's codes (D-501, R2-01): a permission opens its pane, Check the
// keyboard again says what it found, and the line after Apply tells the truth for the keyboard.
import { describe, expect, test } from "bun:test";
import { type BoardSync, BoardSyncSchema } from "../../src/api/http.ts";
import { afterApply, buildCancelProblem, checkOutcome, failedFlashText, permissionFix, revisionChoices, cancelNote } from "../../src/web/release/flash-words.ts";

const synced = (over: Partial<BoardSync> = {}, auto: Partial<BoardSync["auto"]> = {}): BoardSync =>
  BoardSyncSchema.parse({
    boardId: "moergo/glove80", boardName: "Glove80", layoutId: "lay_1", layoutName: "main", headRevisionId: "rev_1", otherLayouts: 0, state: { kind: "in_sync" },
    auto: { on: true, choice: null, paused: false, proven: true, provenAt: 1, dueAt: null, ...auto }, last: null, ...over,
  });
const MACBOOK = { firmware: "kanata", name: "MacBook keyboard" };
const GLOVE = { firmware: "zmk", name: "Glove80" };
const macSync = (auto: Partial<BoardSync["auto"]> = {}, over: Partial<BoardSync> = {}) =>
  synced({ boardId: "apple/macbook-ansi", boardName: "MacBook keyboard", remapper: true, ...over }, auto);

describe("permissionFix", () => {
  test("each permission code opens its own pane, with a button that says so", () => {
    expect(permissionFix("permission_files_and_folders")).toMatchObject({ pane: "files_and_folders", button: "Open Files and Folders settings" });
    expect(permissionFix("permission_input_monitoring")).toMatchObject({ pane: "input_monitoring", button: "Open Input Monitoring settings" });
    expect(permissionFix(null)).toBeNull();
    expect(permissionFix(undefined)).toBeNull();
  });

  test("never names the terminal or a command", () => {
    for (const code of ["permission_files_and_folders", "permission_input_monitoring"] as const) {
      expect(permissionFix(code)?.text).not.toMatch(/terminal|sudo|`|System Settings >/i);
      expect(permissionFix(code)?.failed).not.toMatch(/terminal|sudo|`|System Settings >/i);
    }
  });
});

describe("failedFlashText", () => {
  test("a permission failure leads with plain words and keeps the server's sentence, which says how a split board's recovery went", () => {
    const error = "Copying to the left half failed: EACCES. The left half was not flashed. keyloom put build AAAAAAAAAAAA back on the right half.";
    expect(failedFlashText("permission_files_and_folders", error)).toEqual({ lead: "macOS didn't let keyloom write to the keyboard's drive, so that part wasn't flashed.", detail: error });
  });

  test("a write that finished but couldn't be confirmed says the firmware was written, then the server's reason", () => {
    const error = "zapp finished, but the Moonlander didn't come back";
    expect(failedFlashText("not_confirmed", error)).toEqual({ lead: "keyloom wrote the firmware, but couldn't confirm the keyboard runs it.", detail: error });
  });

  test("any other failure is the server's sentence alone", () => {
    expect(failedFlashText(null, "zapp exited with code 1")).toEqual({ lead: null, detail: "zapp exited with code 1" });
    expect(failedFlashText("cancelled", "Cancelled. Nothing was flashed.")).toEqual({ lead: null, detail: "Cancelled. Nothing was flashed." });
    expect(failedFlashText(null, null)).toEqual({ lead: null, detail: "Flashing failed." });
  });
});

describe("revisionChoices", () => {
  test("the question's answers are the board's own revisions, by label and hint, or by ID when it names none", async () => {
    const moonlander = (await Bun.file(`${import.meta.dir}/../../boards/zsa/moonlander/board.json`).json()) as { revisions: Array<{ id: string; label?: string; hint?: string }> };
    expect(revisionChoices(moonlander.revisions)).toEqual([
      { value: "reva", label: "Rev A", hint: "Bought before mid-December 2025" },
      { value: "revb", label: "Rev B", hint: "Bought after mid-December 2025" },
    ]);
    expect(revisionChoices([{ id: "rev1" }, { id: "rev2", label: "Rev 2" }])).toEqual([{ value: "rev1", label: "rev1" }, { value: "rev2", label: "Rev 2" }]);
  });
});

describe("checkOutcome", () => {
  test("this build is a success with nothing more to do", () => {
    expect(checkOutcome("this_build", "Moonlander")).toEqual({ tone: "success", text: "Your Moonlander runs this build. The flash is verified.", next: null });
  });

  test("a keyboard that can't be seen yet asks to check again; one on the wrong firmware asks to flash again", () => {
    expect(checkOutcome("absent", "Moonlander").next).toBe("check");
    expect(checkOutcome("missing_halves", "Glove80").next).toBe("check");
    for (const found of ["other_build", "bootloader", "other_firmware"] as const) expect(checkOutcome(found, "Moonlander").next).toBe("flash");
  });

  test("a keyboard on a later build is not offered Flash again, which would roll it back", () => {
    expect(checkOutcome("later_build", "Moonlander")).toEqual({ tone: "success", text: "Your Moonlander now runs a later keyloom build, which replaced this one. There is nothing to flash.", next: null });
  });
});

describe("afterApply", () => {
  test("the MacBook keyboard is never offered Build and flash", () => {
    const lines = [
      afterApply(MACBOOK, undefined, "lay_1"),
      afterApply(MACBOOK, macSync({ on: false }), "lay_1"),
      afterApply(MACBOOK, macSync({ paused: true }), "lay_1"),
      afterApply(MACBOOK, macSync(), "lay_1"),
      afterApply(MACBOOK, macSync({}, { layoutId: "lay_2", layoutName: "other" }), "lay_1"),
    ];
    for (const line of lines) {
      expect(line.action?.id).not.toBe("open_release");
      expect(`${line.lead} ${line.text} ${line.toast}`).not.toMatch(/Build|flash/);
    }
  });

  test("the MacBook keyboard offers Apply now unless auto-apply puts it on by itself", () => {
    expect(afterApply(MACBOOK, macSync({ on: false }), "lay_1")).toMatchObject({ action: { id: "apply_now", label: "Apply now" } });
    expect(afterApply(MACBOOK, macSync({ paused: true }), "lay_1").action?.id).toBe("apply_now");
    expect(afterApply(MACBOOK, undefined, "lay_1").action?.id).toBe("apply_now");
    expect(afterApply(MACBOOK, macSync(), "lay_1")).toEqual({
      lead: "Applied.", text: "Auto-apply puts it on your MacBook keyboard in a moment. Undo above the board takes it back.", toast: "Auto-apply puts it on your MacBook keyboard.", action: null,
    });
  });

  test("a keyboard running another layout offers to put this one on, not a sync that would be refused", () => {
    expect(afterApply(MACBOOK, macSync({}, { layoutId: "lay_2", layoutName: "Coding" }), "lay_1")).toMatchObject({
      text: "Your MacBook keyboard runs “Coding”, so this one isn't on it.", action: { id: "put_on" },
    });
  });

  test("a keyboard that auto-syncs says it gets the change by itself, and never claims it isn't on the keyboard", () => {
    const line = afterApply(GLOVE, synced(), "lay_1");
    expect(line).toEqual({ lead: "Applied.", text: "Auto-sync builds it and puts it on your Glove80 by itself. Undo above the board takes it back.", toast: "Auto-sync puts it on your Glove80.", action: null });
  });

  test("auto-sync off or paused, or firmware keyloom didn't build, keeps Build and flash", () => {
    expect(afterApply(GLOVE, synced({}, { on: false }), "lay_1").action?.id).toBe("open_release");
    expect(afterApply(GLOVE, synced({}, { paused: true }), "lay_1").action?.id).toBe("open_release");
    expect(afterApply(GLOVE, synced({ state: { kind: "not_keyloom", detail: "USB serial x" } }), "lay_1").action?.id).toBe("open_release");
    expect(afterApply(GLOVE, undefined, "lay_1")).toMatchObject({ text: "It isn't on your keyboard yet, and Undo above the board takes it back.", action: { id: "open_release", label: "Build and flash" } });
  });

  test("auto-sync is promised only where it will run: an unplugged keyboard waits for USB, and one that needs a hand or failed gets the button", () => {
    const behind = (why: string, error: string | null = null) => ({ kind: "behind", changes: 1, why, error }) as BoardSync["state"];
    for (const state of [{ kind: "in_sync" }, behind("waiting"), { kind: "syncing", step: "building", syncId: "syn_1", startedAt: 1, trigger: "auto" }] as BoardSync["state"][]) {
      expect(afterApply(GLOVE, synced({ state }), "lay_1").text).toStartWith("Auto-sync builds it and puts it on your Glove80 by itself.");
    }
    expect(afterApply(GLOVE, synced({ state: { kind: "not_connected", changes: 1 } }), "lay_1")).toEqual({
      lead: "Applied.", text: "Auto-sync puts it on your Glove80 when you connect it by USB. Undo above the board takes it back.",
      toast: "Auto-sync puts it on your Glove80 when you connect it by USB.", action: null,
    });
    const stuck: BoardSync["state"][] = [
      { kind: "needs_hand", instruction: "Press the reset button.", reason: "x" }, behind("failed", "zapp exited with code 1"), behind("unknown_build"), behind("changed_since"),
    ];
    for (const state of stuck) expect(afterApply(GLOVE, synced({ state }), "lay_1").action).toEqual({ id: "open_release", label: "Build and flash" });
  });

  test("auto-apply is promised only while kanata can take it; Apply now only where it can work (R3-03)", () => {
    // Not running: Apply now would be refused, so the card opens kanata's setup checklist instead.
    expect(afterApply(MACBOOK, macSync({}, { state: { kind: "not_connected" } }), "lay_1")).toMatchObject({
      text: "kanata isn't running, so it isn't on your MacBook keyboard yet. Undo above the board takes it back.", action: { id: "open_status", label: "Open keyboard status" },
    });
    expect(afterApply(MACBOOK, macSync({ on: false }, { state: { kind: "not_connected" } }), "lay_1").action?.id).toBe("open_status");
    // Someone else's config: keyloom never replaces it by itself, so the card offers the confirm that does.
    expect(afterApply(MACBOOK, macSync({}, { state: { kind: "not_keyloom", detail: "kanata runs /tmp/x.kbd" } }), "lay_1").action).toEqual({ id: "replace_foreign", label: "Replace it…" });
    expect(afterApply(MACBOOK, macSync({}, { state: { kind: "behind", changes: 1, why: "failed", error: "reload failed" } }), "lay_1").action?.id).toBe("apply_now");
    // keyloom.kbd on disk isn't keyloom's: auto-apply and Apply now would be refused again, so the card offers Replace it (R4 residual 2).
    const last = { id: "syn_1", trigger: "manual" as const, status: "failed" as const, step: "done", revisionId: "rev_1", failure: "foreign_file", errorCode: "foreign_file", error: "x", startedAt: 1, finishedAt: 2, timings: { waitMs: null, buildMs: null, flashMs: null, totalMs: null } };
    expect(afterApply(MACBOOK, macSync({}, { state: { kind: "behind", changes: 1, why: "waiting", error: null }, last }), "lay_1").action).toEqual({ id: "replace_foreign", label: "Replace it…" });
    // A kanata that stopped since gets its setup first: Replace it would be refused while kanata isn't running (#290 review).
    expect(afterApply(MACBOOK, macSync({}, { state: { kind: "not_connected" }, last }), "lay_1").action?.id).toBe("open_status");
    // Without the code (remapping was turned off since), the failure no longer offers Replace it.
    expect(afterApply(MACBOOK, macSync({}, { state: { kind: "behind", changes: 1, why: "auto_off", error: null }, last: { ...last, errorCode: null } }), "lay_1").action?.id).toBe("apply_now");
  });

  test("once the sync view has this change, the line follows it: applying now, then on the keyboard with no button", () => {
    const off = (state: BoardSync["state"], head = "rev_2") => afterApply(MACBOOK, macSync({ on: false }, { state, headRevisionId: head }), "lay_1", "rev_2");
    expect(off({ kind: "behind", changes: 1, why: "auto_off", error: null }).action?.id).toBe("apply_now");
    expect(off({ kind: "syncing", step: "writing", syncId: "syn_1", startedAt: 1, trigger: "manual" })).toMatchObject({ text: "keyloom is applying it to your MacBook keyboard now. Undo above the board takes it back.", action: null });
    expect(off({ kind: "in_sync" })).toEqual({ lead: "Applied.", text: "It is on your MacBook keyboard. Undo above the board takes it back.", toast: "It is on your MacBook keyboard.", action: null });
    // A view from before the Apply (the toast's) is in sync with the old head, which says nothing about this change.
    expect(off({ kind: "in_sync" }, "rev_1").action?.id).toBe("apply_now");
    expect(afterApply(GLOVE, synced({ state: { kind: "in_sync" }, headRevisionId: "rev_2" }, { on: false }), "lay_1", "rev_2").action).toBeNull();
  });
});

describe("a Cancel that didn't reach keyloom says so (R3-20)", () => {
  test("a flash's Cancel and a build's Cancel each name the failure and the way on", () => {
    expect(cancelNote({ refused: "unreachable" })).toBe("keyloom didn't answer, so the flash may still be waiting. Check that keyloom is running, then cancel again.");
    expect(cancelNote({ refused: undefined })).toBe("keyloom couldn't stop the flash. Cancel again.");
    expect(buildCancelProblem("unreachable")).toContain("the build may still be running");
    expect(buildCancelProblem("internal")).toContain("Cancel again");
  });
});

describe("cancelNote", () => {
  test("a Cancel refused because the write began says why the flash goes on, from the code and not the server's sentence", () => {
    expect(cancelNote({ refused: "flash_writing" })).toContain("couldn't stop the flash safely");
    // A flash that already ended speaks for itself.
    expect(cancelNote({ refused: "flash_finished" })).toBeNull();
  });

  test("a Cancel accepted while the flash still waits says keyloom is stopping it, and that a keyboard in its bootloader is written first", () => {
    expect(cancelNote({ status: "waiting_for_bootloader" })).toContain("Stopping the flash");
    expect(cancelNote({ status: "failed" })).toBeNull();
  });
});
