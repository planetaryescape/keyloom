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

/**
 * The head moved since the change set's base, and the ops touch something that changed (02), or
 * an undo named a revision that is no longer the head: exit 5. `conflicts` names what differs.
 */
export class StaleBaseError extends Error {
  override name = "StaleBaseError";
  constructor(message: string, readonly conflicts: string[] = []) {
    super(message);
  }
}

/** The model API refused, rejected or could not be reached, or no key is set: exit 9. `kind` says which, for the chat panel. */
export class ModelError extends Error {
  override name = "ModelError";
  constructor(readonly kind: string, message: string) {
    super(message);
  }
}

/** The conversation is already answering a message in this process: the second message would interleave with it. */
export class BusyError extends Error {
  override name = "BusyError";
}

export function linuxDevicePermissionRemedy(transport: "hid" | "serial", platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== "linux") return undefined;
  return transport === "hid"
    ? "Keyboard hidraw access was denied. Add a udev rule scoped to this keyboard's VID/PID that grants your user read/write access, reload the rules and reconnect, then try again."
    : "Keyboard ttyACM access was denied. Join the group owning the port (usually dialout or uucp), log out and back in, then try again.";
}

/** A capture could not begin because the operating system or another client refused keyboard access. */
export class LabCaptureError extends Error {
  override name = "LabCaptureError";
  constructor(readonly code: "busy" | "permission_denied" | "restart_required", remedy?: string) {
    super(code === "busy"
      ? (remedy ?? "Another application or keyloom instance is using this keyboard. Stop the other client, then try again.")
      : code === "permission_denied"
        ? (remedy ?? "The operating system denied keyboard access. Check the device-access permissions required by your platform for keyloom, then try again.")
        : "The keyboard connection has stopped responding. Restart keyloom (or its serve process), then try again.");
  }
}
