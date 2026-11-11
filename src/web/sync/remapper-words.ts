// The checklist the sync popover shows while kanata isn't running (D-493), and the steps it still shows while kanata runs (an update,
// setting up again after one): the doctor's findings, by code, as steps with the button that does each one. Plain words in one place, tested without a browser. The doctor's own sentences name CLI commands, so they are
// never shown here.
import type { RemapperSetupResponse, SettingsPaneName } from "../../api/system-remapper.ts";

export type SetupActionId =
  | { kind: "install_kanata" } | { kind: "update_kanata" } | { kind: "cancel_install" } | { kind: "start_kanata" } | { kind: "open_settings"; pane: SettingsPaneName };

export interface SetupStep {
  key: string;
  state: "done" | "todo" | "note";
  title: string;
  detail: string | null;
  actions: Array<{ id: SetupActionId; label: string }>;
  /** A page to open when keyloom can't do the step itself. */
  link: { href: string; label: string } | null;
  /** The last lines Homebrew printed, while it installs or updates kanata. */
  log: string[] | null;
  /** Why the last try at this step failed. */
  problem: string | null;
  /** Shown while kanata runs too: these need doing even when the keyboard types the layout. */
  whileRunning: boolean;
}

const KANATA_RELEASES = "https://github.com/jtroo/kanata/releases";
const kanataRelease = (version: string) => `${KANATA_RELEASES}/tag/v${version}`;
const driverPage = (version: string | null) =>
  version === null ? "https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/releases" : `https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/releases/tag/v${version}`;
/** Where setup copies kanata for the daemon (D-498); src/firmware/kanata/plist.ts holds the same path. */
export const KANATA_COPY_DIR = "/Library/Application Support/keyloom";
const LOG_LINES = 6;

const step = (s: Pick<SetupStep, "key" | "state" | "title"> & Partial<SetupStep>): SetupStep => ({ detail: null, actions: [], link: null, log: null, problem: null, whileRunning: false, ...s });

/** The kanata step while Homebrew installs or updates it, or after that ended badly. Null when the job has nothing to say here. */
function installJob(status: RemapperSetupResponse, action: "install" | "upgrade"): Pick<SetupStep, "title" | "detail" | "actions" | "log" | "problem"> | null {
  const job = status.install;
  if (job.action !== action) return null;
  if (job.state === "running") {
    return {
      title: action === "install" ? "Installing kanata…" : "Updating kanata…",
      detail: "Homebrew is doing it. This can take a few minutes, and keyloom keeps working meanwhile.",
      actions: [{ id: { kind: "cancel_install" }, label: action === "install" ? "Cancel install" : "Cancel update" }],
      log: job.log.slice(-LOG_LINES), problem: null,
    };
  }
  if (job.state === "failed" || job.state === "cancelled") {
    const retry: SetupActionId = action === "install" ? { kind: "install_kanata" } : { kind: "update_kanata" };
    const failed = job.state === "failed";
    return {
      title: action === "install" ? "Install kanata" : "kanata is installed",
      // A cancel was the person's choice, so it is said plainly, not as an error.
      detail: failed ? null : `You cancelled the ${action === "install" ? "install" : "update"}. Nothing else changed.`,
      actions: status.canInstall ? [{ id: retry, label: failed ? "Try again" : action === "install" ? "Install kanata" : "Update kanata" }] : [],
      log: failed && job.log.length > 0 ? job.log.slice(-LOG_LINES) : null,
      problem: failed ? job.failure?.reason ?? "Homebrew stopped with an error." : null,
    };
  }
  return null;
}

/** The steps in the order they have to happen: kanata, its driver, macOS's permissions, then starting it. */
export function setupSteps(status: RemapperSetupResponse): SetupStep[] {
  const mac = status.platform === "darwin";
  const find = (code: string) => status.findings.find((f) => f.code === code);
  const steps: SetupStep[] = [];

  const kanata = find("kanata_missing") ?? find("kanata_version");
  if (kanata?.code === "kanata_missing") {
    const job = installJob(status, "install");
    steps.push(step({
      key: "kanata", state: "todo", title: job?.title ?? "Install kanata",
      detail: job?.detail ?? (status.canInstall ? "kanata is the remapper keyloom writes your MacBook layout for." : "kanata is the remapper keyloom writes your MacBook layout for. Homebrew isn't on this Mac, so download kanata from its releases page."),
      actions: job?.actions ?? (status.canInstall ? [{ id: { kind: "install_kanata" }, label: "Install kanata" }] : []),
      log: job?.log ?? null, problem: job?.problem ?? null,
      // After a failed install there is still a way that doesn't need Homebrew.
      link: !status.canInstall || (status.install.action === "install" && status.install.state === "failed") ? { href: KANATA_RELEASES, label: "Download kanata" } : null,
    }));
  } else if (kanata !== undefined) {
    if (kanata.status === "ok") steps.push(step({ key: "kanata", state: "done", title: "kanata is installed" }));
    else {
      const { version, wanted, update } = status.kanata;
      const job = update === "brew" ? installJob(status, "upgrade") : null;
      steps.push(step({
        key: "kanata", state: "note", title: job?.title ?? "kanata is installed", whileRunning: true,
        detail: job?.detail ?? `It's ${version === null ? "a version keyloom couldn't read" : `version ${version}`}, and keyloom writes for ${wanted}, so some keys may not load.`,
        actions: job?.actions ?? (update === "brew" ? [{ id: { kind: "update_kanata" }, label: "Update kanata" }] : []),
        log: job?.log ?? null, problem: job?.problem ?? null,
        link: update === "link" || (status.install.action === "upgrade" && status.install.state === "failed") ? { href: kanataRelease(wanted), label: `Get kanata ${wanted}` } : null,
      }));
    }
  }

  const driver = find("driver_missing") ?? find("driver_mismatch");
  if (driver !== undefined) {
    const ok = driver.status === "ok";
    steps.push(step({
      key: "driver", state: ok ? "done" : "todo", title: ok ? "kanata's keyboard driver is installed" : `Install the Karabiner VirtualHID driver${status.driverVersion ? ` ${status.driverVersion}` : ""}`,
      detail: ok ? null : driver.code === "driver_missing" ? "kanata types through it. Open the installer from its download page." : "The driver here is one kanata can't use. Install this one in its place.",
      link: ok ? null : { href: driverPage(status.driverVersion), label: "Download the driver" },
    }));
  }

  if (find("permissions") !== undefined) {
    steps.push(step({
      key: "permissions", state: "todo", title: "Allow kanata in Privacy & Security",
      detail: `Turn kanata on under Input Monitoring and under Accessibility. The kanata to allow is keyloom's copy, in ${KANATA_COPY_DIR}, which setup puts there. macOS doesn't let keyloom check this.`,
      actions: mac ? [{ id: { kind: "open_settings", pane: "input_monitoring" }, label: "Open Input Monitoring settings" }, { id: { kind: "open_settings", pane: "accessibility" }, label: "Open Accessibility settings" }] : [],
    }));
  }

  const port = find("port_closed");
  const daemon = find("daemon_missing");
  const ready = kanata?.code !== "kanata_missing";
  const startable = port?.status !== "ok" && (port !== undefined || daemon?.status === "fail");
  if (port?.status === "ok") steps.push(step({ key: "start", state: "done", title: "kanata is running" }));
  else if (startable) {
    steps.push(step({
      key: "start", state: "todo", title: "Start kanata",
      detail: ready ? "macOS asks for your password to copy kanata where only macOS can change it, install its background service and start it." : "Install kanata first.",
      actions: mac && ready ? [{ id: { kind: "start_kanata" }, label: "Set up and start kanata" }] : [],
    }));
  }
  // The daemon runs keyloom's own copy of kanata (D-498). While kanata is stopped, Start kanata above copies it again, so this step
  // only appears while it runs.
  if (!startable) {
    const updated = find("kanata_updated");
    const outdated = find("daemon_outdated");
    const again: Array<{ id: SetupActionId; label: string }> = mac ? [{ id: { kind: "start_kanata" }, label: "Set up and start kanata" }] : [];
    if (updated?.status === "warn") {
      steps.push(step({
        key: "copy", state: "todo", title: "kanata was updated. Set it up again", whileRunning: true, actions: again,
        detail: "kanata's background service still runs the kanata from before. Setting up again copies the new one, and macOS asks for your password.",
      }));
    } else if (outdated?.status === "warn") {
      steps.push(step({
        key: "copy", state: "todo", title: "Set kanata up again", whileRunning: true, actions: again,
        detail: `kanata's background service runs kanata from a folder apps running as you can change. Setting up again runs keyloom's own copy, in ${KANATA_COPY_DIR}, which only macOS can change. macOS asks for your password.`,
      }));
    }
  }

  if (find("karabiner_config")?.status === "warn") {
    steps.push(step({ key: "karabiner", state: "note", title: "Karabiner-Elements also takes this keyboard", detail: "In Karabiner-Elements, turn off its rules for the built-in keyboard, or both remappers grab it." }));
  }
  if (find("karabiner_elements")?.status === "warn") {
    steps.push(step({ key: "karabiner-upgrade", state: "note", title: "Don't upgrade Karabiner-Elements", detail: "Version 16 replaces the driver with one kanata can't use yet." }));
  }
  return steps;
}

/** The steps that still need doing while kanata runs: an update, or setting it up again. */
export const attentionSteps = (status: RemapperSetupResponse): SetupStep[] => setupSteps(status).filter((s) => s.whileRunning && s.state !== "done");

/** What to say, and where to go, for a setup step that didn't work. */
export type SetupFailure = { text: string; link: SetupStep["link"] };

/** The SetupFailure for a step's code. */
export function setupFailure(code: string, reason: string): SetupFailure {
  switch (code) {
    case "cancelled": return { text: "You cancelled the password dialog, so kanata didn't start. Press the button again when you're ready.", link: null };
    case "no_kanata": return { text: "Install kanata first.", link: null };
    case "no_brew": return { text: "Homebrew isn't installed, so keyloom can't install kanata. Download kanata from its releases page instead.", link: { href: KANATA_RELEASES, label: "Download kanata" } };
    // A kanata that can run programs is never run as root (D-498). The release page's plain builds can't.
    case "kanata_allows_cmd": return { text: "This kanata can run programs from its config, so keyloom won't run it as root. Install a kanata without that feature: Homebrew's, or a release build whose name doesn't say cmd_allowed.", link: { href: KANATA_RELEASES, label: "Download kanata" } };
    default: return { text: reason, link: null };
  }
}
