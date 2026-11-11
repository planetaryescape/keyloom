// What the typing lab offers beside a problem, from the server's code (R1-19). A keyboard whose firmware can't stream yet is fixed by
// putting keyloom's current build on it: Sync now when keyloom syncs this board, Build and flash otherwise or when the sync fails.
export type LabFix = { id: "sync_now" | "open_release" | "reload"; label: string };

export function labFixes(code: string | null, loadFailed: boolean): LabFix[] {
  if (loadFailed) return [{ id: "reload", label: "Try again" }];
  if (code === "needs_sync") return [{ id: "sync_now", label: "Sync now" }, { id: "open_release", label: "Build and flash…" }];
  return [];
}
