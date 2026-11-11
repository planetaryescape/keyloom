// What the release dialog shows for Docker and for the flash step, as plain data, so the choices are tested without a
// browser. Every state names what happened and the button that fixes it (D-488 to D-490).
import type { FlashPlan } from "../../api/http.ts";
import type { DockerReadinessResponse } from "../../api/system.ts";
import type { InstallState, InstallableTool } from "../../api/tool-install.ts";

export type DockerView =
  /** Up, or the page can't tell: nothing to show. */
  | { kind: "none" }
  | { kind: "starting"; engine: string }
  | { kind: "start-failed"; reason: string }
  /** No Docker, and keyloom can install it: the Install Docker button. */
  | { kind: "install"; engine: string; note: string; alternatives: Array<{ name: string; url: string }> }
  /** No Docker, and keyloom can't install it here: the download page. */
  | { kind: "download"; engine: string; url: string; note: string; alternatives: Array<{ name: string; url: string }> }
  | { kind: "installing"; phase: "installing" | "starting"; logTail: string[] }
  | { kind: "install-failed"; reason: string; logTail: string[] }
  /** Installed from this page and answering now. */
  | { kind: "installed" }
  /** An engine keyloom can't start (another machine, an unknown socket): its own sentence and Check again. */
  | { kind: "other"; reason: string }
  | { kind: "down"; engine: string; canStart: boolean };

/** Server sentences are also printed in a terminal, where `code` reads well; on the page the backticks are noise. */
export const plain = (text: string): string => text.replace(/`/g, "");

export function dockerView(readiness: DockerReadinessResponse | null, starting: boolean, problem: string | null, install: InstallState | null): DockerView {
  if (install?.status === "running") return { kind: "installing", phase: install.phase ?? "installing", logTail: install.logTail };
  if (install?.status === "failed" && !(readiness?.ok ?? false)) return { kind: "install-failed", reason: plain(install.error ?? "The install failed."), logTail: install.logTail };
  if (starting) return { kind: "starting", engine: readiness !== null && !readiness.ok && readiness.engine !== null ? readiness.engine : "Docker" };
  if (problem !== null) return { kind: "start-failed", reason: plain(problem) };
  if (readiness?.ok === true && install?.status === "succeeded") return { kind: "installed" };
  if (readiness === null || readiness.ok) return { kind: "none" };
  if (readiness.problem === "not-installed" && readiness.install !== null) {
    const i = readiness.install;
    return i.canInstall
      ? { kind: "install", engine: i.engine, note: i.note, alternatives: i.alternatives }
      : { kind: "download", engine: i.engine, url: i.url, note: i.note, alternatives: i.alternatives };
  }
  if (readiness.engine === null) return { kind: "other", reason: plain(readiness.reason) };
  return { kind: "down", engine: readiness.engine, canStart: readiness.canStart };
}

/** Why Build firmware can't run yet, said next to the button; null when it can. A stopped engine isn't a reason: the build starts it. */
export function buildBlockedReason(view: DockerView): string | null {
  switch (view.kind) {
    case "install": case "download": case "install-failed": return "Install Docker first.";
    case "installing": return "Waiting for Docker to finish installing.";
    case "starting": return "Waiting for Docker to start.";
    default: return null;
  }
}

/** Whether the dialog should ask the server again by itself: only while Docker is missing and nothing is running. */
export const recheckDocker = (view: DockerView): boolean => view.kind === "install" || view.kind === "download" || view.kind === "other";

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
