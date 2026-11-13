import { lightFor } from "../../src/web/sync/SyncStatus.tsx";
// What the header says about each keyboard state (17), and the toast for a change of state. The words are the product here:
// every state from the blueprint's table has its sentence, and a failure says why.
import { describe, expect, test } from "bun:test";
import { type BoardSync, BoardSyncSchema } from "../../src/api/http.ts";
import { autoSyncLine, noticeOnPage, refusalNotice, settingsOpenFailure, syncLine, syncNotice } from "../../src/web/sync/words.ts";

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
    // keyloom keeps its own lower case at the start of the reason (R9-01).
    expect(line.detail).toBe("Press the reset button. keyloom couldn't restart it by itself.");
    // A reason that isn't keyloom's name starts with a capital.
    expect(syncLine(board({ kind: "needs_hand", instruction: "Unplug it.", reason: "it is in its bootloader" }), "lay_1").detail).toBe("Unplug it. It is in its bootloader.");
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

  test("a board keyloom sees only once its firmware is on it offers Build and flash, not \"not connected\" (R6-10)", () => {
    const first = syncLine(board({ kind: "not_connected", firstFlash: true }, { boardName: "Corne" }), "lay_1");
    expect(first).toMatchObject({ detail: "keyloom sees your Corne once keyloom's firmware is on it.", action: { id: "open_release", label: "Build and flash…" } });
    expect(first.label).not.toContain("not connected");
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

  test("a notice with no button is the same on any page", () => {
    const notice = syncNotice(at(syncing), at({ kind: "behind", changes: 1, why: "failed", error: "zapp exited with code 1" }));
    if (notice === null) throw new Error("expected a notice");
    expect(noticeOnPage(notice, at({ kind: "in_sync" }), { boardId: "zsa/moonlander", layoutId: "lay_9" })).toBe(notice);
  });

  test("a failed sync says what failed", () => {
    expect(syncNotice(at(syncing), at({ kind: "behind", changes: 1, why: "failed", error: "zapp exited with code 1" }))).toEqual({
      kind: "error", message: "Couldn't put the change on your Glove80", detail: "zapp exited with code 1",
    });
  });

  // R3-05: Docker's own sentence (which can name a terminal fix) stays in the build log; the toast, the line and the menu bar say this.
  test("an auto-sync build that failed because Docker wasn't ready offers Build and flash", () => {
    const raw = "Colima is running, but this account can't use its Docker socket. Quit your Docker app and open it again.";
    const docker = { ...run("failed"), failure: "build", error: raw, errorCode: "docker_unavailable", buildId: "bld_d" };
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: raw }, docker);
    const notice = syncNotice(at(syncing), failed);
    expect(notice).toEqual({
      kind: "error", message: "Docker isn't ready", detail: "keyloom couldn't build the change for your Glove80. Build and flash shows what Docker needs.",
      action: { id: "open_release", label: "Build and flash…", buildId: "bld_d" },
    });
    const line = syncLine(failed, "lay_1");
    expect(line.detail).toStartWith("Docker isn't ready");
    expect(line.action).toEqual({ id: "open_release", label: "Build and flash…", buildId: "bld_d" });
    expect(JSON.stringify([notice, line])).not.toContain("Quit your Docker app");
    // Build and flash acts on the layout on screen: on the Glove80's page the notice keeps it, on another board's page it opens the Glove80.
    if (notice === null) throw new Error("expected a notice");
    expect(noticeOnPage(notice, failed, { boardId: "moergo/glove80", layoutId: "lay_1" })).toBe(notice);
    expect(noticeOnPage(notice, failed, { boardId: "zsa/moonlander", layoutId: "lay_9" })).toEqual({
      kind: "error", message: "Docker isn't ready",
      detail: "keyloom couldn't build the change for your Glove80. Build and flash shows what Docker needs. Its page has Build and flash.",
      action: { id: "open_board", label: "Open Glove80" },
    });
    // A build failure with no code says the build failed, never the CLI's sentence, and opens Build and flash on that build (R8-01).
    const other = { ...run("failed"), failure: "build", error: "build bld_1 failed: compile error in keymap.c (log: /x/build.log)", errorCode: null, buildId: "bld_1" };
    expect(syncNotice(at(syncing), at({ kind: "behind", changes: 1, why: "failed", error: other.error }, other))).toEqual({
      kind: "error", message: "Couldn't build the change for your Glove80", detail: "The firmware build failed. Build and flash shows its log and can build it again.",
      action: { id: "open_release", label: "Build and flash…", buildId: "bld_1" },
    });
  });

  // PR #306 review: the person moved to config B of the same Glove80 while A's sync built. Build and flash here would open B's dialog on
  // A's build, which hides it as an older version; the toast opens A instead, whose pill has Build and flash on that build.
  test("a failed sync of another config of this keyboard opens that config, never this config's Build and flash", () => {
    const failedRun = { ...run("failed"), failure: "build", error: "build bld_A failed", errorCode: "disk_full", buildId: "bld_A" };
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: failedRun.error }, failedRun);
    const notice = syncNotice(at(syncing), failed);
    if (notice === null) throw new Error("expected a notice");
    expect(notice.action).toEqual({ id: "open_release", label: "Build and flash…", buildId: "bld_A" });
    expect(noticeOnPage(notice, failed, { boardId: "moergo/glove80", layoutId: "lay_B" })).toEqual({
      kind: "error", message: "Couldn't build the change for your Glove80",
      detail: "Docker ran out of disk space, so the build stopped. Build and flash can free Docker's build cache. main's page has Build and flash.",
      action: { id: "open_config", label: "Open main", layoutId: "lay_1" },
    });
  });

  // R8-01: every code a sync's build can carry says what the code means, on the pill and the toast, and never the build's sentence.
  test("a sync whose build failed shows the code's own words and opens Build and flash on that build", () => {
    const cli = "build bld_9 failed: Docker still shows an old copy … restart it with `colima restart`, or move XDG_CACHE_HOME … (log: /x/b.log)";
    const words: Record<string, string> = {
      stale_mount: "Docker kept showing the build an old copy of the files keyloom wrote, so the build stopped before it used them. Build and flash shows how to clear it.",
      stuck_container: "A build container that an earlier keyloom left running couldn't be removed, so the build stopped before it started. Build and flash shows how to clear it.",
      folder_not_shared: "Docker can't see the folder keyloom builds in, so the build stopped before it started. Build and flash says where to share it.",
      disk_full: "Docker ran out of disk space, so the build stopped. Build and flash can free Docker's build cache.",
      compile_error: "The firmware didn't compile from this layout. Building it again fails the same way. Build and flash shows the error, and can ask keyloom about it.",
      too_large: "The firmware is too big for the keyboard's memory. Building it again fails the same way. Build and flash shows the error, and can ask keyloom about it.",
      source_error: "keyloom couldn't write this layout as the firmware's source. Building it again fails the same way. Build and flash shows the error, and can ask keyloom about it.",
      docker_unavailable: "Docker isn't ready, so keyloom couldn't build the change. Build and flash shows what Docker needs, with a button to fix it.",
      some_future_code: "The firmware build failed. Build and flash shows its log and can build it again.",
    };
    for (const [errorCode, detail] of Object.entries(words)) {
      const last = { ...run("failed"), failure: "build", error: cli, errorCode, buildId: "bld_9" };
      const failed = at({ kind: "behind", changes: 1, why: "failed", error: cli }, last);
      const line = syncLine(failed, "lay_1");
      expect(line.detail).toBe(detail);
      expect(line.action).toEqual({ id: "open_release", label: "Build and flash…", buildId: "bld_9" });
      const notice = syncNotice(at(syncing), failed);
      if (errorCode !== "docker_unavailable") expect(notice).toEqual({ kind: "error", message: "Couldn't build the change for your Glove80", detail, action: { id: "open_release", label: "Build and flash…", buildId: "bld_9" } });
      expect(JSON.stringify([line, notice])).not.toMatch(/`|colima restart|XDG_CACHE_HOME|log:/);
    }
  });

  test("a sync whose build was stopped offers Sync now, and its toast has nothing to open", () => {
    const last = { ...run("failed"), failure: "build", error: "Build stopped.", errorCode: "cancelled", buildId: "bld_2" };
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: "Build stopped." }, last);
    expect(syncLine(failed, "lay_1")).toMatchObject({ detail: "The build was stopped before it finished, so nothing changed on the keyboard.", action: { id: "sync_now", label: "Sync now" } });
    expect(syncNotice(at(syncing), failed)).toEqual({ kind: "error", message: "Couldn't build the change for your Glove80", detail: "The build was stopped before it finished, so nothing changed on the keyboard." });
  });

  test("a sync whose Moonlander write timed out says so in the page's words, never the --build flag (R8-11)", () => {
    const cli = "Flashing didn't finish within 3 minutes and was stopped. The keyboard may be left in its bootloader: flash again, or `keyloom flash --build <an earlier build>`.";
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: cli }, { ...run("failed"), failure: "flash", error: cli, errorCode: "write_timeout" });
    const words = "Flashing didn't finish within 3 minutes, so keyloom stopped it. The keyboard may be left in its bootloader, where it doesn't type. Sync now flashes it again.";
    expect(syncLine(failed, "lay_1")).toMatchObject({ detail: words, action: { id: "sync_now", label: "Sync now" } });
    expect(syncNotice(at(syncing), failed)?.detail).toBe(words);
  });

  // R9-01: the dialog's permission fix, on the pill, its needs-hand line and the toast.
  const FILES_CLI = "Copying to /Volumes/GLV80RHBOOT/CURRENT.UF2 failed: EACCES: permission denied. The right half was not flashed. keyloom wasn't allowed to write to the drive. On macOS, give the app running keyloom access to removable volumes in System Settings > Privacy & Security > Files & Folders, then flash again.";
  const FILES_WORDS = "macOS didn't let keyloom write to the keyboard's drive, so that part wasn't flashed. Allow the app running keyloom (the keyloom app, or your terminal when keyloom runs in one) to use removable volumes, then sync again.";
  test("a sync whose drive write macOS refused opens Files and Folders settings, with Sync now second (R9-01)", () => {
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: FILES_CLI }, { ...run("failed"), failure: "flash", error: FILES_CLI, errorCode: "permission_files_and_folders" });
    const line = syncLine(failed, "lay_1");
    expect(line).toMatchObject({ detail: FILES_WORDS, tone: "error", action: { id: "open_settings", label: "Open Files and Folders settings", pane: "files_and_folders" }, second: { id: "sync_now", label: "Sync now" } });
    // The flasher's sentence names the path the button opens; it stays behind Details for what it says about each half.
    expect(line.detail).not.toContain("System Settings >");
    expect(line.more).toContain("The right half was not flashed");
    expect(syncNotice(at(syncing), failed)).toMatchObject({ detail: FILES_WORDS, action: { id: "open_settings", label: "Open Files and Folders settings", pane: "files_and_folders" } });
  });
  test("a split board left needing a hand by the same refusal gets the same button (R9-01)", () => {
    const hand = at({ kind: "needs_hand", instruction: FILES_CLI, reason: "" }, { ...run("failed"), failure: "flash", error: FILES_CLI, errorCode: "permission_files_and_folders" });
    expect(syncLine(hand, "lay_1")).toMatchObject({ label: "Needs a hand", detail: FILES_WORDS, action: { id: "open_settings", pane: "files_and_folders" }, second: { id: "sync_now", label: "Sync now" } });
    expect(syncLine(hand, "lay_1").more).toContain("The right half was not flashed");
    expect(syncNotice(at(syncing), hand)).toMatchObject({ message: "Your Glove80 needs a hand", detail: FILES_WORDS, action: { id: "open_settings", pane: "files_and_folders" } });
  });
  test("a Moonlander waiting for a hand without Input Monitoring offers its settings, says it once, and in keyloom's case (R9-01)", () => {
    const instruction = "macOS didn't let keyloom restart the keyboard by itself. Press the reset button on the Moonlander within 2 minutes.";
    const state: BoardSync["state"] = { kind: "needs_hand", instruction, reason: "keyloom couldn't restart it by itself", instructionCode: "permission_input_monitoring" };
    const waiting = at(state, { ...run("failed"), status: "flashing", step: "needs_hand", finishedAt: null });
    const line = syncLine(waiting, "lay_1");
    expect(line.detail).toBe(`${instruction} Allow the app running keyloom (the keyloom app, or your terminal when keyloom runs in one) in Input Monitoring, and the next sync needs no keypress.`);
    expect(line.detail).not.toContain("Keyloom");
    expect(line).toMatchObject({ action: { id: "open_settings", label: "Open Input Monitoring settings", pane: "input_monitoring" } });
    // While it still waits, pressing the key is the way on; Sync now comes once the sync has ended.
    expect(line.second).toBeUndefined();
    expect(syncLine(at(state, { ...run("failed"), failure: "needs_hand" }), "lay_1").second).toEqual({ id: "sync_now", label: "Sync now" });
    expect(syncNotice(at(syncing), waiting)).toMatchObject({ message: "Your Glove80 needs a hand", action: { id: "open_settings", pane: "input_monitoring" } });
  });
  test("an Input Monitoring refusal that ended the flash says what to allow (R9-01)", () => {
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: "x" }, { ...run("failed"), failure: "flash", error: "x", errorCode: "permission_input_monitoring" });
    expect(syncLine(failed, "lay_1")).toMatchObject({ detail: "macOS didn't let keyloom restart the keyboard by itself. Allow the app running keyloom (the keyloom app, or your terminal when keyloom runs in one) in Input Monitoring, and the next sync needs no keypress.", action: { pane: "input_monitoring" } });
  });
  test("a write keyloom couldn't confirm says so first, as the dialog does", () => {
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: "The keyboard didn't come back." }, { ...run("failed"), failure: "flash", error: "The keyboard didn't come back.", errorCode: "not_confirmed" });
    expect(syncLine(failed, "lay_1").detail).toBe("keyloom wrote the firmware, but couldn't confirm the keyboard runs it. The keyboard didn't come back.");
  });
  test("System Settings that didn't open says where the setting is", () => {
    expect(settingsOpenFailure("files_and_folders", "macOS didn't open System Settings: open exited 1")).toBe("macOS didn't open System Settings: open exited 1. Open System Settings, then Privacy & Security, then Files & Folders.");
    expect(settingsOpenFailure("input_monitoring", "x.")).toBe("x. Open System Settings, then Privacy & Security, then Input Monitoring.");
  });
  test("a notice's settings button opens System Settings from any page (R9-01)", () => {
    const notice = syncNotice(at(syncing), at({ kind: "behind", changes: 1, why: "failed", error: FILES_CLI }, { ...run("failed"), failure: "flash", error: FILES_CLI, errorCode: "permission_files_and_folders" }));
    if (notice === null) throw new Error("expected a notice");
    expect(noticeOnPage(notice, at({ kind: "in_sync" }), { boardId: "zsa/moonlander", layoutId: "lay_9" })).toBe(notice);
  });

  // R9-10: the flash tool isn't installed. Build and flash's step installs it; the Homebrew sentence never shows.
  test("a sync without Zapp offers Build and flash on its build, never the brew command (R9-10)", () => {
    const cli = "zapp isn't installed. Install it with `brew install zapp`, then flash again.";
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: cli }, { ...run("failed"), failure: "flash", error: cli, errorCode: "flash_tool_missing", buildId: "bld_9" });
    const line = syncLine(failed, "lay_1");
    expect(line.detail).not.toContain("brew");
    expect(line.detail).toContain("Build and flash installs it");
    expect(line.action).toEqual({ id: "open_release", label: "Build and flash…", buildId: "bld_9" });
    const notice = syncNotice(at(syncing), failed);
    expect(notice?.detail).not.toContain("brew");
    expect(notice?.action).toEqual({ id: "open_release", label: "Build and flash…", buildId: "bld_9" });
  });

  test("a flash failure's sentence loses its backticks on the page", () => {
    const failed = at({ kind: "behind", changes: 1, why: "failed", error: "Run `keyloom flash` again." }, { ...run("failed"), failure: "flash", error: "Run `keyloom flash` again." });
    expect(syncLine(failed, "lay_1").detail).toBe("Run keyloom flash again.");
    expect(syncNotice(at(syncing), failed)?.detail).toBe("Run keyloom flash again.");
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

  test("a keyloom.kbd someone else changed offers Replace it, not Apply now or Turn remapping on, which it would refuse (R4 residual 2)", () => {
    const cli = "/Users/x/.config/keyloom/kanata/keyloom.kbd wasn't written by keyloom (it has been edited by hand), so keyloom left it alone.";
    const last = { id: "syn_1", trigger: "manual" as const, status: "failed" as const, step: "done", revisionId: "rev_1", failure: "foreign_file", errorCode: "foreign_file", error: cli, startedAt: 1, finishedAt: 2, timings: { waitMs: null, buildMs: null, flashMs: null, totalMs: null } };
    const failed = syncLine(mac({ kind: "behind", changes: 1, why: "failed", error: cli }, { last }), "lay_1");
    expect(failed).toMatchObject({ tone: "error", action: { id: "replace_foreign", label: "Replace it…" }, more: cli });
    expect(failed.detail).toContain("keeps a copy");
    const off = syncLine(mac({ kind: "behind", changes: null, why: "remapping_off", error: null }, { last }), "lay_1");
    expect(off).toMatchObject({ label: "Remapping is off", action: { id: "replace_foreign", label: "Replace it…" } });
    // The toast after the refused apply says so too, even though the state stays "remapping off".
    const notice = syncNotice(mac({ kind: "syncing", step: "writing", syncId: "s", startedAt: 1, trigger: "manual" }), mac({ kind: "behind", changes: null, why: "remapping_off", error: null }, { last }));
    expect(notice).toMatchObject({ kind: "error", action: { id: "replace_foreign", label: "Replace it…" } });
    // Any other failed apply keeps Apply now.
    const other = syncLine(mac({ kind: "behind", changes: 1, why: "failed", error: "kanata isn't answering" }, { last: { ...last, failure: "verify", errorCode: null } }), "lay_1");
    expect(other.action).toEqual({ id: "sync_now", label: "Apply now" });
  });

  // R10-01: kanata's refusal is stored as failure "build"; it is never a firmware build, Build and flash, or an Apply now that fails again.
  describe("a config kanata refuses", () => {
    const cli = "kanata --check refused the new config, so nothing was changed: Error in configuration `unknown key`";
    const failedLast = (errorCode: string | null) => ({ id: "syn_1", trigger: "auto" as const, status: "failed" as const, step: "done", revisionId: "rev_1", failure: "build", errorCode, error: cli, buildId: null, startedAt: 1, finishedAt: 2, timings: { waitMs: null, buildMs: null, flashMs: null, totalMs: null } });
    const behind = (errorCode: string | null) => mac({ kind: "behind", changes: 1, why: "failed", error: cli }, { last: failedLast(errorCode) });
    const syncing = mac({ kind: "syncing", step: "writing", syncId: "s", startedAt: 1, trigger: "auto" });

    test("a plain refusal says kanata kept the previous config, with the reason under Details and Undo this change", () => {
      for (const code of ["kanata_refused", null]) {
        const line = syncLine(behind(code), "lay_1");
        expect(line.detail).toBe("kanata refused the config keyloom wrote, so your MacBook keyboard still runs the previous one. Undo this change to go back to a layout kanata takes.");
        expect(line).toMatchObject({ tone: "error", action: { id: "undo_change", label: "Undo this change" }, more: "kanata --check refused the new config, so nothing was changed: Error in configuration unknown key" });
        expect(line.second).toBeUndefined();
        const notice = syncNotice(syncing, behind(code));
        expect(notice).toMatchObject({ kind: "error", message: "Couldn't put the change on your MacBook keyboard (ANSI)", action: { id: "undo_change", label: "Undo this change" } });
        expect(notice?.detail).toStartWith("kanata refused the config keyloom wrote");
        for (const said of [line.detail, notice?.detail]) {
          expect(said).not.toContain("build");
          expect(said).not.toContain("--check");
        }
      }
    });

    test("a cause in kanata's setup sends the person to the keyboard's status, and Apply now is for after the fix", () => {
      const line = syncLine(behind("kanata_setup"), "lay_1");
      expect(line.detail).toContain("isn't the one keyloom writes for");
      expect(line.action).toBeNull();
      expect(line.second).toEqual({ id: "sync_now", label: "Apply now" });
      const notice = syncNotice(syncing, behind("kanata_setup"));
      expect(notice).toMatchObject({ action: { id: "open_status", label: "Open keyboard status" } });
      expect(notice?.detail).toContain("The keyboard's status says how to fix it.");
    });

    test("a layout keyloom can't write for kanata says so, not that kanata refused it", () => {
      const line = syncLine(behind("kanata_unwritable"), "lay_1");
      expect(line.detail).toStartWith("keyloom can't write this layout for kanata, so your MacBook keyboard still runs the previous one.");
      expect(line.action).toEqual({ id: "undo_change", label: "Undo this change" });
    });

    test("a USB keyboard's failed build keeps Build and flash", () => {
      const usb = board({ kind: "behind", changes: 1, why: "failed", error: "boom" }, { last: { ...failedLast(null), buildId: "bld_1" } });
      expect(syncLine(usb, "lay_1").action?.id).toBe("open_release");
    });
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
    // Disable remapping that kanata didn't take: words and the status popover, never the CLI's sentence (R7-08).
    expect(refusalNotice("disable_failed", "couldn't disable remapping: kanata didn't answer. If kanata is stuck, hold Left Control + Space + Escape to stop it")).toMatchObject({ message: "keyloom couldn't turn remapping off", action: { id: "open_status", label: "Open keyboard status" } });
    expect(refusalNotice("disable_failed", "couldn't disable remapping: x").detail).not.toContain("couldn't disable remapping");
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

  test("a failure no screen planned for offers Restart keyloom; a route's own refusal doesn't (R9-05)", () => {
    const restart = { id: "restart_keyloom" as const, label: "Restart keyloom" };
    expect(refusalNotice("internal", "keyloom hit a problem it didn't expect. The details are in keyloom's log.").action).toEqual(restart);
    expect(refusalNotice("unreadable", "x").action).toEqual(restart);
    expect(refusalNotice("not_found", "x", true).action).toEqual(restart);
    expect(refusalNotice("not_found", "no layout \"x\"").action).toBeUndefined();
    expect(refusalNotice("usage", "x").action).toBeUndefined();
  });
});
