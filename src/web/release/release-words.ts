// What the release dialog shows for Docker and for the flash step, as plain data, so the choices are tested without a
// browser. Every state names what happened and the button that fixes it (D-488 to D-490).
import type { FlashPlan } from "../../api/http.ts";
import type { DockerProblem, DockerReadinessResponse } from "../../api/system.ts";
import type { InstallState, InstallableTool } from "../../api/tool-install.ts";

type Alternative = { name: string; url: string };

export type DockerView =
  /** Up, or the page can't tell: nothing to show. */
  | { kind: "none" }
  /** A start from this page is running; `verb` says whether it starts, opens (for its CLI) or restarts the engine. */
  | { kind: "starting"; engine: string; verb: "Starting" | "Opening" | "Restarting" }
  /**
   * A start from this page failed. `retry` repeats what failed, or is null when repeating it would fail the same way. `restartEngine` is
   * the engine to stop and start from scratch instead (Colima, R3-04), and `helpUrl` the engine's own troubleshooting page once that
   * restart failed too.
   */
  | { kind: "start-failed"; reason: string; retry: "start" | "restart" | null; restartEngine: string | null; helpUrl: string | null }
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
   * `restartApp` is the Mac app keyloom can restart instead (R2-07).
   */
  | { kind: "no-access"; command: string | null; note: string; restartApp: string | null }
  /**
   * Stopped. `afterInstall` is set when this page installed Docker but its first start failed or was stopped (R2-02): Docker is
   * there, so the way on is a start, not another install.
   */
  | { kind: "down"; engine: string; canStart: boolean; afterInstall: { cancelled: boolean; reason: string } | null; restartEngine: string | null };

/** Colima's FAQ, whose Troubleshooting section covers a VM that won't start (checked 2026-11-11). */
export const COLIMA_HELP_URL = "https://colima.run/docs/faq/";

/** Server sentences are also printed in a terminal, where `code` reads well; on the page the backticks are noise. */
export const plain = (text: string): string => text.replace(/`/g, "");

/** `lastAction` is what this page last asked for: a start, or a restart (of the Mac app, or of Colima). */
export function dockerView(readiness: DockerReadinessResponse | null, starting: boolean, problem: string | null, install: InstallState | null, lastAction: "start" | "restart" | null = null): DockerView {
  const down = readiness !== null && !readiness.ok ? readiness : null;
  if (install?.status === "running") return { kind: "installing", phase: install.phase ?? "installing", logTail: install.logTail };
  // A start that failed after a good install isn't an install failure: Docker is there, and the readiness below offers the start.
  if (install?.status === "failed" && install.errorCode !== "start_failed" && !(readiness?.ok ?? false)) {
    return { kind: "install-failed", reason: plain(install.error ?? "The install failed."), logTail: install.logTail, alternatives: down?.install?.alternatives ?? [] };
  }
  // A Mac app that refuses keyloom is restarted rather than started, so its progress and its Try again say so.
  const restartApp = down?.problem === "no-access" ? down.access?.restartApp ?? null : null;
  const restartEngine = down?.restartEngine ?? null;
  if (starting) {
    if (restartApp !== null) return { kind: "starting", engine: restartApp, verb: "Restarting" };
    if (restartEngine !== null && lastAction === "restart") return { kind: "starting", engine: restartEngine, verb: "Restarting" };
    return { kind: "starting", engine: down?.engine ?? "Docker", verb: down?.problem === "cli-missing" ? "Opening" : "Starting" };
  }
  // A Docker that answers now outranks how an earlier start from this page failed.
  if (problem !== null && readiness?.ok !== true) {
    if (restartApp !== null) return { kind: "start-failed", reason: plain(problem), retry: "restart", restartEngine: null, helpUrl: null };
    // A Colima that wouldn't start fails the same way again, so its way on is a restart from scratch; after that, its own guide (R3-04).
    if (restartEngine !== null) {
      return lastAction === "restart"
        ? { kind: "start-failed", reason: plain(problem), retry: null, restartEngine: null, helpUrl: COLIMA_HELP_URL }
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
  if (down.problem === "no-access" && down.access !== null) return { kind: "no-access", command: down.access.command, note: down.access.note, restartApp: down.access.restartApp };
  if (down.engine === null) return { kind: "other", reason: plain(down.reason), problem: down.problem };
  return { kind: "down", engine: down.engine, canStart: down.canStart, afterInstall: afterInstall(install), restartEngine };
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
    case "no-access": return "Give keyloom access to Docker first.";
    case "cli-missing": return "Install Docker's command line tools first.";
    // An engine keyloom can't start fails the build the same way; one that only answered slowly may still come up, and the build waits for it.
    case "other": return view.problem === "slow" ? null : view.problem === "cli-missing" ? "Install Docker's command line tools first." : "Start your Docker engine first.";
    default: return null;
  }
}

/** Whether the dialog should ask the server again by itself: only while Docker is missing and nothing is running. */
export const recheckDocker = (view: DockerView): boolean => view.kind === "install" || view.kind === "download" || view.kind === "other" || view.kind === "cli-missing";

const TOOL_NAMES = { docker: "Docker", zapp: "Zapp", "dfu-util": "dfu-util", "dfu-programmer": "dfu-programmer", avrdude: "avrdude" } satisfies Record<InstallableTool, string>;
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
