// The words of the flash step while its tool is missing (D-489): how keyloom gets it here, what it says while it does, and what a failure
// says. Plain functions, so they are tested without a browser.
import type { InstallState } from "../../api/tool-install.ts";
import { type FlashStepView, plain } from "./release-words.ts";

type NeedsTool = Extract<FlashStepView, { kind: "needs-tool" }>;

/** How the step gets the tool: Homebrew, keyloom's own download of the pinned release where Homebrew isn't (D-561), or the tool's page. */
export type ToolWay = "brew" | "download" | "page";
export const toolWay = (view: NeedsTool): ToolWay => (view.canInstall ? "brew" : view.canDownload ? "download" : "page");

export function toolMissingLead(view: NeedsTool, boardName: string): string {
  const lead = `keyloom flashes your ${boardName} with ${view.name}, and this computer doesn't have it yet.`;
  switch (toolWay(view)) {
    case "brew": return `${lead} keyloom can install it with Homebrew.`;
    case "download": return `${lead} Homebrew isn't here, so keyloom downloads ${view.name} from its official release on GitHub, checks it against the checksum keyloom carries, and keeps it in keyloom's own folder.`;
    case "page": return `${lead} Install it, then check again.`;
  }
}

/** The tool's page beside a failure: "Get Zapp" is the download button's own name where keyloom downloads it, so the page is named as a page. */
export const toolPageLabel = (view: NeedsTool): string => (toolWay(view) === "download" ? `Open ${view.name}'s page` : `Get ${view.name}`);

export function toolRunning(view: NeedsTool, state: InstallState): string {
  if (state.phase === "stopping") return "Stopping the install.";
  if (state.phase === "downloading") return `Getting ${view.name} from its release on GitHub. This takes a few seconds.`;
  return `Installing ${view.name} with Homebrew. This takes a minute or two.`;
}

const DOWNLOAD_CODES: ReadonlySet<InstallState["errorCode"]> = new Set(["unsupported_platform", "no_asset", "download_failed", "checksum_mismatch", "write_failed"]);

/**
 * What a failed install says, and whether Try again can help. A download that found no release file for this computer fails the same way
 * every time, so it offers only the tool's page and Check again.
 */
export function toolFailed(view: NeedsTool, state: InstallState): { text: string; retry: boolean } {
  const reason = plain(state.error ?? "");
  if (!DOWNLOAD_CODES.has(state.errorCode)) return { text: `${view.name} didn't install. ${reason}`.trim(), retry: true };
  return { text: `keyloom couldn't get ${view.name}. ${reason}`.trim(), retry: state.errorCode !== "no_asset" && state.errorCode !== "unsupported_platform" };
}
