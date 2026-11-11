import { lightFor } from "../../src/web/sync/SyncStatus.tsx";
// What the header says about each keyboard state (17), and the toast for a change of state. The words are the product here:
// every state from the blueprint's table has its sentence, and a failure says why.
import { describe, expect, test } from "bun:test";
import { type BoardSync, BoardSyncSchema } from "../../src/api/http.ts";
import { autoSyncLine, refusalNotice, syncLine, syncNotice } from "../../src/web/sync/words.ts";

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
    // It opens the put-on confirm (D-300): a plain sync of another config is refused by the engine (R1-02).
    expect(syncLine(board({ kind: "in_sync" }), "lay_2")).toMatchObject({ label: "Your Glove80 runs “main”", action: { id: "put_on", label: "Put this layout on it" } });
    expect(syncLine(board({ kind: "behind", changes: 2, why: "waiting", error: null }), "lay_2").action).toEqual({ id: "put_on", label: "Put this layout on it" });
    // Not-keyloom's and not-connected are the same for any layout.
    expect(syncLine(board({ kind: "not_connected" }), "lay_2").label).toBe("Glove80 not connected");
    // No layout on screen for the board: its own state.
    expect(syncLine(board({ kind: "in_sync" }), null).label).toBe("On your Glove80");
  });

  test("another config on the keyboard offers to put the tracked one on, by name, never a menu to find", () => {
    const line = syncLine(board({ kind: "behind", changes: null, why: "other_config", error: null }), "lay_1");
    expect(line.action).toEqual({ id: "put_on", label: "Put “main” on it" });
    expect(line.detail).not.toContain("config menu");
  });

  test("a failed build opens Build and flash, where Docker's callout and the log are; other failures sync again", () => {
    const failed = (failure: string) => board({ kind: "behind", changes: 1, why: "failed", error: "Docker isn't running" }, {
      last: { id: "syn_1", trigger: "auto", status: "failed", step: "building", revisionId: "rev_1", failure, error: "Docker isn't running", startedAt: 1, finishedAt: 2, timings: { waitMs: null, buildMs: null, flashMs: null, totalMs: null } },
    });
    expect(syncLine(failed("build"), "lay_1").action).toEqual({ id: "open_release", label: "Build and flash…" });
    expect(syncLine(failed("flash"), "lay_1").action).toEqual({ id: "sync_now", label: "Sync now" });
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
    expect(autoSyncLine(board({ kind: "in_sync" }))).toEqual({ name: "Auto-sync", on: true, canTurnOn: true, note: null, exitChord: false });
  });

  // D-509: "I held it and kanata stopped" appears only after keyloom saw kanata run its config, and the note says why it isn't there.
  test("the exit-chord button waits until keyloom has seen kanata running, and says why", () => {
    const mac = (state: BoardSync["state"], exitChordReady: boolean | undefined) =>
      autoSyncLine(board(state, { remapper: true, boardName: "MacBook keyboard", auto: { on: false, choice: null, paused: false, proven: false, provenAt: null, dueAt: null, ...(exitChordReady === undefined ? {} : { exitChordReady }) } }));
    const ready = mac({ kind: "not_connected", changes: null }, true);
    expect(ready).toMatchObject({ name: "Auto-apply", exitChord: true });
    expect(ready.note).toContain("press the button below");
    const fresh = mac({ kind: "not_connected", changes: null }, false);
    expect(fresh.exitChord).toBe(false);
    expect(fresh.note).toContain("Start kanata first");
    expect(fresh.note).not.toContain("button below");
    // An older server that doesn't send the field never shows the button.
    expect(mac({ kind: "not_connected", changes: null }, undefined).exitChord).toBe(false);
    const foreign = mac({ kind: "not_keyloom", detail: "kanata runs /tmp/x.kbd" }, false);
    expect(foreign.note).toContain("replace the one it runs first");
    // Once proven there is nothing to prove.
    expect(autoSyncLine(board({ kind: "in_sync" }, { remapper: true, auto: { on: true, choice: null, paused: false, proven: true, provenAt: 1, dueAt: null, exitChordReady: false } })).exitChord).toBe(false);
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

  // R3-05: Docker's own sentence (which can name a terminal fix) stays in the build log; the toast, the line and the menu bar say this.
  test("an auto-sync build that failed because Docker wasn't ready offers Build and flash", () => {
    const raw = "Colima is running, but this account can't use its Docker socket. Quit your Docker app and open it again.";
    const docker = { ...run("failed"), failure: "build", error: raw, errorCode: "docker_unavailable" };
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: raw }, docker);
    const notice = syncNotice(at(syncing), failed);
    expect(notice).toEqual({
      kind: "error", message: "Docker isn't ready", detail: "keyloom couldn't build the change for your Glove80. Build and flash shows what Docker needs.",
      action: { id: "open_release", label: "Build and flash…" },
    });
    const line = syncLine(failed, "lay_1");
    expect(line.detail).toStartWith("Docker isn't ready");
    expect(line.action).toEqual({ id: "open_release", label: "Build and flash…" });
    expect(JSON.stringify([notice, line])).not.toContain("Quit your Docker app");
    // Any other build failure keeps its own words: they are the compiler's, and the log has the rest.
    const other = { ...run("failed"), failure: "build", error: "compile error in keymap.c", errorCode: null };
    expect(syncNotice(at(syncing), at({ kind: "behind", changes: 1, why: "failed", error: "compile error in keymap.c" }, other))?.detail).toBe("compile error in keymap.c");
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
    // The popover's checklist is the way forward; the line names no command (R1-05).
    expect(off.detail).not.toContain("keyloom doctor");
  });

  test("remapping off is its own state, and its action turns remapping back on", () => {
    expect(syncLine(mac({ kind: "behind", changes: null, why: "remapping_off", error: null }), "lay_1")).toMatchObject({ label: "Remapping is off", action: { id: "sync_now", label: "Turn remapping on" } });
  });

  test("a config keyloom didn't write offers Replace it, never a flash, and says keyloom keeps a copy", () => {
    const line = syncLine(mac({ kind: "not_keyloom", detail: "kanata is running a config keyloom didn't write" }), "lay_1");
    expect(line.action).toEqual({ id: "replace_foreign", label: "Replace it…" });
    expect(line.detail).toContain("keeps a copy");
  });

  test("the auto-apply note names the exit chord and the button, not a command", () => {
    const note = autoSyncLine(mac({ kind: "in_sync" }, { auto: { on: false, choice: null, paused: false, proven: false, provenAt: null, dueAt: null } })).note;
    expect(note).toContain("emergency exit");
    expect(note).not.toContain("keyloom remap");
    expect(syncLine(mac({ kind: "behind", changes: 1, why: "unproven", error: null }), "lay_1").detail).not.toContain("keyloom remap");
  });

  test("the switch the unproven line points at is called what the line says (R2-11)", () => {
    const unproven = mac({ kind: "behind", changes: 1, why: "unproven", error: null }, { auto: { on: false, choice: null, paused: false, proven: false, provenAt: null, dueAt: null } });
    const auto = autoSyncLine(unproven);
    expect(auto.name).toBe("Auto-apply");
    // SyncStatus labels the switch `${name} is off`; the line names that label.
    expect(syncLine(unproven, "lay_1").detail).toContain(`“${auto.name} is off”`);
  });

  test("a sync under a second says so in milliseconds", () => {
    const last = { id: "syn_1", trigger: "auto" as const, status: "succeeded" as const, step: "done", revisionId: "rev_1", failure: null, error: null, startedAt: 1, finishedAt: 2, timings: { waitMs: 3000, buildMs: null, flashMs: 120, totalMs: 340 } };
    const notice = syncNotice(mac({ kind: "syncing", step: "writing", syncId: "s", startedAt: 1, trigger: "auto" }), mac({ kind: "in_sync" }, { last }));
    expect(notice).toMatchObject({ kind: "success", detail: "340 ms from your change." });
  });
});

describe("refusalNotice", () => {
  test("each refusal code offers the control that fixes it, and never shows the CLI sentence", () => {
    const cli = "Ergo is archived; restore it first with `keyloom config restore Ergo`";
    expect(refusalNotice("archived", cli)).toMatchObject({ message: "This config is archived", action: { id: "restore", label: "Restore" } });
    expect(refusalNotice("not_on_keyboard", cli).action).toEqual({ id: "put_on", label: "Put it on…" });
    expect(refusalNotice("cant_sync", cli).action).toEqual({ id: "open_release", label: "Build and flash…" });
    expect(refusalNotice("foreign_firmware", cli).action).toEqual({ id: "open_release", label: "Build and flash…" });
    expect(refusalNotice("kanata_foreign", cli).action).toEqual({ id: "replace_foreign", label: "Replace it…" });
    // An exit-chord check that couldn't read kanata, or found it running, offers the check again rather than a dead end (D-497).
    expect(refusalNotice("kanata_unreadable", cli)).toMatchObject({ message: "keyloom couldn't tell whether kanata stopped", action: { id: "check_exit_chord", label: "Check again" } });
    expect(refusalNotice("kanata_still_running", cli).action).toEqual({ id: "check_exit_chord", label: "Check again" });
    expect(refusalNotice("kanata_not_seen", cli)).toMatchObject({ message: "keyloom hasn't seen kanata running lately", action: { id: "open_status", label: "Open keyboard status" } });
    expect(refusalNotice("kanata_not_seen", cli).detail).not.toContain("keyloom remap");
    // A stale Replace it has nothing to retry; kanata's state is in the keyboard's status, and the toast opens it (R2-14).
    expect(refusalNotice("kanata_not_foreign", cli).action).toEqual({ id: "open_status", label: "Open keyboard status" });
    expect(refusalNotice("kanata_not_running", cli).action).toEqual({ id: "open_status", label: "Open keyboard status" });
    expect(refusalNotice("keyboard_removed", cli)).toMatchObject({ message: "This keyboard was removed from your setup", action: { id: "restore_keyboard", label: "Restore" } });
    for (const code of ["archived", "not_on_keyboard", "cant_sync", "foreign_firmware", "kanata_foreign", "kanata_not_running", "not_connected", "busy", "kanata_still_running", "kanata_unreadable", "kanata_not_foreign", "keyboard_removed"]) {
      const n = refusalNotice(code, cli);
      expect(`${n.message} ${n.detail ?? ""}`).not.toContain("keyloom config");
      expect(`${n.message} ${n.detail ?? ""}`).not.toContain("`");
    }
  });

  test("an unknown code keeps the server's sentence, which is all there is", () => {
    expect(refusalNotice("usage", "the Glove80 can't be synced right now")).toEqual({ message: "keyloom couldn't do that", detail: "the Glove80 can't be synced right now" });
  });
});
