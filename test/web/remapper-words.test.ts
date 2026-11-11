// The checklist the sync popover shows while kanata isn't running (D-493): each finding becomes a step with the button that does it,
// in the order the steps have to happen, and no step shows a CLI command.
import { describe, expect, test } from "bun:test";
import type { KanataInstall, RemapperSetupResponse, SetupFinding } from "../../src/api/system-remapper.ts";
import { attentionSteps, setupFailure, setupSteps } from "../../src/web/sync/remapper-words.ts";

const f = (code: SetupFinding["code"], status: SetupFinding["status"], detail = "x"): SetupFinding => ({ code, name: code, status, detail });
const status = (findings: SetupFinding[], over: Partial<RemapperSetupResponse> = {}): RemapperSetupResponse =>
  ({
    platform: "darwin", canInstall: true, install: { state: "idle", action: null, log: [], failure: null }, kanata: { version: null, wanted: "1.12.0", update: null },
    driverVersion: "6.2.0", findings, ...over,
  });
const job = (j: Partial<KanataInstall>): KanataInstall => ({ state: "running", action: "install", log: [], failure: null, ...j });
const running = [f("kanata_version", "ok"), f("driver_mismatch", "ok"), f("permissions", "unknown"), f("daemon_missing", "ok"), f("port_closed", "ok")];

const fresh = [f("kanata_missing", "fail"), f("driver_missing", "fail"), f("permissions", "unknown"), f("daemon_missing", "fail"), f("port_closed", "fail")];

describe("setupSteps", () => {
  test("a fresh Mac: install, driver, permissions, then start, each with its own button", () => {
    const steps = setupSteps(status(fresh));
    expect(steps.map((s) => s.key)).toEqual(["kanata", "driver", "permissions", "start"]);
    expect(steps[0]?.actions).toEqual([{ id: { kind: "install_kanata" }, label: "Install kanata" }]);
    expect(steps[1]?.link?.href).toContain("/tag/v6.2.0");
    expect(steps[2]?.actions.map((a) => a.label)).toEqual(["Open Input Monitoring settings", "Open Accessibility settings"]);
    // Starting before kanata is installed can't work, so it isn't offered yet.
    expect(steps[3]).toMatchObject({ detail: "Install kanata first.", actions: [] });
  });

  test("kanata installed and stopped (the exit chord): Start is the button, and it names the password dialog", () => {
    const steps = setupSteps(status([f("kanata_version", "ok"), f("driver_mismatch", "ok"), f("permissions", "unknown"), f("daemon_missing", "ok"), f("port_closed", "warn")]));
    const start = steps.find((s) => s.key === "start");
    expect(start?.actions).toEqual([{ id: { kind: "start_kanata" }, label: "Set up and start kanata" }]);
    expect(start?.detail).toContain("password");
    expect(steps.filter((s) => s.state === "done").map((s) => s.key)).toEqual(["kanata", "driver"]);
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
    const brew = setupSteps(status(old, { kanata: { version: "1.11.0", wanted: "1.12.0", update: "brew" } }))[0];
    expect(brew).toMatchObject({ state: "note", whileRunning: true, actions: [{ id: { kind: "update_kanata" }, label: "Update kanata" }], link: null });
    expect(brew?.detail).toBe("It's version 1.11.0, and keyloom writes for 1.12.0, so some keys may not load.");
    const updating = setupSteps(status(old, { kanata: { version: "1.11.0", wanted: "1.12.0", update: "brew" }, install: job({ action: "upgrade", log: ["==> Upgrading kanata"] }) }))[0];
    expect(updating).toMatchObject({ title: "Updating kanata…", actions: [{ id: { kind: "cancel_install" }, label: "Cancel update" }], log: ["==> Upgrading kanata"] });
    const failed = setupSteps(status(old, { kanata: { version: "1.11.0", wanted: "1.12.0", update: "brew" }, install: job({ action: "upgrade", state: "failed", failure: { code: "failed", reason: "nope" } }) }))[0];
    expect(failed).toMatchObject({ problem: "nope", actions: [{ label: "Try again" }], link: { href: "https://github.com/jtroo/kanata/releases/tag/v1.12.0", label: "Get kanata 1.12.0" } });
    const link = setupSteps(status(old, { kanata: { version: "1.13.0", wanted: "1.12.0", update: "link" } }))[0];
    expect(link).toMatchObject({ actions: [], link: { label: "Get kanata 1.12.0" } });
  });

  test("a kanata updated since setup, or a daemon from before the root copy, offers Set up and start kanata while kanata runs (D-498)", () => {
    const updated = attentionSteps(status([...running, f("kanata_updated", "warn")]));
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ key: "copy", title: "kanata was updated. Set it up again", actions: [{ id: { kind: "start_kanata" }, label: "Set up and start kanata" }] });
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

  test("no step shows a command to paste", () => {
    const all = [
      ...setupSteps(status([...fresh, f("karabiner_config", "warn"), f("karabiner_elements", "warn")])),
      ...attentionSteps(status([f("kanata_version", "warn"), ...running.slice(1), f("kanata_updated", "warn")], { kanata: { version: "1.11.0", wanted: "1.12.0", update: "brew" } })),
      ...attentionSteps(status([...running, f("daemon_outdated", "warn")])),
    ];
    for (const s of all) expect(`${s.title} ${s.detail ?? ""}`).not.toMatch(/`|sudo|keyloom (doctor|remap|import)|brew install/);
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
  });
});
