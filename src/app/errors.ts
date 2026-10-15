// Errors the CLI maps to exit codes (10#exit-codes). Anything else is a bug (exit 1).

/** Bad arguments or flags: exit 2. */
export class UsageError extends Error {
  override name = "UsageError";
}

/** A layout, revision or board that doesn't exist: exit 3. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}

/** `boards check` found errors: exit 4. */
export class ValidationFailedError extends Error {
  override name = "ValidationFailedError";
  constructor(message: string, readonly details: unknown) {
    super(message);
  }
}
