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

/** The keyboard could not be restarted into its bootloader. It is a flash failure to callers (exit 8): the flash cannot start. */
export class RebootFailedError extends FlashFailedError {
  override name = "RebootFailedError";
  constructor(message: string) {
    super(message, "", "");
  }
}
