import { useCallback, useEffect, useState } from "react";
import type { RevisionEntry } from "../../api/http.ts";
import { fetchRevisions } from "./api-history.ts";

export type Revisions = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: RevisionEntry[] };

// Loads when the panel is open and again whenever the head moves, since every apply and undo adds a revision.
export function useRevisions(token: string, layoutRef: string, headId: string, active: boolean): { revisions: Revisions; reload: () => void } {
  const [revisions, setRevisions] = useState<Revisions>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    // Keep the old list on screen while a newer one loads, so the panel doesn't flash after each undo.
    setRevisions((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    fetchRevisions(token, layoutRef, controller.signal).then(
      (items) => setRevisions({ status: "ready", items }),
      (error: unknown) => {
        if (!controller.signal.aborted) setRevisions({ status: "error", message: error instanceof Error ? error.message : "Couldn't load the history." });
      },
    );
    return () => controller.abort();
  }, [token, layoutRef, headId, active, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { revisions, reload };
}
