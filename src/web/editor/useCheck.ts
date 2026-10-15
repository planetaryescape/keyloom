import { useCallback, useEffect, useState } from "react";
import type { Slot } from "../../layout/change.ts";
import type { Binding } from "../../layout/schema.ts";
import type { ValidationResult } from "../../validation/result.ts";
import { ApiError } from "../api.ts";
import { checkChange } from "../api-write.ts";

export type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; result: ValidationResult }
  | { status: "error"; message: string; stale: boolean };

const DEBOUNCE_MS = 250;

interface CheckInput {
  token: string;
  layoutRef: string;
  revisionId: string;
  slot: Slot;
  /** Null while the draft is incomplete or unchanged: nothing to check. */
  binding: Binding | null;
}

// Asks the server's validator about the draft as it changes, so errors show before Apply.
// A later draft cancels the earlier request, so a slow answer can never describe an old draft.
export function useCheck({ token, layoutRef, revisionId, slot, binding }: CheckInput) {
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const key = binding === null ? null : JSON.stringify(binding);
  const { layerId, position } = slot;

  useEffect(() => {
    if (key === null) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "checking" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkChange(
        token,
        layoutRef,
        {
          baseRevisionId: revisionId,
          ops: [{ op: "setBinding", at: { layerId, position }, binding: JSON.parse(key) as Binding }],
        },
        controller.signal,
      )
        .then((result) => setState({ status: "done", result }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const stale = error instanceof ApiError && error.status === 409 && error.code?.startsWith("stale") === true;
          setState({ status: "error", message: error instanceof Error ? error.message : "The check failed.", stale });
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [token, layoutRef, revisionId, layerId, position, key, attempt]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  /** Shows a validation the server returned from apply, which can differ from the last check. */
  const show = useCallback((result: ValidationResult) => setState({ status: "done", result }), []);
  return { state, recheck, show };
}
