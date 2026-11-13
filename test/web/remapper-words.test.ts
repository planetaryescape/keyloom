// The checklist the sync popover shows while kanata isn't running (D-493): each finding becomes a step with the button that does it,
// in the order the steps have to happen, and no step shows a CLI command.
import { describe, expect, test } from "bun:test";
import type { KanataInstall, RemapperSetupResponse, SetupFinding } from "../../src/api/system-remapper.ts";
import { attentionSteps, recheckAfter, setupFailure, setupSteps } from "../../src/web/sync/remapper-words.ts";

const f = (code: SetupFinding["code"], status: SetupFinding["status"], detail = "x"): SetupFinding => ({ code, name: code, status, detail });
const k = (over: Partial<RemapperSetupResponse["kanata"]> = {}): RemapperSetupResponse["kanata"] => ({ version: null, wanted: "1.12.0", update: null, path: null, copyVersion: null, ...over });
const status = (findings: SetupFinding[], over: Partial<RemapperSetupResponse> = {}): RemapperSetupResponse =>
  ({
    platform: "darwin", canInstall: true, install: { state: "idle", action: null, log: [], failure: null }, kanata: k(),
    driverVersion: "6.2.0", findings, ...over,
  });
const job = (j: Partial<KanataInstall>): KanataInstall => ({ state: "running", action: "install", log: [], failure: null, ...j });
const running = [f("kanata_version", "ok"), f("driver_mismatch", "ok"), f("permissions", "unknown"), f("daemon_missing", "ok"), f("port_closed", "ok")];

const fresh = [f("kanata_missing", "fail"), f("driver_missing", "fail"), f("permissions", "unknown"), f("daemon_missing", "fail"), f("port_closed", "fail")];

describe("setupSteps", () => {
  test("a fresh Mac: install, driver, start, then permissions for the copy start makes, each with its own button (R10-03)", () => {
    const steps = setupSteps(status(fresh));
    expect(steps.map((s) => s.key)).toEqual(["kanata", "driver", "start", "permissions"]);
    expect(steps[0]?.actions).toEqual([{ id: { kind: "install_kanata" }, label: "Install kanata" }]);
    expect(steps[1]?.link?.href).toContain("/tag/v6.2.0");
    // Starting before kanata is installed can't work, so it isn't offered yet.
    expect(steps[2]).toMatchObject({ detail: "Install kanata first.", actions: [] });
    expect(steps[3]?.actions.map((a) => a.label)).toEqual(["Open Input Monitoring settings", "Open Accessibility settings"]);
    // The copy to allow doesn't exist until Start has run, so the step says to do it after.
    expect(steps[3]?.detail).toStartWith("After the Start kanata step above, turn kanata on");
  });

  test("with kanata running, the permissions step no longer points at Start (R10-03)", () => {
    const steps = setupSteps(status([f("kanata_version", "ok"), f("driver_mismatch", "ok"), f("permissions", "unknown"), f("daemon_missing", "ok"), f("port_closed", "ok")]));
    expect(steps.map((s) => s.key)).toEqual(["kanata", "driver", "start", "permissions"]);
    expect(steps[3]?.detail).toStartWith("Turn kanata on under Input Monitoring");
  });

  test("a Mac with no built-in keyboard says so, with nothing to install or name (R10-14)", () => {
    const steps = setupSteps(status([f("kanata_version", "ok"), f("keyboard_name", "fail", "this Mac has no built-in keyboard"), f("port_closed", "ok")]));
    const none = steps.find((s) => s.key === "keyboard-name");
    expect(none).toMatchObject({ state: "note", title: "This Mac has no built-in keyboard", actions: [], link: { href: expect.stringContaining("CONTRIBUTING.md"), label: "Open the contribution guide" } });
    expect(none?.detail).not.toContain("kanata --list");
    expect(attentionSteps(status([f("keyboard_name", "fail"), f("port_closed", "ok")])).map((s) => s.key)).toContain("keyboard-name");
  });

  // PR #315 review: keyloom offers set-up only for a keyboard it supports, so the note promises no more; and a Mac mini isn't led through
  // the install, the password dialog and the permissions for a remapper with nothing to remap.
  test("a Mac with no built-in keyboard shows only the note, not the install, start and permission steps", () => {
    const stopped = status([f("kanata_missing", "fail"), f("driver_missing", "fail"), f("permissions", "unknown"), f("daemon_missing", "fail"), f("port_closed", "fail"), f("keyboard_name", "fail")]);
    const steps = setupSteps(stopped);
    expect(steps.map((s) => s.key)).toEqual(["keyboard-name"]);
    expect(steps[0]?.detail).toContain("When you plug in a keyboard keyloom supports");
    expect(steps[0]?.detail).not.toContain("on USB");
    expect(steps.flatMap((s) => s.actions)).toEqual([]);
  });

  test("a kanata missing from PATH while kanata's service runs is still a step, because keyloom checks configs with it (R10-01)", () => {
    expect(attentionSteps(status([f("kanata_missing", "fail"), f("port_closed", "ok")])).map((s) => s.key)).toContain("kanata");
  });

  // R11-02 replaces "Set up and start kanata" here: the service is installed, so setting up again would do the same. A restart starts a
  // service the exit chord stopped too.
  test("kanata's service installed and kanata not answering (the first start before the grant, or the exit chord): Restart and the log, after the permissions", () => {
    const steps = setupSteps(status([f("kanata_version", "ok"), f("driver_mismatch", "ok"), f("permissions", "unknown"), f("daemon_missing", "ok"), f("port_closed", "warn")]));
    const start = steps.find((s) => s.key === "start");
    expect(start?.title).toBe("kanata's service is installed, but kanata isn't answering");
    expect(start?.actions).toEqual([{ id: { kind: "restart_kanata" }, label: "Restart kanata's service" }, { id: { kind: "show_kanata_log" }, label: "Show kanata's log" }]);
    expect(start?.detail).toContain("password");
    expect(start?.detail).not.toContain("install its background service");
    // The grant comes after the first start, so in this state the permissions step comes first, and doesn't say "after the step above".
    expect(steps.map((s) => s.key)).toEqual(["kanata", "driver", "permissions", "start"]);
    expect(steps.find((s) => s.key === "permissions")?.detail).not.toContain("After");
    expect(steps.filter((s) => s.state === "done").map((s) => s.key)).toEqual(["kanata", "driver"]);
  });

  test("Start, and Restart kanata's service, stay off until the driver is in, with the reason beside them (R11-02)", () => {
    const noDriver = setupSteps(status([f("kanata_version", "ok"), f("driver_missing", "fail"), f("permissions", "unknown"), f("daemon_missing", "fail"), f("port_closed", "fail")]));
    expect(noDriver.find((s) => s.key === "start")).toMatchObject({ detail: "Install the driver above first.", actions: [{ id: { kind: "start_kanata" }, label: "Set up and start kanata", off: true }] });
    const wrongDriver = setupSteps(status([f("kanata_version", "ok"), f("driver_mismatch", "fail"), f("permissions", "unknown"), f("daemon_missing", "ok"), f("port_closed", "warn")]));
    const restart = wrongDriver.find((s) => s.key === "start");
    expect(restart?.detail).toBe("Install the driver above first.");
    // The log is still worth reading; only the restart waits for the driver.
    expect(restart?.actions).toEqual([{ id: { kind: "restart_kanata" }, label: "Restart kanata's service", off: true }, { id: { kind: "show_kanata_log" }, label: "Show kanata's log" }]);
    // With the driver in, nothing is off.
    const ready = setupSteps(status([f("kanata_version", "ok"), f("driver_mismatch", "ok"), f("permissions", "unknown"), f("daemon_missing", "fail"), f("port_closed", "fail")]));
    expect(ready.find((s) => s.key === "start")?.actions).toEqual([{ id: { kind: "start_kanata" }, label: "Set up and start kanata" }]);
  });

  test("kanata's log, once read, shows in the not-answering step; an empty log says so (R11-02)", () => {
    const notAnswering = [f("kanata_version", "ok"), f("driver_mismatch", "ok"), f("permissions", "unknown"), f("daemon_missing", "ok"), f("port_closed", "warn")];
    expect(setupSteps(status(notAnswering)).find((s) => s.key === "start")?.log).toBeNull();
    const read = setupSteps(status(notAnswering), { kanataLog: ["one", "two"] }).find((s) => s.key === "start");
    expect(read).toMatchObject({ log: ["one", "two"], logLabel: "What kanata wrote last" });
    const empty = setupSteps(status(notAnswering), { kanataLog: [] }).find((s) => s.key === "start");
    expect(empty?.log).toBeNull();
    expect(empty?.detail).toEndWith("kanata's log has nothing in it yet.");
  });

  test("a service that runs an old or changed kanata keeps Set up and start kanata, not a restart that would run the same kanata (R11-02)", () => {
    for (const changed of [f("kanata_updated", "warn"), f("daemon_outdated", "warn")]) {
      const steps = setupSteps(status([f("kanata_version", "ok"), f("driver_mismatch", "ok"), f("permissions", "unknown"), f("daemon_missing", "ok"), f("port_closed", "warn"), changed]));
      expect(steps.find((s) => s.key === "start")?.actions.map((a) => a.id.kind)).toEqual(["start_kanata"]);
      expect(steps.flatMap((s) => s.actions).some((a) => a.id.kind === "restart_kanata")).toBe(false);
    }
  });

  test("an install in progress shows Homebrew's last lines and Cancel, not a second Install; no Homebrew links the download instead", () => {
    const lines = ["a", "b", "c", "d", "e", "f", "==> Pouring kanata--1.12.0.arm64_sequoia.bottle.tar.gz"];
    expect(setupSteps(status(fresh, { install: job({ log: lines }) }))[0]).toMatchObject({
      title: "Installing kanata…", actions: [{ id: { kind: "cancel_install" }, label: "Cancel install" }], log: lines.slice(-6), link: null,
    });
    expect(setupSteps(status(fresh, { canInstall: false }))[0]).toMatchObject({ actions: [], link: { label: "Download kanata" } });
  });

  test("a failed install says why, offers Try again, and the download as the way that doesn't need Homebrew (R2-06)", () => {
    const failed = setupSteps(status(fresh, { install: job({ state: "failed", log: ["Error: boom"], failure: { code: "failed", reason: "Homebrew couldn't install kanata: Error: boom" } }) }))[0];
    expect(failed).toMatchObject({
      title: "Install kanata", problem: "Homebrew couldn't install kanata: Error: boom", log: ["Error: boom"],
      actions: [{ id: { kind: "install_kanata" }, label: "Try again" }], link: { href: "https://github.com/jtroo/kanata/releases", label: "Download kanata" },
    });
    expect(failed?.detail).toContain("remapper");
    const cancelled = setupSteps(status(fresh, { install: job({ state: "cancelled", failure: { code: "cancelled", reason: "x" } }) }))[0];
    expect(cancelled).toMatchObject({ problem: null, detail: "You cancelled the install. Nothing else changed.", actions: [{ id: { kind: "install_kanata" }, label: "Install kanata" }], link: null });
  });

  test("an older Homebrew kanata offers Update kanata, with its progress and Cancel; any other mismatch links the release (R2-10)", () => {
    const old = [f("kanata_version", "warn"), ...running.slice(1)];
    const brew = setupSteps(status(old, { kanata: k({ version: "1.11.0", update: "brew" }) }))[0];
    // The release link sits beside Update kanata: Homebrew may not have the version keyloom writes for yet.
    expect(brew).toMatchObject({ state: "note", whileRunning: true, actions: [{ id: { kind: "update_kanata" }, label: "Update kanata" }], link: { label: "Get kanata 1.12.0" } });
    expect(brew?.detail).toBe("It's version 1.11.0, and keyloom writes for 1.12.0, so some keys may not load.");
    const updating = setupSteps(status(old, { kanata: k({ version: "1.11.0", update: "brew" }), install: job({ action: "upgrade", log: ["==> Upgrading kanata"] }) }))[0];
    expect(updating).toMatchObject({ title: "Updating kanata…", actions: [{ id: { kind: "cancel_install" }, label: "Cancel update" }], log: ["==> Upgrading kanata"], link: null });
    const failed = setupSteps(status(old, { kanata: k({ version: "1.11.0", update: "brew" }), install: job({ action: "upgrade", state: "failed", failure: { code: "failed", reason: "nope" } }) }))[0];
    expect(failed).toMatchObject({ problem: "nope", actions: [{ label: "Try again" }], link: { href: "https://github.com/jtroo/kanata/releases/tag/v1.12.0", label: "Get kanata 1.12.0" } });
    const link = setupSteps(status(old, { kanata: k({ version: "1.13.0", update: "link" }) }))[0];
    expect(link).toMatchObject({ actions: [], link: { label: "Get kanata 1.12.0" } });
  });

  test("an update that found nothing newer says so and offers the release, not Update kanata again (review of #279)", () => {
    const old = [f("kanata_version", "warn"), ...running.slice(1)];
    // The server sends `link` once a `brew upgrade` succeeded and kanata is still older.
    const done = setupSteps(status(old, { kanata: k({ version: "1.11.0", update: "link" }), install: job({ action: "upgrade", state: "succeeded" }) }))[0];
    expect(done).toMatchObject({ actions: [], link: { href: "https://github.com/jtroo/kanata/releases/tag/v1.12.0", label: "Get kanata 1.12.0" } });
    expect(done?.detail).toBe("Homebrew has nothing newer than 1.11.0, and keyloom writes for 1.12.0. Get 1.12.0 from kanata's releases page.");
  });

  test("a kanata changed outside Homebrew names it and offers no password step for Homebrew's; Reinstall kanata puts it back (D-498)", () => {
    const cellar = "/opt/homebrew/Cellar/kanata/1.12.0/bin/kanata";
    const changed = attentionSteps(status([...running, f("kanata_replaced", "warn")], { kanata: k({ version: "1.12.0", path: cellar, copyVersion: "1.12.0" }) }));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ key: "replaced", title: "kanata changed outside Homebrew", actions: [{ id: { kind: "reinstall_kanata" }, label: "Reinstall kanata" }], link: null });
    expect(changed[0]?.detail).toContain(`${cellar} is version 1.12.0, and kanata's background service runs version 1.12.0`);
    expect(changed[0]?.actions.some((a) => a.id.kind === "start_kanata")).toBe(false);
    // While Homebrew reinstalls it, the step follows the job.
    const reinstalling = attentionSteps(status([...running, f("kanata_replaced", "warn")], { kanata: k({ path: cellar }), install: job({ action: "reinstall", log: ["==> Reinstalling kanata"] }) }));
    expect(reinstalling[0]).toMatchObject({ title: "Reinstalling kanata…", actions: [{ id: { kind: "cancel_install" }, label: "Cancel reinstall" }] });
    // A kanata from elsewhere has no Homebrew copy to put back: the person who installed it can set up with it.
    const own = attentionSteps(status([...running, f("kanata_replaced", "warn")], { kanata: k({ version: "1.12.0", path: "/usr/local/bin/kanata", copyVersion: "1.11.0" }) }));
    expect(own[0]).toMatchObject({ actions: [{ id: { kind: "start_kanata" }, label: "Set up with this kanata" }] });
    expect(own[0]?.detail).toContain("If you installed this kanata yourself");
    // Stopped: Start kanata would copy it as root, so it waits for the change to be dealt with.
    const stopped = setupSteps(status([...running.slice(0, 4), f("port_closed", "warn"), f("kanata_replaced", "warn")], { kanata: k({ path: cellar }) }));
    expect(stopped.find((s) => s.key === "start")).toMatchObject({ actions: [], detail: "Deal with the kanata change above first." });
    expect(stopped.map((s) => s.key).indexOf("replaced")).toBeLessThan(stopped.map((s) => s.key).indexOf("start"));
  });

  test("a kanata updated since setup, or a daemon from before the root copy, offers Set up and start kanata while kanata runs (D-498)", () => {
    const updated = attentionSteps(status([...running, f("kanata_updated", "warn")]));
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ key: "copy", title: "kanata was updated. Set it up again", actions: [{ id: { kind: "start_kanata" }, label: "Set up and start kanata" }] });
    // The step names what it would copy, so the person can see it is Homebrew's.
    const named = attentionSteps(status([...running, f("kanata_updated", "warn")], { kanata: k({ version: "1.12.0", path: "/opt/homebrew/Cellar/kanata/1.12.0/bin/kanata" }) }));
    expect(named[0]?.detail).toContain("Homebrew updated kanata to 1.12.0, at /opt/homebrew/Cellar/kanata/1.12.0/bin/kanata.");
    const outdated = attentionSteps(status([...running, f("daemon_outdated", "warn")]));
    expect(outdated[0]).toMatchObject({ key: "copy", title: "Set kanata up again" });
    expect(outdated[0]?.detail).toContain("/Library/Application Support/keyloom");
    expect(attentionSteps(status([...running, f("kanata_updated", "ok")]))).toEqual([]);
    // While kanata is stopped, Start kanata copies it again: one button, not two.
    const stopped = setupSteps(status([...running.slice(0, 4), f("port_closed", "warn"), f("kanata_updated", "warn")]));
    expect(stopped.filter((s) => s.actions.some((a) => a.id.kind === "start_kanata")).map((s) => s.key)).toEqual(["start"]);
  });

  test("the permissions step names the kanata to allow: keyloom's copy", () => {
    expect(setupSteps(status(fresh)).find((s) => s.key === "permissions")?.detail).toContain("/Library/Application Support/keyloom");
  });

  test("off macOS no button opens System Settings or asks for a password", () => {
    const steps = setupSteps(status(fresh, { platform: "other", canInstall: false }));
    expect(steps.flatMap((s) => s.actions)).toEqual([]);
  });

  test("Karabiner-Elements' rules step opens the app only when it is installed (R3-21)", () => {
    const rules = (findings: Parameters<typeof status>[0]) => setupSteps(status(findings)).find((s) => s.key === "karabiner");
    expect(rules([...fresh, f("karabiner_config", "warn"), f("karabiner_elements", "warn")])?.actions).toEqual([{ id: { kind: "open_settings", pane: "karabiner_elements" }, label: "Open Karabiner-Elements" }]);
    expect(rules([...fresh, f("karabiner_config", "warn")])?.actions).toEqual([]);
    // The conflict matters while kanata runs, so the running view keeps the step and its button.
    expect(attentionSteps(status([...running, f("karabiner_config", "warn"), f("karabiner_elements", "warn")])).find((s) => s.key === "karabiner")?.actions).toHaveLength(1);
  });

  test("the Karabiner step carries the entry to copy, as the import showed it (R11-01)", () => {
    const entry = '{ "identifiers": { "is_keyboard": true, "product_id": 0, "vendor_id": 0 }, "ignore": true }';
    const step = setupSteps(status([...fresh, f("karabiner_config", "warn")], { karabinerEntry: entry })).find((s) => s.key === "karabiner");
    expect(step?.copy).toEqual({ text: entry, noun: "entry" });
    expect(step?.detail).toContain("add this entry to the \"devices\" list of your profile in karabiner.json");
    // An older keyloom sends no entry: the step says only what it said before.
    expect(setupSteps(status([...fresh, f("karabiner_config", "warn")])).find((s) => s.key === "karabiner")).toMatchObject({ copy: null, detail: "In Karabiner-Elements, turn off its rules for the built-in keyboard, or both remappers grab it." });
  });

  test("no step shows a command to paste", () => {
    const all = [
      ...setupSteps(status([...fresh, f("karabiner_config", "warn"), f("karabiner_elements", "warn")])),
      ...attentionSteps(status([f("kanata_version", "warn"), ...running.slice(1), f("kanata_updated", "warn")], { kanata: k({ version: "1.11.0", update: "brew" }) })),
      ...attentionSteps(status([...running, f("daemon_outdated", "warn")])),
      ...attentionSteps(status([...running, f("kanata_replaced", "warn")], { kanata: k({ path: "/usr/local/bin/kanata" }) })),
      ...attentionSteps(status([...running, f("kanata_replaced", "warn")], { kanata: k({ path: "/opt/homebrew/Cellar/kanata/1.12.0/bin/kanata" }) })),
      ...setupSteps(status([...running.slice(0, 4), f("port_closed", "warn")]), { kanataLog: [] }),
    ];
    for (const s of all) expect(`${s.title} ${s.detail ?? ""}`).not.toMatch(/`|sudo|keyloom (doctor|remap|import)|brew install/);
  });
});

describe("recheckAfter (R8-17)", () => {
  test("a pane opened for the person is read again when keyloom is back in front; anything keyloom ran, at once", () => {
    expect(recheckAfter({ kind: "open_settings" })).toBe("on_return");
    for (const kind of ["install_kanata", "update_kanata", "reinstall_kanata", "cancel_install", "start_kanata"]) expect(recheckAfter({ kind })).toBe("now");
  });
});

describe("setupFailure", () => {
  test("a cancelled password dialog says how to try again", () => {
    expect(setupFailure("cancelled", "x").text).toContain("Press the button again");
    expect(setupFailure("failed", "macOS couldn't start kanata: boom")).toEqual({ text: "macOS couldn't start kanata: boom", link: null });
  });

  test("a kanata that can run programs, or no Homebrew, points at the download (D-498)", () => {
    expect(setupFailure("kanata_allows_cmd", "x")).toMatchObject({ text: expect.stringContaining("won't run it as root"), link: { label: "Download kanata" } });
    expect(setupFailure("no_brew", "x").link?.href).toBe("https://github.com/jtroo/kanata/releases");
    // One keyloom can't read is refused too; the download is the way on (review of #279).
    expect(setupFailure("kanata_cmd_unknown", "keyloom couldn't tell.")).toMatchObject({ text: expect.stringContaining("keyloom couldn't tell."), link: { label: "Download kanata" } });
  });

  test("a closed password dialog names what didn't happen, for the restart and the log too (R11-02)", () => {
    expect(setupFailure("cancelled", "x", "restart_kanata").text).toBe("You cancelled the password dialog, so kanata's service wasn't restarted. Press Restart kanata's service again when you're ready.");
    expect(setupFailure("cancelled", "x", "show_kanata_log").text).toBe("You cancelled the password dialog, so keyloom didn't read kanata's log. Press Show kanata's log again when you're ready.");
    expect(setupFailure("cancelled", "x", "start_kanata").text).toContain("kanata didn't start");
  });

  test("a restart kanata didn't answer points at the log; a service setup didn't make offers setting up again (R11-02)", () => {
    // The step's own Show kanata's log is right above the line, so the line adds no second one.
    expect(setupFailure("still_not_answering", "x", "restart_kanata")).toEqual({ text: expect.stringContaining("or show kanata's log"), link: null });
    for (const code of ["service_missing", "service_outdated"]) {
      const failure = setupFailure(code, "x", "restart_kanata");
      expect(failure).toMatchObject({ action: { id: { kind: "start_kanata" }, label: "Set up and start kanata" } });
      expect(failure.text).toContain("restarted nothing");
    }
    expect(setupFailure("log_missing", "x", "show_kanata_log")).toMatchObject({ text: "kanata has no log yet: its service writes one once kanata starts.", link: null });
  });

  test("a kanata swapped while the password dialog was open says nothing was installed and how to go on", () => {
    expect(setupFailure("kanata_swapped", "x")).toEqual({ text: expect.stringContaining("installed nothing. Press the button again"), link: null });
  });
});

// R9-12: kanata takes the built-in keyboard by name; a Mac model keyloom doesn't know names it differently, so every other step can be
// done while nothing is remapped.
describe("a built-in keyboard keyloom doesn't know by name", () => {
  test("is a step to do, shown while kanata runs too, with the contribution guide", () => {
    const steps = setupSteps(status([...running, f("keyboard_name", "warn", "no keyboard named \"Apple Internal Keyboard / Trackpad\" was found; run `kanata --list` and compare")]));
    const step = steps.find((s) => s.key === "keyboard-name");
    expect(step).toMatchObject({ state: "todo", title: "kanata can't find this Mac's keyboard", whileRunning: true, link: { label: "Open the contribution guide" } });
    expect(step?.link?.href).toContain("CONTRIBUTING.md");
    expect(step?.detail).not.toContain("`");
    expect(step?.detail).not.toContain("kanata --list");
    // So the running view never reads as all done while kanata remaps nothing.
    expect(attentionSteps(status([...running, f("keyboard_name", "warn")])).map((s) => s.key)).toContain("keyboard-name");
  });
  test("a keyboard keyloom finds, or a list it couldn't read, adds no step", () => {
    expect(setupSteps(status([...running, f("keyboard_name", "ok")])).some((s) => s.key === "keyboard-name")).toBe(false);
    expect(setupSteps(status([...running, f("keyboard_name", "unknown")])).some((s) => s.key === "keyboard-name")).toBe(false);
  });
});
