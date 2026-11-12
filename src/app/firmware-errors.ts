// Errors from building and flashing. The CLI maps them to exit codes 7 and 8 (10#exit-codes).
import { UsageError } from "./errors.ts";
import { TOOL_PAGES, brewFormulae, type InstallableTool } from "./tool-install.ts";

/** A build ran and failed; `message` says why and is fit to show. */
export class BuildFailedError extends Error {
  override name = "BuildFailedError";
  /** `code` is the build's error code, such as "docker_unavailable", so a caller (the sync pill) can offer the fix without reading `message`. */
  constructor(message: string, readonly buildId: string, readonly logPath: string, readonly code: string | null = null) {
    super(message);
  }
}

/** A flash ran and failed, or timed out waiting for the bootloader. */
export class FlashFailedError extends Error {
  override name = "FlashFailedError";
  constructor(message: string, readonly flashId: string, readonly logPath: string) {
    super(message);
  }
}

/**
 * The emulator couldn't build or run the keymap, or the key script isn't one it can run. Exits 7 like a build. `code` is
 * "docker_unavailable" when Docker stopped it, so the typing lab shows its Install or Start button without reading `message` (R6-02).
 */
export class EmulateFailedError extends Error {
  override name = "EmulateFailedError";
  constructor(message: string, readonly logPath: string | null = null, readonly code: "docker_unavailable" | null = null) {
    super(message);
  }
}

/** The keyboard could not be restarted into its bootloader. It is a flash failure to callers (exit 8): the flash cannot start. */
export class RebootFailedError extends FlashFailedError {
  override name = "RebootFailedError";
  constructor(message: string) {
    super(message, "", "");
  }
}

/** Toolchain is unavailable (Docker isn't running, or a pinned checkout is missing). Exits 6 (10#exit-codes). */
export class ToolchainUnavailableError extends Error {
  override name = "ToolchainUnavailableError";
}

/** Homebrew on a Mac; elsewhere the tool's own page, since Homebrew isn't how Linux installs these (R3-25). Zapp also needs ZSA's udev rules there. */
function installSentence(tool: InstallableTool, platform: NodeJS.Platform): string {
  if (platform === "darwin" || tool === "docker") return `${tool} isn't installed. Install it with \`brew install ${brewFormulae(tool).join(" ")}\`, then flash again.`;
  const rules = tool === "zapp" ? ", with ZSA's udev rules so it can reach the keyboard without root" : "";
  return `${tool} isn't installed. Install it from ${TOOL_PAGES[tool]}${rules}, then flash again.`;
}

/** The tool a flash runs isn't on this computer, found before the flash starts (D-489). The UI offers to install it. */
export class FlashToolMissingError extends UsageError {
  override name = "FlashToolMissingError";
  constructor(readonly tool: InstallableTool, platform: NodeJS.Platform = process.platform) {
    super(installSentence(tool, platform));
  }
}

/** The board has more than one revision and no connected keyboard says which this is; the page asks, the CLI wants --board-rev. */
export class BoardRevisionNeededError extends UsageError {
  override name = "BoardRevisionNeededError";
}

/** A flash can be cancelled only while it waits for the bootloader and before anything was written (D-501): `why` says which it is past. */
export class FlashNotCancellableError extends UsageError {
  override name = "FlashNotCancellableError";
  constructor(readonly why: "writing" | "finished", message: string) {
    super(message);
  }
}

/** A build that has already finished, or runs in another keyloom process, can't be stopped from here (R3-10). */
export class BuildNotCancellableError extends UsageError {
  override name = "BuildNotCancellableError";
}
