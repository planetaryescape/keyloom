// The checklist the sync popover shows while kanata isn't running (D-493): the doctor's findings, by code, as steps with the button
// that does each one. Plain words in one place, tested without a browser. The doctor's own sentences name CLI commands, so they are
// never shown here.
import type { RemapperSetupResponse, SettingsPaneName } from "../../api/system-remapper.ts";

export type SetupActionId = "install_kanata" | "start_kanata" | { pane: SettingsPaneName };

export interface SetupStep {
  key: string;
  state: "done" | "todo" | "note";
  title: string;
  detail: string | null;
  actions: Array<{ id: SetupActionId; label: string }>;
  /** A page to open when keyloom can't do the step itself. */
  link: { href: string; label: string } | null;
}

const KANATA_RELEASES = "https://github.com/jtroo/kanata/releases";
const driverPage = (version: string | null) =>
  version === null ? "https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/releases" : `https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/releases/tag/v${version}`;

/** The steps in the order they have to happen: kanata, its driver, macOS's permissions, then starting it. */
export function setupSteps(status: RemapperSetupResponse): SetupStep[] {
  const mac = status.platform === "darwin";
  const find = (code: string) => status.findings.find((f) => f.code === code);
  const steps: SetupStep[] = [];

  const kanata = find("kanata_missing") ?? find("kanata_version");
  if (kanata?.code === "kanata_missing") {
    steps.push({
      key: "kanata", state: "todo", title: status.installing ? "Installing kanata…" : "Install kanata",
      detail: status.installing ? "Homebrew is installing it. This can take a few minutes." : "kanata is the remapper keyloom writes your MacBook layout for.",
      actions: status.canInstall && !status.installing ? [{ id: "install_kanata", label: "Install kanata" }] : [],
      link: status.canInstall ? null : { href: KANATA_RELEASES, label: "Download kanata" },
    });
  } else if (kanata !== undefined) {
    steps.push({ key: "kanata", state: kanata.status === "ok" ? "done" : "note", title: "kanata is installed", detail: kanata.status === "ok" ? null : "It isn't the version keyloom writes for, so some keys may not load.", actions: [], link: null });
  }

  const driver = find("driver_missing") ?? find("driver_mismatch");
  if (driver !== undefined) {
    const ok = driver.status === "ok";
    steps.push({
      key: "driver", state: ok ? "done" : "todo", title: ok ? "kanata's keyboard driver is installed" : `Install the Karabiner VirtualHID driver${status.driverVersion ? ` ${status.driverVersion}` : ""}`,
      detail: ok ? null : driver.code === "driver_missing" ? "kanata types through it. Open the installer from its download page." : "The driver here is one kanata can't use. Install this one in its place.",
      actions: [], link: ok ? null : { href: driverPage(status.driverVersion), label: "Download the driver" },
    });
  }

  if (find("permissions") !== undefined) {
    steps.push({
      key: "permissions", state: "todo", title: "Allow kanata in Privacy & Security",
      detail: "Turn kanata on under Input Monitoring and under Accessibility. macOS doesn't let keyloom check this.",
      actions: mac ? [{ id: { pane: "input_monitoring" }, label: "Open Input Monitoring settings" }, { id: { pane: "accessibility" }, label: "Open Accessibility settings" }] : [],
      link: null,
    });
  }

  const port = find("port_closed");
  const daemon = find("daemon_missing");
  if (port?.status === "ok") steps.push({ key: "start", state: "done", title: "kanata is running", detail: null, actions: [], link: null });
  else if (port !== undefined || daemon?.status === "fail") {
    const ready = kanata?.code !== "kanata_missing";
    steps.push({
      key: "start", state: "todo", title: "Start kanata",
      detail: ready ? "macOS asks for your password to install kanata's background service and start it." : "Install kanata first.",
      actions: mac && ready ? [{ id: "start_kanata", label: "Set up and start kanata" }] : [],
      link: null,
    });
  }

  if (find("karabiner_config")?.status === "warn") {
    steps.push({ key: "karabiner", state: "note", title: "Karabiner-Elements also takes this keyboard", detail: "In Karabiner-Elements, turn off its rules for the built-in keyboard, or both remappers grab it.", actions: [], link: null });
  }
  if (find("karabiner_elements")?.status === "warn") {
    steps.push({ key: "karabiner-upgrade", state: "note", title: "Don't upgrade Karabiner-Elements", detail: "Version 16 replaces the driver with one kanata can't use yet.", actions: [], link: null });
  }
  return steps;
}

/** The sentence for a setup step that didn't work, from its code. */
export function setupFailure(code: string, reason: string): string {
  switch (code) {
    case "cancelled": return "You cancelled the password dialog, so kanata didn't start. Press the button again when you're ready.";
    case "no_kanata": return "Install kanata first.";
    case "no_brew": return "Homebrew isn't installed, so keyloom can't install kanata. Download kanata from its releases page instead.";
    default: return reason;
  }
}
