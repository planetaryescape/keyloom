// What the release dialog shows for Docker and for the flash step, as plain data, so the choices are tested without a
// browser. Every state names what happened and the button that fixes it (D-488 to D-490).
import type { FlashPlan } from "../../api/http.ts";
import type { DockerProblem, DockerReadinessResponse, DockerStartResponse } from "../../api/system.ts";
import type { InstallState, InstallableTool } from "../../api/tool-install.ts";

type Alternative = { name: string; url: string };

export type DockerView =
  /** Up, or the page can't tell: nothing to show. */
  | { kind: "none" }
  /** A start from this page is running; `verb` says whether it starts, opens (for its CLI) or restarts the engine. */
  | { kind: "starting"; engine: string; verb: "Starting" | "Opening" | "Restarting" }
  /** Fix Colima's files from this page is running: macOS's password dialog, then Colima starting as the person (D-533). */
  | { kind: "fixing-files" }
  /**
   * A start from this page failed. `retry` repeats what failed, or is null when repeating it would fail the same way. `restartEngine` is
   * the engine to stop and start from scratch instead (Colima, R3-04), and `helpUrl` the engine's own troubleshooting page once that
   * restart failed too, with `alternatives`: the engines to install instead (R4-04b).
   */
  | { kind: "start-failed"; reason: string; retry: "start" | "restart" | null; restartEngine: string | null; helpUrl: string | null; alternatives?: Alternative[] }
  /** No Docker, and keyloom can install it: the Install Docker button. `stopped` when the person cancelled the last install. */
  | { kind: "install"; engine: string; note: string; alternatives: Alternative[]; stopped: boolean }
  /** No Docker, and keyloom can't install it here: the download page. */
  | { kind: "download"; engine: string; url: string; note: string; alternatives: Alternative[] }
  | { kind: "installing"; phase: "installing" | "starting" | "stopping"; logTail: string[] }
  /** Homebrew failed: Try again, or install another engine by hand (R2-05). */
  | { kind: "install-failed"; reason: string; logTail: string[]; alternatives: Alternative[] }
  /** Installed from this page and answering now. */
  | { kind: "installed" }
  /** An engine keyloom can't start (another machine, an unknown socket): its own sentence and Check again. */
  | { kind: "other"; reason: string; problem: DockerProblem }
  /** An engine app whose `docker` command isn't set up: opening the app sets it up (R2-07). */
  | { kind: "cli-missing"; app: string }
  /**
   * The daemon runs but refuses this account (D-497): the command to copy where there is one, what to do after, and Check again.
   * `restartApp` is the Mac app keyloom can restart instead (R2-07). `fix` is Fix Colima's files, for a Colima on a Mac (D-533): `offered`
   * shows the button, which a failure other than a cancel or a running build takes away, and `note` says how the last one ended. `command`
   * is null once a fix has found a linked file, until a fix completes, because its `chown -R` would change the very file the fix refused to.
   */
  | { kind: "no-access"; command: string | null; note: string; restartApp: string | null; fix: { offered: boolean; note: string | null } | null }
  /**
   * Stopped. `afterInstall` is set when this page installed Docker but its first start failed or was stopped (R2-02): Docker is
   * there, so the way on is a start, not another install.
   */
  | { kind: "down"; engine: string; canStart: boolean; afterInstall: { cancelled: boolean; reason: string } | null; restartEngine: string | null };

/** Colima's FAQ, whose Troubleshooting section covers a VM that won't start (checked 2026-11-11). */
export const COLIMA_HELP_URL = "https://colima.run/docs/faq/";

/** Server sentences are also printed in a terminal, where `code` reads well; on the page the backticks are noise. */
export const plain = (text: string): string => text.replace(/`/g, "");

/**
 * `lastAction` is what this page last asked for: a start, a restart (of the Mac app, or of Colima), or Fix Colima's files. `problemCode` is
 * the server's code for `problem`. `linkedFile` is set while a linked file found by Fix Colima's files may still be there (`linkedFileAfter`).
 */
export function dockerView(
  readiness: DockerReadinessResponse | null, starting: boolean, problem: string | null, install: InstallState | null,
  lastAction: "start" | "restart" | "fix-files" | null = null, problemCode: string | null = null, linkedFile = false,
): DockerView {
  const down = readiness !== null && !readiness.ok ? readiness : null;
  if (install?.status === "running") return { kind: "installing", phase: install.phase ?? "installing", logTail: install.logTail };
  // A start that failed after a good install isn't an install failure: Docker is there, and the readiness below offers the start.
  if (install?.status === "failed" && install.errorCode !== "start_failed" && !(readiness?.ok ?? false)) {
    return { kind: "install-failed", reason: plain(install.error ?? "The install failed."), logTail: install.logTail, alternatives: down?.install?.alternatives ?? [] };
  }
  // A Mac app that refuses keyloom is restarted rather than started, so its progress and its Try again say so.
  const restartApp = down?.problem === "no-access" ? down.access?.restartApp ?? null : null;
  const restartEngine = down?.restartEngine ?? null;
  // keyloom may be starting the engine for something else, such as a build or another page (R4-04): the page follows that one.
  const elsewhere = down?.engineAction ?? null;
  // Another page's fix keeps its own words too: its password dialog can stay open for minutes, which "Starting Colima" would misstate.
  if ((starting ? lastAction : elsewhere) === "fix-files") return { kind: "fixing-files" };
  if (starting || elsewhere !== null) {
    const restarting = starting ? lastAction === "restart" : elsewhere === "restart";
    if (restartApp !== null) return { kind: "starting", engine: restartApp, verb: "Restarting" };
    if (restartEngine !== null && restarting) return { kind: "starting", engine: restartEngine, verb: "Restarting" };
    return { kind: "starting", engine: down?.engine ?? "Docker", verb: down?.problem === "cli-missing" ? "Opening" : "Starting" };
  }
  // A Docker that answers now outranks how an earlier start from this page failed.
  if (problem !== null && readiness?.ok !== true) {
    // While Docker still refuses, the fix's outcome stays beside it; once Docker needs something else, that readiness decides below.
    if (lastAction === "fix-files" && down?.problem === "no-access" && down.access !== null) {
      const noCommand = linkedFile || down.access.linkedFile === true || problemCode === "linked_file";
      return noAccess(down.access, fixOutcome(problem, problemCode, noCommand), noCommand);
    }
    if (restartApp !== null) return { kind: "start-failed", reason: plain(problem), retry: "restart", restartEngine: null, helpUrl: null };
    // A Colima that wouldn't start fails the same way again, so its way on is a restart from scratch; after that, its own guide (R3-04).
    if (restartEngine !== null) {
      return lastAction === "restart"
        ? { kind: "start-failed", reason: plain(problem), retry: null, restartEngine: null, helpUrl: COLIMA_HELP_URL, alternatives: down?.alternatives ?? [] }
        : { kind: "start-failed", reason: plain(problem), retry: null, restartEngine, helpUrl: null };
    }
    return { kind: "start-failed", reason: plain(problem), retry: "start", restartEngine: null, helpUrl: null };
  }
  if (readiness?.ok === true && install?.status === "succeeded") return { kind: "installed" };
  if (down === null) return { kind: "none" };
  if (down.problem === "not-installed" && down.install !== null) {
    const i = down.install;
    return i.canInstall
      ? { kind: "install", engine: i.engine, note: i.note, alternatives: i.alternatives, stopped: install?.status === "cancelled" }
      : { kind: "download", engine: i.engine, url: i.url, note: i.note, alternatives: i.alternatives };
  }
  if (down.problem === "cli-missing" && down.engine !== null) return { kind: "cli-missing", app: down.engine };
  if (down.problem === "no-access" && down.access !== null) {
    // The server holds the command back too, so a reload or another page says the same (PR #300 CodeRabbit).
    const held = linkedFile || down.access.linkedFile === true;
    return noAccess(down.access, { offered: true, note: held ? LINKED_FILE_HELD : null }, held);
  }
  if (down.engine === null) return { kind: "other", reason: plain(down.reason), problem: down.problem };
  return { kind: "down", engine: down.engine, canStart: down.canStart, afterInstall: afterInstall(install), restartEngine };
}

type Access = NonNullable<Extract<DockerReadinessResponse, { ok: false }>["access"]>;

const LINKED_FILE_HELD = "A file in Colima's folder also has a name somewhere else, so keyloom doesn't offer Colima's command, which would change that file's owner too. Check what the file is. Fix Colima's files looks for it again and changes nothing while it is there.";

function noAccess(access: Access, fix: { offered: boolean; note: string | null }, noCommand = false): Extract<DockerView, { kind: "no-access" }> {
  return { kind: "no-access", command: noCommand ? null : access.command, note: access.note, restartApp: access.restartApp, fix: access.fixFiles === true ? fix : null };
}

/**
 * How Fix Colima's files ended, in the page's words for the codes it acts on. A closed password dialog or a running build keeps the
 * button: the next press can work. Any other failure is shown and the button goes, because pressing it again would fail the same way;
 * the command to copy and Check again stay (D-533). With no command to copy (`noCommand`, after a linked file), the button stays, because
 * it is then the only way on, and it checks for the linked file again.
 */
function fixOutcome(problem: string, code: string | null, noCommand: boolean): { offered: boolean; note: string } {
  const reason = plain(problem).replace(/\.?$/, ".");
  if (code === "cancelled") return { offered: true, note: "You closed the password dialog, so nothing changed." };
  if (code === "build_running") return { offered: true, note: "A build or flash is running, and stopping Colima now would stop it. Fix Colima's files once it has finished." };
  // The file may belong to macOS, so the way on is to look at it first; the button checks again once it is dealt with.
  if (code === "linked_file") return { offered: true, note: `${reason} A file with two names can be one of macOS's own, so check what it is before anything changes its owner.` };
  // keyloom won't run Colima as root to stop that copy (D-533); Colima's command does, as the person's own step.
  if (code === "vm_running") {
    return noCommand
      ? { offered: true, note: `${reason} Stop that copy of Colima, then press Fix Colima's files again.` }
      : { offered: false, note: `${reason} The command below stops that copy, gives the files back and starts Colima as you.` };
  }
  return { offered: noCommand, note: plain(problem) };
}

/**
 * Whether the page still holds back Colima's command after a fix ended (PR #300 CodeRabbit). A linked file sets it, and only a fix that
 * completed clears it: a cancel or a refusal that came after says nothing about the file, so its code can't bring the command back.
 */
export function linkedFileAfter(before: boolean, action: "start" | "restart" | "fix-files", result: DockerStartResponse): boolean {
  if (action !== "fix-files") return before;
  if (result.ok) return false;
  return before || result.code === "linked_file";
}

/** How this page's own install ended, when Docker is there but stopped: its first start failed, or the person stopped it. */
function afterInstall(install: InstallState | null): { cancelled: boolean; reason: string } | null {
  if (install?.status === "cancelled") return { cancelled: true, reason: "" };
  if (install?.status === "failed" && install.errorCode === "start_failed") return { cancelled: false, reason: plain(install.error ?? "") };
  return null;
}

/** Why Build firmware can't run yet, said next to the button; null when it can. A stopped engine isn't a reason: the build starts it. */
export function buildBlockedReason(view: DockerView): string | null {
  switch (view.kind) {
    case "install": case "download": case "install-failed": return "Install Docker first.";
    case "installing": return view.phase === "stopping" ? "Waiting for the install to stop." : "Waiting for Docker to finish installing.";
    case "starting": return "Waiting for Docker to start.";
    case "fixing-files": return "Waiting for keyloom to fix Colima's files.";
    // A Colima that a restart didn't bring back fails a build the same way (R4-04b).
    case "start-failed": return view.helpUrl === null ? null : "Docker won't start, so a build would stop the same way. Fix it with Colima's guide, or install another engine.";
    case "no-access": return view.fix?.offered === true ? "Fix Colima's files first." : "Give keyloom access to Docker first.";
    case "cli-missing": return "Install Docker's command line tools first.";
    // An engine keyloom can't start fails the build the same way; one that only answered slowly may still come up, and the build waits for it.
    case "other": return view.problem === "slow" ? null : view.problem === "cli-missing" ? "Install Docker's command line tools first." : "Start your Docker engine first.";
    default: return null;
  }
}

/**
 * Why Build firmware is off, said beside it (R4-19): Docker's reason first, then a board revision not chosen yet. Null when it can run.
 */
export function buildDisabledReason(docker: string | null, needsBoardRevision: boolean, boardRevision: string | null, boardName: string): string | null {
  if (docker !== null) return docker;
  return needsBoardRevision && boardRevision === null ? `Choose which ${boardName} this is first.` : null;
}

/** Whether the dialog should ask the server again by itself: only while Docker is missing and nothing is running. */
export const recheckDocker = (view: DockerView): boolean => view.kind === "install" || view.kind === "download" || view.kind === "other" || view.kind === "cli-missing";

const TOOL_NAMES = { docker: "Docker", zapp: "Zapp", "dfu-util": "dfu-util", "dfu-programmer": "dfu-programmer", avrdude: "avrdude", codex: "Codex" } satisfies Record<InstallableTool, string>;
export const toolName = (tool: InstallableTool): string => TOOL_NAMES[tool];

export type FlashStepView =
  | { kind: "flash" }
  /** keyloom can't flash this board: its steps, with the file to download or show. */
  | { kind: "manual"; instructions: string; canReveal: boolean }
  /** The flash tool is missing: install it, or link its page where keyloom can't. */
  | { kind: "needs-tool"; tool: InstallableTool; name: string; canInstall: boolean; url: string };

export function flashStepView(plan: FlashPlan): FlashStepView {
  if (plan.manual !== null) return { kind: "manual", instructions: plan.manual, canReveal: plan.canReveal };
  if (plan.tool !== null && !plan.tool.installed) {
    return { kind: "needs-tool", tool: plan.tool.name, name: toolName(plan.tool.name), canInstall: plan.tool.canInstall, url: plan.tool.url };
  }
  return { kind: "flash" };
}
