import { useCallback, useEffect, useState } from "react";
import type { VersionHistoryResponse } from "../../api/configs.ts";
import { type PageFailure, pageFailure } from "../shell/unexpected.ts";
import { fetchVersions } from "../configs/api-configs.ts";

export type Versions = { status: "idle" } | { status: "loading" } | ({ status: "error" } & PageFailure) | { status: "ready"; history: VersionHistoryResponse };

/** History's own `not_found`: the config was deleted in another window or by the CLI, so reading it again can't pass (D-540). */
export const CONFIG_GONE = "keyloom no longer has this config. It may have been deleted in another window. Restarting keyloom opens the page on the configs it has.";

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
        if (controller.signal.aborted) return;
        // The code picks the panel's buttons: a history keyloom can't find never gets a Try again (R7-01). The route's own not_found is a
        // config deleted elsewhere, which gets the panel's words in place of the server's "no layout" sentence (D-540).
        const failure = pageFailure(error, "Couldn't load the history.");
        setVersions({ status: "error", ...failure, ...(failure.code === "not_found" && failure.generic !== true ? { message: CONFIG_GONE } : {}) });
      },
    );
    return () => controller.abort();
  }, [token, layoutRef, key, active, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { versions, reload };
}
