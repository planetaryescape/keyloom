// What the typing lab offers beside a problem, from the server's code (R1-19). A keyloom build that can't stream yet is fixed by putting
// keyloom's current build on it: Sync now when keyloom syncs this board, Build and flash otherwise or when the sync fails. Firmware keyloom
// didn't build is Build and flash's alone, because a sync never replaces it. macOS's refusal opens Input Monitoring (R3-09).
export type LabFix = { id: "sync_now" | "open_release" | "reload" | "open_input_monitoring" | "retry"; label: string };

export function labFixes(code: string | null, loadFailed: boolean): LabFix[] {
  if (loadFailed) return [{ id: "reload", label: "Try again" }];
  if (code === "needs_sync") return [{ id: "sync_now", label: "Sync now" }, { id: "open_release", label: "Build and flash…" }];
  if (code === "foreign_firmware") return [{ id: "open_release", label: "Build and flash…" }];
  if (code === "permission_input_monitoring") return [{ id: "open_input_monitoring", label: "Open Input Monitoring settings" }, { id: "retry", label: "Try again" }];
  if (code === "busy") return [{ id: "retry", label: "Try again" }];
  return [];
}

/** The problem line. Codes with a button get the page's own words; the server's name System Settings paths and CLI steps. */
export function labProblemText(code: string | null, message: string): string {
  if (code === "permission_input_monitoring") return "macOS didn't let keyloom read your keyboard. Allow keyloom in Input Monitoring, then try again.";
  if (code === "foreign_firmware") return "Your keyboard runs firmware keyloom didn't build, so it can't stream its keys. Build and flash puts keyloom's build on it.";
  return message;
}

/**
 * Why Apply on a lab fix failed (R3-02), and the way on. A layout changed since the recording no longer takes the fix as it was tried, so
 * the way on is to type again on the layout as it is now; any other failure may pass on a second try.
 */
export function labApplyFailure(error: { code?: string | undefined; message: string }): { text: string; next: "again" | "retry" } {
  if (error.code === "stale_base") return { text: "The layout changed since this recording, so this fix no longer applies as it was tried. Type again to try fixes on the layout as it is now.", next: "again" };
  if (error.code === "validation_failed") return { text: "The layout's checks refused this fix as the layout is now. Type again to try fixes on the layout as it is now.", next: "again" };
  return { text: `keyloom couldn't apply this fix. ${error.message}`, next: "retry" };
}
