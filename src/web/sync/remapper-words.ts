// The checklist the sync popover shows while kanata isn't running (D-493), and the steps it still shows while kanata runs (an update,
// setting up again after one): the doctor's findings, by code, as steps with the button that does each one. Plain words in one place, tested without a browser. The doctor's own sentences name CLI commands, so they are
// never shown here.
import type { KanataInstallAction, RemapperSetupResponse, SettingsPaneName } from "../../api/system-remapper.ts";

/**
 * When a step's button has ended, the checklist reads the machine again: at once for anything keyloom ran, and when the window is back in
 * front for a System Settings or Karabiner pane, where the person makes the change themselves (R8-17).
 */
export const recheckAfter = (id: { kind: string }): "now" | "on_return" => (id.kind === "open_settings" ? "on_return" : "now");

export type SetupActionId =
  | { kind: "install_kanata" } | { kind: "update_kanata" } | { kind: "reinstall_kanata" } | { kind: "download_kanata" } | { kind: "cancel_install" } | { kind: "start_kanata" }
  | { kind: "restart_kanata" } | { kind: "show_kanata_log" }
  | { kind: "open_settings"; pane: SettingsPaneName };

/** A step's button. `off`: shown but not pressable, because a step above has to be done first; the step's detail says which (R11-02). */
export type SetupAction = { id: SetupActionId; label: string; off?: boolean };

/** The Karabiner edit in words, for the import card and the checklist's Karabiner step alike (R11-01). keyloom never writes karabiner.json (D-233). */
export const KARABINER_ENTRY_WORDS = "add this entry to the \"devices\" list of your profile in karabiner.json. Your rules stay in the file, and removing the entry turns them back on.";

export interface SetupStep {
  key: string;
  state: "done" | "todo" | "note";
  title: string;
  detail: string | null;
  actions: SetupAction[];
  /** A page to open when keyloom can't do the step itself. */
  link: { href: string; label: string } | null;
  /** Text to copy that keyloom can't put in place itself, such as the Karabiner entry (R11-01). */
  copy: { text: string; noun: string } | null;
  /** The last lines Homebrew printed while it installs or updates kanata, Get kanata's download progress, or kanata's own log once read (R11-02). */
  log: string[] | null;
  /** What `log` holds, for a screen reader. */
  logLabel: string;
  /** Why the last try at this step failed. */
  problem: string | null;
  /** Shown while kanata runs too: these need doing even when the keyboard types the layout. */
  whileRunning: boolean;
}

const KANATA_RELEASES = "https://github.com/jtroo/kanata/releases";
/** How a board learns this Mac's keyboard: its `device.name` (CONTRIBUTING.md, the board reference). */
const CONTRIBUTION_GUIDE = "https://github.com/planetaryescape/keyloom/blob/main/CONTRIBUTING.md";
const kanataRelease = (version: string) => `${KANATA_RELEASES}/tag/v${version}`;
/**
 * Where a kanata from its release page must go (R12-02): keyloom uses the first kanata it finds (findKanata), and its own folder holds only
 * what keyloom downloaded and checked. The release names its program after the processor (kanata_macos_arm64). With `path`, the kanata
 * keyloom finds now, which the new one has to replace to be found first. The server's HAND_PLACEMENT says the same after a failed check.
 */
export const kanataPlacement = (path: string | null = null): string =>
  path === null
    ? "Rename its program to kanata and put it in a folder on your PATH, such as /usr/local/bin, because keyloom looks for it there."
    : `Rename its program to kanata and put it in place of the one at ${path}, which is the kanata keyloom finds.`;
const driverPage = (version: string | null) =>
  version === null ? "https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/releases" : `https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/releases/tag/v${version}`;
/** Where setup copies kanata for the daemon (D-498); src/firmware/kanata/plist.ts holds the same path. */
export const KANATA_COPY_DIR = "/Library/Application Support/keyloom";
const LOG_LINES = 6;

const step = (s: Pick<SetupStep, "key" | "state" | "title"> & Partial<SetupStep>): SetupStep => ({
  detail: null, actions: [], link: null, copy: null, log: null, logLabel: "What Homebrew printed last", problem: null, whileRunning: false, ...s,
});

/** How each job is named on its step, and the button that runs it: Homebrew's three, and Get kanata's download without Homebrew (D-560). */
const JOBS: Record<KanataInstallAction, { running: string; noun: string; button: string; retry: SetupActionId }> = {
  install: { running: "Installing kanata…", noun: "install", button: "Install kanata", retry: { kind: "install_kanata" } },
  upgrade: { running: "Updating kanata…", noun: "update", button: "Update kanata", retry: { kind: "update_kanata" } },
  reinstall: { running: "Reinstalling kanata…", noun: "reinstall", button: "Reinstall kanata", retry: { kind: "reinstall_kanata" } },
  download: { running: "Getting kanata…", noun: "download", button: "Get kanata", retry: { kind: "download_kanata" } },
};
const HOMEBREW_RUNNING = "Homebrew is doing it. This can take a few minutes, and keyloom keeps working meanwhile.";
const downloadRunning = (version: string) => `keyloom is downloading kanata ${version} from its release on GitHub, then checks it against the checksum keyloom carries.`;

/**
 * The kanata step while Homebrew installs, updates or reinstalls it, or after that ended badly; `title` is the step's own title, kept
 * after a failure. Null when the job has nothing to say here.
 */
function installJob(status: RemapperSetupResponse, action: KanataInstallAction, title: string): Pick<SetupStep, "title" | "detail" | "actions" | "log" | "problem"> | null {
  const job = status.install;
  if (job.action !== action) return null;
  const words = JOBS[action];
  const download = action === "download";
  if (job.state === "running") {
    return {
      title: words.running,
      detail: download ? downloadRunning(status.kanata.wanted) : HOMEBREW_RUNNING,
      actions: [{ id: { kind: "cancel_install" }, label: `Cancel ${words.noun}` }],
      log: job.log.slice(-LOG_LINES), problem: null,
    };
  }
  if (job.state === "failed" || job.state === "cancelled") {
    const failed = job.state === "failed";
    return {
      title,
      // A cancel was the person's choice, so it is said plainly, not as an error.
      detail: failed ? null : `You cancelled the ${words.noun}. Nothing else changed.`,
      actions: (download ? status.canDownload === true : status.canInstall) ? [{ id: words.retry, label: failed ? "Try again" : words.button }] : [],
      log: failed && job.log.length > 0 ? job.log.slice(-LOG_LINES) : null,
      problem: failed ? job.failure?.reason ?? (download ? "The download stopped with an error." : "Homebrew stopped with an error.") : null,
    };
  }
  return null;
}

/** What the checklist knows beyond the status read: kanata's log lines, once Show kanata's log has read them (R11-02). */
export type SetupExtras = { kanataLog?: string[] | null };

/**
 * The steps in the order they have to happen: kanata, its driver, starting it, then macOS's permissions for the copy it starts. A Mac with
 * no built-in keyboard (a Mac mini or a Mac Studio) gets only the note that says so: kanata would have nothing to remap, so installing it,
 * the password dialog and the permissions would lead nowhere (R10-14, PR #315 review).
 *
 * Once kanata's service is installed and kanata doesn't answer (R11-02), the permissions step comes before the service's step: macOS can
 * only be asked to allow the copy after the first start made it, and kanata needs those grants to run.
 */
export function setupSteps(status: RemapperSetupResponse, extras: SetupExtras = {}): SetupStep[] {
  const mac = status.platform === "darwin";
  const find = (code: string) => status.findings.find((f) => f.code === code);
  if (find("keyboard_name")?.status === "fail") return [noBuiltInKeyboard()];
  const steps: SetupStep[] = [];

  const kanata = find("kanata_missing") ?? find("kanata_version");
  if (kanata?.code === "kanata_missing") {
    steps.push(kanataMissing(status, find("kanata_kept_changed") !== undefined));
  } else if (kanata !== undefined) {
    if (kanata.status === "ok") steps.push(step({ key: "kanata", state: "done", title: "kanata is installed" }));
    else {
      const { version, wanted, update } = status.kanata;
      const job = update === "brew" ? installJob(status, "upgrade", "kanata is installed") : null;
      // The server turns `brew` into `link` after an update that found nothing newer (Homebrew's newest is older than keyloom's).
      const brewHasNothingNewer = update === "link" && status.install.action === "upgrade" && status.install.state === "succeeded";
      const is = `It's ${version === null ? "a version keyloom couldn't read" : `version ${version}`}`;
      steps.push(step({
        key: "kanata", state: "note", title: job?.title ?? "kanata is installed", whileRunning: true,
        detail: job?.detail ?? (brewHasNothingNewer
          ? `Homebrew has nothing newer than ${version ?? "this kanata"}, and keyloom writes for ${wanted}. Get ${wanted} from kanata's releases page. ${kanataPlacement(status.kanata.path)}`
          : `${is}, and keyloom writes for ${wanted}, so some keys may not load.${update === null || status.install.state === "running" ? "" : ` If you get ${wanted} from its release page, ${lowerFirst(kanataPlacement(status.kanata.path))}`}`),
        actions: job?.actions ?? (update === "brew" ? [{ id: { kind: "update_kanata" }, label: "Update kanata" }] : []),
        log: job?.log ?? null, problem: job?.problem ?? null,
        // Beside Update kanata too: Homebrew may not have the version keyloom writes for yet.
        link: update !== null && status.install.state !== "running" ? { href: kanataRelease(wanted), label: `Get kanata ${wanted}` } : null,
      }));
    }
  }

  const driver = find("driver_missing") ?? find("driver_mismatch");
  // kanata types through the driver, so nothing below starts it before the driver is in (R11-02).
  const driverReady = driver === undefined || driver.status === "ok";
  if (driver !== undefined) {
    const ok = driver.status === "ok";
    steps.push(step({
      key: "driver", state: ok ? "done" : "todo", title: ok ? "kanata's keyboard driver is installed" : `Install the Karabiner VirtualHID driver${status.driverVersion ? ` ${status.driverVersion}` : ""}`,
      detail: ok ? null : driver.code === "driver_missing" ? "kanata types through it. Open the installer from its download page." : "The driver here is one kanata can't use. Install this one in its place.",
      link: ok ? null : { href: driverPage(status.driverVersion), label: "Download the driver" },
    }));
  }

  const port = find("port_closed");
  const daemon = find("daemon_missing");
  const ready = kanata?.code !== "kanata_missing";
  const startable = port?.status !== "ok" && (port !== undefined || daemon?.status === "fail");
  // A kanata that differs from the daemon's copy without looking like a Homebrew update (D-498). Setting up would copy it as root, so
  // the step names what changed, and neither it nor Start asks for the password unless the kanata isn't Homebrew's to put back.
  const replaced = find("kanata_replaced")?.status === "warn";
  if (replaced) {
    const { path, version, copyVersion } = status.kanata;
    const fromBrew = path !== null && path.includes("/Cellar/kanata/");
    const title = "kanata changed outside Homebrew";
    const job = fromBrew ? installJob(status, "reinstall", title) : null;
    const what = `${path ?? "The kanata keyloom finds"} is ${version === null ? "a version keyloom couldn't read" : `version ${version}`}, and kanata's background service runs ${copyVersion === null ? "a version keyloom couldn't read" : `version ${copyVersion}`}. Homebrew didn't make this change, so keyloom won't copy it with your password.`;
    steps.push(step({
      key: "replaced", state: "todo", title: job?.title ?? title, whileRunning: true,
      detail: job?.detail ?? `${what} ${fromBrew ? "Reinstall kanata to put Homebrew's own kanata back." : `If you installed this kanata yourself, set up with it. macOS asks for your password.${driverReady ? "" : " Install the driver above first."}`}`,
      // Setting up starts kanata, which needs the driver, so the button waits for it like Set up and start kanata (PR #319 CodeRabbit).
      actions: job?.actions ?? (fromBrew
        ? status.canInstall ? [{ id: { kind: "reinstall_kanata" }, label: "Reinstall kanata" }] : []
        : mac ? [{ id: { kind: "start_kanata" }, label: "Set up with this kanata", off: !driverReady }] : []),
      log: job?.log ?? null, problem: job?.problem ?? null,
      link: fromBrew && !status.canInstall ? { href: KANATA_RELEASES, label: "Download kanata" } : null,
    }));
  }
  // Installed, but kanata doesn't answer (R11-02): the doctor reads the port as `warn` only while the service is installed. Setting up again
  // would only do the same, so the step restarts the service, unless kanata changed since setup, which Set up and start kanata copies.
  const notAnswering = port?.status === "warn" && daemon?.status === "ok" && ready && !replaced
    && find("kanata_updated")?.status !== "warn" && find("daemon_outdated")?.status !== "warn";
  const permissions = find("permissions") === undefined ? null : step({
    key: "permissions", state: "todo", title: "Allow kanata in Privacy & Security",
    // The kanata to allow is the copy Set up and start kanata makes, so before that step this one says so (R10-03): until then there is
    // nothing in Privacy & Security to turn on.
    detail: startable && !notAnswering
      ? `After the Start kanata step above, turn kanata on under Input Monitoring and under Accessibility. The kanata to allow is keyloom's copy, in ${KANATA_COPY_DIR}, which that step puts there. macOS doesn't let keyloom check this.`
      : `Turn kanata on under Input Monitoring and under Accessibility. The kanata to allow is keyloom's copy, in ${KANATA_COPY_DIR}. macOS doesn't let keyloom check this.`,
    actions: mac ? [{ id: { kind: "open_settings", pane: "input_monitoring" }, label: "Open Input Monitoring settings" }, { id: { kind: "open_settings", pane: "accessibility" }, label: "Open Accessibility settings" }] : [],
  });
  if (port?.status === "ok") steps.push(step({ key: "start", state: "done", title: "kanata is running" }));
  else if (notAnswering) {
    if (permissions !== null) steps.push(permissions);
    const lines = extras.kanataLog ?? null;
    steps.push(step({
      key: "start", state: "todo", title: "kanata's service is installed, but kanata isn't answering",
      detail: !driverReady ? "Install the driver above first."
        : `Restart its service to start kanata again. If kanata isn't on in both panes above yet, turn it on there first, so kanata starts with them. macOS asks for your password. Show kanata's log to see what kanata wrote.${lines !== null && lines.length === 0 ? " kanata's log has nothing in it yet." : ""}`,
      actions: mac ? [
        { id: { kind: "restart_kanata" }, label: "Restart kanata's service", off: !driverReady },
        { id: { kind: "show_kanata_log" }, label: "Show kanata's log" },
      ] : [],
      log: lines !== null && lines.length > 0 ? lines : null, logLabel: "What kanata wrote last",
    }));
  } else if (startable) {
    steps.push(step({
      key: "start", state: "todo", title: "Start kanata",
      // Named after the kanata step's own button: Get kanata on a Mac without Homebrew (D-560).
      detail: !ready ? (kanataWay(status) === "download" ? "Get kanata first." : "Install kanata first.") : replaced ? "Deal with the kanata change above first." : !driverReady ? "Install the driver above first."
        : "macOS asks for your password to copy kanata where only macOS can change it, install its background service and start it.",
      // Off, not hidden, while the driver is still to do: the person sees what comes next, and why it can't run yet (R11-02).
      actions: mac && ready && !replaced ? [{ id: { kind: "start_kanata" }, label: "Set up and start kanata", off: !driverReady }] : [],
    }));
  }
  if (permissions !== null && !notAnswering) steps.push(permissions);

  // The daemon runs keyloom's own copy of kanata (D-498). While kanata is stopped, Start kanata above copies it again, so this step
  // only appears while it runs.
  if (!startable) {
    const updated = find("kanata_updated");
    const outdated = find("daemon_outdated");
    const again: SetupAction[] = mac ? [{ id: { kind: "start_kanata" }, label: "Set up and start kanata", off: !driverReady }] : [];
    const needsDriver = driverReady ? "" : " Install the driver above first.";
    if (updated?.status === "warn") {
      const { path, version } = status.kanata;
      steps.push(step({
        key: "copy", state: "todo", title: "kanata was updated. Set it up again", whileRunning: true, actions: again,
        detail: `Homebrew updated kanata${version === null ? "" : ` to ${version}`}${path === null ? "" : `, at ${path}`}. kanata's background service still runs the kanata from before. Setting up again copies the new one, and macOS asks for your password.${needsDriver}`,
      }));
    } else if (outdated?.status === "warn") {
      steps.push(step({
        key: "copy", state: "todo", title: "Set kanata up again", whileRunning: true, actions: again,
        detail: `kanata's background service runs kanata from a folder apps running as you can change. Setting up again runs keyloom's own copy, in ${KANATA_COPY_DIR}, which only macOS can change. macOS asks for your password.${needsDriver}`,
      }));
    }
  }

  // kanata takes the built-in keyboard by the name keyloom's board gives it. A Mac model keyloom doesn't know names it differently, so
  // kanata can run with every step done and remap nothing (R9-12). keyloom can't learn the name by itself: the board has to name it.
  if (find("keyboard_name")?.status === "warn") {
    steps.push(step({
      key: "keyboard-name", state: "todo", title: "kanata can't find this Mac's keyboard", whileRunning: true,
      detail: "This Mac's built-in keyboard has a name keyloom doesn't know yet, so kanata leaves it alone and nothing is remapped. keyloom can remap it once its MacBook board knows this Mac model. The contribution guide says how to add it.",
      link: { href: CONTRIBUTION_GUIDE, label: "Open the contribution guide" },
    }));
  }

  if (find("karabiner_config")?.status === "warn") {
    // The button only where the app is there to open: the doctor's karabiner_elements finding is its installed copy (R3-21).
    const installed = find("karabiner_elements") !== undefined;
    steps.push(step({
      // While kanata runs is when both remappers grab the keyboard, so the running view keeps this step (whileRunning).
      key: "karabiner", state: "note", title: "Karabiner-Elements also takes this keyboard", whileRunning: true,
      // The edit the Karabiner import showed, here too (R11-01): keyloom never writes karabiner.json (D-233), so the person adds it.
      detail: `In Karabiner-Elements, turn off its rules for the built-in keyboard, or both remappers grab it.${status.karabinerEntry === undefined ? "" : ` Or ${KARABINER_ENTRY_WORDS}`}`,
      copy: status.karabinerEntry === undefined ? null : { text: status.karabinerEntry, noun: "entry" },
      actions: mac && installed ? [{ id: { kind: "open_settings", pane: "karabiner_elements" }, label: "Open Karabiner-Elements" }] : [],
    }));
  }
  if (find("karabiner_elements")?.status === "warn") {
    steps.push(step({ key: "karabiner-upgrade", state: "note", title: "Don't upgrade Karabiner-Elements", detail: "Version 16 replaces the driver with one kanata can't use yet." }));
  }
  return steps;
}

/**
 * No built-in keyboard at all: there is nothing for this board to remap, and no name to add (R10-14). keyloom offers set-up only for a
 * keyboard it supports that it sees on USB (`SyncEngine.setupBoards`), so the words promise no more than that, and any other keyboard
 * gets the contribution guide.
 */
function noBuiltInKeyboard(): SetupStep {
  return step({
    key: "keyboard-name", state: "note", title: "This Mac has no built-in keyboard", whileRunning: true,
    detail: "The MacBook board remaps a MacBook's own keyboard, so kanata has nothing to remap here and needs no setup. When you plug in a keyboard keyloom supports, such as a Moonlander or a Glove80, keyloom offers to set it up. For any other keyboard, the contribution guide says how to add it to keyloom.",
    link: { href: CONTRIBUTION_GUIDE, label: "Open the contribution guide" },
  });
}

/** How the checklist gets kanata: Homebrew first, else keyloom's own download (D-560), else kanata's releases page. */
const kanataWay = (status: RemapperSetupResponse): "brew" | "download" | "page" => (status.canInstall ? "brew" : status.canDownload === true ? "download" : "page");

/**
 * kanata isn't on this Mac. With Homebrew, Install kanata. Without it, Get kanata: keyloom downloads kanata's pinned release, checks it and
 * keeps it in its own folder (D-560). A failed Homebrew install offers the download too, so it never ends at a link. Only a Mac whose
 * processor has no release file gets the releases page alone.
 */
function kanataMissing(status: RemapperSetupResponse, keptChanged: boolean): SetupStep {
  const canDownload = status.canDownload === true;
  const way = kanataWay(status);
  const job = installJob(status, "download", "Get kanata") ?? installJob(status, "install", "Install kanata");
  const brewFailed = status.install.action === "install" && status.install.state === "failed";
  const downloadFailed = status.install.action === "download" && status.install.state === "failed";
  // keyloom's downloaded kanata changed after the download, so it isn't used (D-560); Get kanata replaces it.
  const lead = keptChanged
    ? "keyloom's copy of kanata changed since keyloom downloaded it, so keyloom won't use it or set it up."
    : "kanata is the remapper keyloom writes your MacBook layout for.";
  const FIRST = {
    brew: { title: "Install kanata", detail: lead, actions: [{ id: { kind: "install_kanata" }, label: "Install kanata" }] },
    download: {
      title: "Get kanata", actions: [{ id: { kind: "download_kanata" }, label: "Get kanata" }],
      detail: `${lead} Homebrew isn't on this Mac, so keyloom downloads kanata ${status.kanata.wanted} from its official release on GitHub, checks it and keeps it in keyloom's own folder.`,
    },
    page: { title: "Install kanata", actions: [], detail: `${lead} Homebrew isn't on this Mac, and kanata's release has no download for this Mac's processor. Its releases page lists what there is. ${kanataPlacement()}` },
  } satisfies Record<typeof way, Pick<SetupStep, "title" | "detail" | "actions">>;
  const actions = job?.actions ?? FIRST[way].actions;
  return step({
    key: "kanata", state: "todo", title: job?.title ?? FIRST[way].title, whileRunning: true,
    detail: job?.detail ?? FIRST[way].detail,
    // After a failed Homebrew install, keyloom's own download is the other way, as a button.
    actions: brewFailed && canDownload ? [...actions, { id: { kind: "download_kanata" }, label: "Download kanata" }] : actions,
    log: job?.log ?? null, problem: job?.problem ?? null,
    link: downloadFailed
      ? { href: kanataRelease(status.kanata.wanted), label: "Open kanata's release page" }
      : !canDownload && (!status.canInstall || brewFailed) ? { href: KANATA_RELEASES, label: "Download kanata" } : null,
  });
}

/** The steps that still need doing while kanata runs: an update, setting it up again, or a kanata changed outside Homebrew. */
export const attentionSteps = (status: RemapperSetupResponse): SetupStep[] => setupSteps(status).filter((s) => s.whileRunning && s.state !== "done");

/** What to say, and where to go, for a setup step that didn't work; `action` is a step's button that gets past it (R11-02). */
export type SetupFailure = { text: string; link: SetupStep["link"]; action?: SetupAction };

const SET_UP_AGAIN: SetupAction = { id: { kind: "start_kanata" }, label: "Set up and start kanata" };
// keyloom sets up the first kanata it finds (findKanata), so a new one must take the refused one's place to be used (R12-02).
const CMD_PLACEMENT = "keyloom sets up the first kanata it finds, so put the new one, named kanata, in place of this one.";
const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** The SetupFailure for a step's code. `kind` is the button that was pressed, for the words of a closed password dialog. */
export function setupFailure(code: string, reason: string, kind?: SetupActionId["kind"]): SetupFailure {
  switch (code) {
    case "cancelled":
      if (kind === "restart_kanata") return { text: "You cancelled the password dialog, so kanata's service wasn't restarted. Press Restart kanata's service again when you're ready.", link: null };
      if (kind === "show_kanata_log") return { text: "You cancelled the password dialog, so keyloom didn't read kanata's log. Press Show kanata's log again when you're ready.", link: null };
      return { text: "You cancelled the password dialog, so kanata didn't start. Press the button again when you're ready.", link: null };
    // Restart kanata's service ran, and kanata still didn't answer after it (R11-02). The step's own Show kanata's log, right above, is
    // what can say more, so the line adds no second one.
    case "still_not_answering": return { text: "keyloom restarted kanata's service, but kanata still doesn't answer. Check that kanata is on in both Privacy & Security panes above, then restart it again, or show kanata's log.", link: null };
    // The restart script found a service setup didn't make, so it restarted nothing (daemon-service.ts); setting up again makes it.
    case "service_missing":
    case "service_outdated": return { text: "kanata's background service isn't the one keyloom sets up, so keyloom restarted nothing. Set kanata up again to replace it. macOS asks for your password.", link: null, action: SET_UP_AGAIN };
    case "log_missing": return { text: "kanata has no log yet: its service writes one once kanata starts.", link: null };
    case "no_kanata": return { text: "Install kanata first.", link: null };
    // Get kanata on a Mac whose processor has no kanata release file (D-560).
    case "no_asset": return { text: reason, link: { href: KANATA_RELEASES, label: "Open kanata's releases page" } };
    // Homebrew went away between the read and the press: the re-read after it shows the kanata step's other way, so this line names no
    // other way of its own to contradict it (R12-07).
    case "no_brew": return { text: "Homebrew isn't on this Mac now, so keyloom can't install kanata with it. The kanata step above now shows the other way to get it.", link: null };
    // launchctl bootstrap failed twice, in Set up and start kanata (daemon-install.ts) or in Restart kanata's service (daemon-service.ts).
    // Setting up again installs the service afresh, so it is the way on after a restart; after a start the step's own button is that (R12-05).
    case "root_start_failed":
      return kind === "restart_kanata"
        ? { text: "macOS didn't start kanata's background service again. Set kanata up again to install the service afresh and start it. macOS asks for your password.", link: null, action: SET_UP_AGAIN }
        : { text: "macOS didn't start kanata's background service. Press the button again to set it up afresh. macOS asks for your password.", link: null };
    // A kanata that can run programs is never run as root (D-498). The release page's plain builds can't.
    // The root script found kanata changed between keyloom's check and the copy, and installed nothing (D-498).
    // keyloom's downloaded kanata changed since the download (D-560); the kanata step offers Get kanata, which replaces it.
    case "kanata_kept_changed": return { text: "keyloom's copy of kanata changed since keyloom downloaded it, so keyloom won't set it up. Get kanata again to replace it.", link: null };
    case "kanata_swapped": return { text: "kanata changed while macOS asked for your password, so keyloom installed nothing. Press the button again to check kanata and set it up.", link: null };
    case "kanata_cmd_unknown": return { text: `${reason} Install Homebrew's kanata, or download a release build whose name doesn't say cmd_allowed. ${CMD_PLACEMENT}`, link: { href: KANATA_RELEASES, label: "Download kanata" } };
    case "kanata_allows_cmd": return { text: `This kanata can run programs from its config, so keyloom won't run it as root. Install a kanata without that feature: Homebrew's, or a release build whose name doesn't say cmd_allowed. ${CMD_PLACEMENT}`, link: { href: KANATA_RELEASES, label: "Download kanata" } };
    default: return { text: reason, link: null };
  }
}
