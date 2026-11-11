// The checklist the sync popover shows while kanata isn't running (D-493): each finding becomes a step with the button that does it,
// in the order the steps have to happen, and no step shows a CLI command.
import { describe, expect, test } from "bun:test";
import type { RemapperSetupResponse, SetupFinding } from "../../src/api/system-remapper.ts";
import { setupFailure, setupSteps } from "../../src/web/sync/remapper-words.ts";

const f = (code: SetupFinding["code"], status: SetupFinding["status"], detail = "x"): SetupFinding => ({ code, name: code, status, detail });
const status = (findings: SetupFinding[], over: Partial<RemapperSetupResponse> = {}): RemapperSetupResponse =>
  ({ platform: "darwin", canInstall: true, installing: false, driverVersion: "6.2.0", findings, ...over });

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

  test("an install in progress shows no second button; no Homebrew links the download instead", () => {
    expect(setupSteps(status(fresh, { installing: true }))[0]).toMatchObject({ title: "Installing kanata…", actions: [] });
    expect(setupSteps(status(fresh, { canInstall: false }))[0]).toMatchObject({ actions: [], link: { label: "Download kanata" } });
  });

  test("off macOS no button opens System Settings or asks for a password", () => {
    const steps = setupSteps(status(fresh, { platform: "other", canInstall: false }));
    expect(steps.flatMap((s) => s.actions)).toEqual([]);
  });

  test("no step shows a command to paste", () => {
    const all = setupSteps(status([...fresh, f("karabiner_config", "warn"), f("karabiner_elements", "warn")]));
    for (const s of all) expect(`${s.title} ${s.detail ?? ""}`).not.toMatch(/`|sudo|keyloom (doctor|remap|import)|brew install/);
  });
});

describe("setupFailure", () => {
  test("a cancelled password dialog says how to try again", () => {
    expect(setupFailure("cancelled", "x")).toContain("Press the button again");
    expect(setupFailure("failed", "macOS couldn't start kanata: boom")).toBe("macOS couldn't start kanata: boom");
  });
});
