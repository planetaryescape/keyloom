export type SetupOwnership = "no_child" | "terminated" | "unconfirmed";

/** Setup errors retain the original Error while recording what the parent observed about child ownership. */
export class HelperSetupFailure extends Error {
  override name = "HelperSetupFailure";
  constructor(
    readonly original: Error,
    readonly ownership: SetupOwnership,
    readonly cleanupFailure?: Error,
  ) {
    super("keyboard helper setup failed", { cause: original });
  }
}

export class HelperCleanupUnconfirmedError extends Error {
  override name = "HelperCleanupUnconfirmedError";
  constructor() {
    super("keyboard helper termination could not be confirmed; restart keyloom before using the keyboard connection again");
  }
}
