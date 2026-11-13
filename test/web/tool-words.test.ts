// The flash step's words while its tool is missing (D-489): Homebrew where it is, keyloom's own download of Zapp's pinned release where it
// isn't (D-561), and the tool's page otherwise.
import { describe, expect, test } from "bun:test";
import type { InstallState } from "../../src/api/tool-install.ts";
import { flashStepView } from "../../src/web/release/release-words.ts";
import { failedWays, toolFailed, toolMissingLead, toolRunning, toolWay } from "../../src/web/release/tool-words.ts";

const view = (canInstall: boolean, canDownload?: boolean, downloadable?: boolean) => {
  const v = flashStepView({
    manual: null, canReveal: true,
    tool: { name: "zapp", installed: false, canInstall, ...(canDownload === undefined ? {} : { canDownload }), ...(downloadable === undefined ? {} : { downloadable }), url: "https://github.com/zsa/zapp" },
  });
  if (v.kind !== "needs-tool") throw new Error("expected needs-tool");
  return v;
};
const state = (over: Partial<InstallState>): InstallState => ({ tool: "zapp", status: "running", phase: "installing", logTail: [], error: null, errorCode: null, ...over });

describe("the missing tool's step", () => {
  test("Homebrew installs; without it keyloom downloads Zapp; an older server, or no release file, gets the page", () => {
    expect(toolWay(view(true))).toBe("brew");
    expect(toolWay(view(false, true))).toBe("download");
    expect(toolWay(view(false))).toBe("page");
    expect(toolMissingLead(view(false, true), "Moonlander")).toBe(
      "keyloom flashes your Moonlander with Zapp, and this computer doesn't have it yet. Homebrew isn't here, so keyloom downloads Zapp from its official release on GitHub, checks it against the checksum keyloom carries, and keeps it in keyloom's own folder.",
    );
    expect(toolMissingLead(view(true), "Moonlander")).toEndWith("keyloom can install it with Homebrew.");
  });

  // R12-02: a Zapp from its page is found only on PATH, and on Linux it needs ZSA's udev rules.
  test("the page way says where Zapp must go, and on Linux names the udev rules", () => {
    expect(toolMissingLead(view(false, false), "Moonlander")).toBe(
      "keyloom flashes your Moonlander with Zapp, and this computer doesn't have it yet. Get it from its page. Put the zapp program in a folder on your PATH, such as /usr/local/bin, because keyloom looks for it there. Then check again.",
    );
    expect(toolMissingLead(view(false, false), "Moonlander", true)).toContain("Also add ZSA's udev rules from the same page, so Zapp can reach the keyboard without root. Then check again.");
    // keyloom pins no DFU tool: those install from a package manager, which puts them on PATH.
    const dfu = flashStepView({ manual: null, tool: { name: "dfu-util", installed: false, canInstall: false, url: "https://dfu-util.sourceforge.net/" }, canReveal: true });
    if (dfu.kind !== "needs-tool") throw new Error("expected needs-tool");
    expect(toolMissingLead(dfu, "Moonlander", true)).toEndWith("Install it, then check again.");
  });

  test("while it runs, the step says which way it is going", () => {
    expect(toolRunning(view(false, true), state({ phase: "downloading" }))).toBe("Getting Zapp from its release on GitHub. This takes a few seconds.");
    expect(toolRunning(view(true), state({ phase: "installing" }))).toBe("Installing Zapp with Homebrew. This takes a minute or two.");
    expect(toolRunning(view(false, true), state({ phase: "stopping" }))).toBe("Stopping the install.");
  });

  // R12-01: after a failed Homebrew install, keyloom's own download is the other way on, as kanata's step has it (D-560).
  test("a failed Homebrew install offers Download Zapp where a release file is, and Try again repeats the way that failed", () => {
    const brewFailed = state({ status: "failed", phase: null, errorCode: "brew_failed", error: "Homebrew stopped with exit code 1." });
    expect(failedWays(view(true, false, true), brewFailed)).toEqual({ retry: "again", download: true, page: "Open Zapp's page" });
    expect(toolFailed(view(true, false, true), brewFailed)).toBe(
      "Zapp didn't install. Homebrew stopped with exit code 1. Or keyloom can download Zapp from its official release on GitHub, check it against the checksum keyloom carries, and keep it in keyloom's own folder.",
    );
    // No release file for this computer, or an older server: Homebrew's Try again and the page, as before.
    expect(failedWays(view(true, false, false), brewFailed)).toEqual({ retry: "again", download: false, page: "Get Zapp" });
    expect(failedWays(view(true), brewFailed).download).toBe(false);
    expect(toolFailed(view(true), brewFailed)).toBe("Zapp didn't install. Homebrew stopped with exit code 1.");
    // A start that failed after the install (Docker's) is not Homebrew failing, so no download.
    expect(failedWays(view(true, false, true), state({ status: "failed", errorCode: "start_failed" })).download).toBe(false);
    // The download then failed: Try again downloads again, and no second Download button.
    const mismatch = state({ status: "failed", phase: null, errorCode: "checksum_mismatch", error: "The file keyloom downloaded isn't Zapp 1.0.2 as released." });
    expect(failedWays(view(true, false, true), mismatch)).toEqual({ retry: "download", download: false, page: "Open Zapp's page" });
    expect(toolFailed(view(true, false, true), mismatch)).toBe("keyloom couldn't get Zapp. The file keyloom downloaded isn't Zapp 1.0.2 as released.");
    // Get Zapp without Homebrew: its page is named as a page beside the Get button.
    expect(failedWays(view(false, true, true), mismatch).page).toBe("Open Zapp's page");
  });

  test("a failed download says keyloom couldn't get it; a failed Homebrew install says it didn't install", () => {
    expect(toolFailed(view(false, true), state({ status: "failed", errorCode: "checksum_mismatch", error: "The file keyloom downloaded isn't Zapp 1.0.2 as released." })))
      .toBe("keyloom couldn't get Zapp. The file keyloom downloaded isn't Zapp 1.0.2 as released.");
    expect(toolFailed(view(true), state({ status: "failed", errorCode: "brew_failed", error: "Homebrew stopped with exit code 1." }))).toBe("Zapp didn't install. Homebrew stopped with exit code 1.");
  });
});
