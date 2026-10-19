// Errors from building and flashing. The CLI maps them to exit codes 7 and 8 (10#exit-codes).

/** A build ran and failed; `message` says why and is fit to show. */
export class BuildFailedError extends Error {
  override name = "BuildFailedError";
  constructor(message: string, readonly buildId: string, readonly logPath: string) {
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

/** The emulator couldn't build or run the keymap, or the key script isn't one it can run. Exits 7 like a build. */
export class EmulateFailedError extends Error {
  override name = "EmulateFailedError";
  constructor(message: string, readonly logPath: string | null = null) {
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
