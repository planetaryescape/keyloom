// The flash step's words while its tool is missing (D-489): Homebrew where it is, keyloom's own download of Zapp's pinned release where it
// isn't (D-561), and the tool's page otherwise.
import { describe, expect, test } from "bun:test";
import type { InstallState } from "../../src/api/tool-install.ts";
import { flashStepView } from "../../src/web/release/release-words.ts";
import { toolFailed, toolMissingLead, toolPageLabel, toolRunning, toolWay } from "../../src/web/release/tool-words.ts";

const view = (canInstall: boolean, canDownload?: boolean) => {
  const v = flashStepView({ manual: null, tool: { name: "zapp", installed: false, canInstall, ...(canDownload === undefined ? {} : { canDownload }), url: "https://github.com/zsa/zapp" }, canReveal: true });
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
    // Beside a failure, the page link never shares the download button's name.
    expect(toolPageLabel(view(false, true))).toBe("Open Zapp's page");
    expect(toolPageLabel(view(true))).toBe("Get Zapp");
    expect(toolMissingLead(view(true), "Moonlander")).toEndWith("keyloom can install it with Homebrew.");
    expect(toolMissingLead(view(false, false), "Moonlander")).toEndWith("Install it, then check again.");
  });

  test("while it runs, the step says which way it is going", () => {
    expect(toolRunning(view(false, true), state({ phase: "downloading" }))).toBe("Getting Zapp from its release on GitHub. This takes a few seconds.");
    expect(toolRunning(view(true), state({ phase: "installing" }))).toBe("Installing Zapp with Homebrew. This takes a minute or two.");
    expect(toolRunning(view(false, true), state({ phase: "stopping" }))).toBe("Stopping the install.");
  });

  test("a failed download says keyloom couldn't get it, with Try again unless it fails the same way every time", () => {
    const mismatch = toolFailed(view(false, true), state({ status: "failed", errorCode: "checksum_mismatch", error: "The file keyloom downloaded isn't Zapp 1.0.2 as released." }));
    expect(mismatch).toEqual({ text: "keyloom couldn't get Zapp. The file keyloom downloaded isn't Zapp 1.0.2 as released.", retry: true });
    expect(toolFailed(view(false, true), state({ status: "failed", errorCode: "no_asset", error: "No release file." })).retry).toBe(false);
    expect(toolFailed(view(true), state({ status: "failed", errorCode: "brew_failed", error: "Homebrew stopped with exit code 1." })))
      .toEqual({ text: "Zapp didn't install. Homebrew stopped with exit code 1.", retry: true });
  });
});
