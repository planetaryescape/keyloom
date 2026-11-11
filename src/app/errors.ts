// Errors the CLI maps to exit codes (10#exit-codes). Anything else is a bug (exit 1).

/** Bad arguments or flags: exit 2. */
export class UsageError extends Error {
  override name = "UsageError";
}

/**
 * Two keyloom binaries that cannot work together: a desktop app and a `serve` that speak different protocols, or a running server this
 * one must not attach to or replace (D-454). Exit 10; `kind` says which.
 */
export class IncompatibleError extends Error {
  override name = "IncompatibleError";
  constructor(readonly kind: "client_protocol_mismatch" | "server_incompatible", message: string) {
    super(message);
  }
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

/** A capture could not begin for a reason the page can act on (R1-19): `needs_sync` offers Sync now and Build and flash. */
export class LabStartError extends UsageError {
  override name = "LabStartError";
  constructor(readonly code: "needs_sync" | "foreign_firmware" | "not_connected", message: string) {
    super(message);
  }
}

/**
 * A capture could not begin because the operating system or another client refused keyboard access. `permission_input_monitoring` is
 * macOS refusing raw HID until keyloom is allowed in Input Monitoring (D-492), which the page opens with a button (R3-09).
 */
export class LabCaptureError extends Error {
  override name = "LabCaptureError";
  constructor(readonly code: "busy" | "permission_denied" | "permission_input_monitoring" | "connection_lost" | "restart_required", remedy?: string) {
    super(code === "busy"
      ? (remedy ?? "Another application or keyloom instance is using this keyboard. Stop the other client, then try again.")
      : code === "permission_input_monitoring"
        ? (remedy ?? "macOS didn't let keyloom read the keyboard. Allow keyloom in System Settings > Privacy & Security > Input Monitoring, then try again.")
      : code === "permission_denied"
        ? (remedy ?? "The operating system denied keyboard access. Check the device-access permissions required by your platform for keyloom, then try again.")
      // The owner starts a new keyboard connection on the next try (R4-03); only one whose old connection may still be open needs a restart.
      : code === "connection_lost"
        ? "The keyboard connection stopped responding. Try again, and keyloom opens a new one."
        : "keyloom couldn't confirm that its old keyboard connection closed, so it won't open another. Quit keyloom and open it again, then try again.");
  }
}

/** Why a pasted key was not saved, or a Codex sign-in couldn't start (D-496). The message never holds the key. */
export class CredentialError extends Error {
  override name = "CredentialError";
  constructor(readonly code: "key_malformed" | "key_rejected" | "key_from_environment" | "key_store_unavailable" | "key_store_failed" | "codex_missing", message: string) {
    super(message);
  }
}
