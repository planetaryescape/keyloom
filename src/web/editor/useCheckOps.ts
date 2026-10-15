import { useCallback, useEffect, useState } from "react";
import type { ChangeOp } from "../../layout/change.ts";
import { ApiError } from "../api.ts";
import { checkChange } from "../api-write.ts";
import type { CheckState } from "./useCheck.ts";

// Asks the server's validator about a list of ops (a repeat on a selection), once per list.
// useCheck does the same for one key's draft as it is typed; a repeat has nothing to debounce.
export function useCheckOps(token: string, layoutRef: string, revisionId: string, ops: readonly ChangeOp[]) {
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(ops);

  useEffect(() => {
    const parsed = JSON.parse(key) as ChangeOp[];
    if (parsed.length === 0) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "checking" });
    const controller = new AbortController();
    checkChange(token, layoutRef, { baseRevisionId: revisionId, ops: parsed }, controller.signal)
      .then((result) => setState({ status: "done", result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const stale = error instanceof ApiError && error.status === 409 && error.code?.startsWith("stale") === true;
        setState({ status: "error", message: error instanceof Error ? error.message : "The check failed.", stale });
      });
    return () => controller.abort();
  }, [token, layoutRef, revisionId, key, attempt]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, recheck };
}
