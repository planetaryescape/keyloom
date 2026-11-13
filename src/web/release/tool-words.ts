// The words of the flash step while its tool is missing (D-489): how keyloom gets it here, what it says while it does, and what a failure
// says. Plain functions, so they are tested without a browser.
import type { InstallState } from "../../api/tool-install.ts";
import { type FlashStepView, plain } from "./release-words.ts";

type NeedsTool = Extract<FlashStepView, { kind: "needs-tool" }>;

/** How the step gets the tool: Homebrew, keyloom's own download of the pinned release where Homebrew isn't (D-561), or the tool's page. */
export type ToolWay = "brew" | "download" | "page";
export const toolWay = (view: NeedsTool): ToolWay => (view.canInstall ? "brew" : view.canDownload ? "download" : "page");

/**
 * Where a Zapp from its page must go (R12-02): the flash looks for it on PATH and in keyloom's own folder, which only keyloom's download
 * fills (findTool), so a file left in Downloads is never found. On Linux Zapp also needs ZSA's udev rules to reach the keyboard without root,
 * as the CLI says (zappMissing).
 */
export function zappPlacement(linux: boolean): string {
  const path = "Put the zapp program in a folder on your PATH, such as /usr/local/bin, because keyloom looks for it there.";
  return linux ? `${path} Also add ZSA's udev rules from the same page, so Zapp can reach the keyboard without root.` : path;
}

/**
 * Whether the missing step offers keyloom's own download beside Install with Homebrew (R13-02). Always where there is a release file for
 * this computer, with Homebrew first: a cancelled install, or a reload after a failed one, leaves no failure to hang the offer on, and the
 * person shouldn't have to run Homebrew again and wait for it to fail to get it back.
 */
export const missingDownload = (view: NeedsTool): boolean => toolWay(view) === "brew" && view.downloadable;

/** `linux`: the page runs on a Linux computer (linuxBrowser), where Zapp needs its udev rules. */
export function toolMissingLead(view: NeedsTool, boardName: string, linux = false): string {
  const lead = `keyloom flashes your ${boardName} with ${view.name}, and this computer doesn't have it yet.`;
  switch (toolWay(view)) {
    case "brew": return missingDownload(view)
      ? `${lead} keyloom can install it with Homebrew, or download it from its official release on GitHub, check it against the checksum keyloom carries, and keep it in keyloom's own folder.`
      : `${lead} keyloom can install it with Homebrew.`;
    case "download": return `${lead} Homebrew isn't here, so keyloom downloads ${view.name} from its official release on GitHub, checks it against the checksum keyloom carries, and keeps it in keyloom's own folder.`;
    case "page": return view.tool === "zapp" ? `${lead} Get it from its page. ${zappPlacement(linux)} Then check again.` : `${lead} Install it, then check again.`;
  }
}

/** The download codes, from Get Zapp's own download or Download Zapp after a failed Homebrew install (D-561, R12-01). */
const DOWNLOAD_CODES: ReadonlySet<InstallState["errorCode"]> = new Set(["download_failed", "checksum_mismatch", "write_failed", "no_asset", "unsupported_platform"]);

/**
 * The buttons beside a failed install. Try again repeats the way that failed: keyloom's download after a failed download, Homebrew after
 * Homebrew. After a failed Homebrew install, keyloom's own download of the pinned release is offered beside it, where there is one for this
 * computer (R12-01), as kanata's step does (D-560). The tool's page is named as a page wherever a button already says Get or Download.
 */
export function failedWays(view: NeedsTool, state: InstallState): { retry: "again" | "download"; download: boolean; page: string } {
  const downloaded = DOWNLOAD_CODES.has(state.errorCode);
  const download = !downloaded && state.errorCode === "brew_failed" && view.downloadable;
  return { retry: downloaded ? "download" : "again", download, page: downloaded || download || toolWay(view) === "download" ? `Open ${view.name}'s page` : `Get ${view.name}` };
}

export function toolRunning(view: NeedsTool, state: InstallState): string {
  if (state.phase === "stopping") return "Stopping the install.";
  if (state.phase === "downloading") return `Getting ${view.name} from its release on GitHub. This takes a few seconds.`;
  return `Installing ${view.name} with Homebrew. This takes a minute or two.`;
}

/**
 * What a failed install says. Its code says which way failed: keyloom's download (Get, or Download after Homebrew failed) or Homebrew. After
 * a failed Homebrew install with a download here, it says what Download does (R12-01). Zapp's page is linked beside every failure, so the
 * words say where a Zapp from it must go (R12-02, PR #321 review); a checksum mismatch's own reason already says so.
 */
export function toolFailed(view: NeedsTool, state: InstallState, linux = false): string {
  const reason = plain(state.error ?? "");
  const page = view.tool === "zapp" && state.errorCode !== "checksum_mismatch" ? ` If you get Zapp from its page, ${lowerFirst(zappPlacement(linux))}` : "";
  if (DOWNLOAD_CODES.has(state.errorCode)) return `keyloom couldn't get ${view.name}. ${reason}`.trim() + page;
  const other = failedWays(view, state).download
    ? ` Or keyloom can download ${view.name} from its official release on GitHub, check it against the checksum keyloom carries, and keep it in keyloom's own folder.`
    : "";
  return `${view.name} didn't install. ${reason}`.trim() + other + page;
}

const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
