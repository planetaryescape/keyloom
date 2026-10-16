import { useCallback, useEffect, useState } from "react";
import type { VersionHistoryResponse } from "../../api/configs.ts";
import { fetchVersions } from "../configs/api-configs.ts";

export type Versions = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; history: VersionHistoryResponse };

// History as versions (D-315): loads when the panel is open, and again whenever the head moves or a sync finishes (a verified sync
// records a version), so the milestones follow the keyboard.
export function useVersions(token: string, layoutRef: string, key: string, active: boolean): { versions: Versions; reload: () => void } {
  const [versions, setVersions] = useState<Versions>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    // Keep the old list on screen while a newer one loads, so the panel doesn't flash after each change.
    setVersions((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    fetchVersions(token, layoutRef, controller.signal).then(
      (history) => setVersions({ status: "ready", history }),
      (error: unknown) => {
        if (!controller.signal.aborted) setVersions({ status: "error", message: error instanceof Error ? error.message : "Couldn't load the history." });
      },
    );
    return () => controller.abort();
  }, [token, layoutRef, key, active, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { versions, reload };
}
