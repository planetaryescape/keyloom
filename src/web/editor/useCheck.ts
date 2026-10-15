import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeOp, Slot } from "../../layout/change.ts";
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

interface OpsCheckInput {
  token: string;
  layoutRef: string;
  revisionId: string;
  /** Null while there is nothing to check: an incomplete or unchanged draft. */
  ops: ChangeOp[] | null;
}

// Asks the server's validator about the draft as it changes, so errors show before Apply.
// A later draft cancels the earlier request, so a slow answer can never describe an old draft.
export function useOpsCheck({ token, layoutRef, revisionId, ops }: OpsCheckInput) {
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const key = ops === null ? null : JSON.stringify(ops);

  useEffect(() => {
    if (key === null) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "checking" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkChange(token, layoutRef, { baseRevisionId: revisionId, ops: JSON.parse(key) as ChangeOp[] }, controller.signal)
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
  }, [token, layoutRef, revisionId, key, attempt]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  /** Shows a validation the server returned from apply, which can differ from the last check. */
  const show = useCallback((result: ValidationResult) => setState({ status: "done", result }), []);
  return { state, recheck, show };
}

interface CheckInput {
  token: string;
  layoutRef: string;
  revisionId: string;
  slot: Slot;
  /** Null while the draft is incomplete or unchanged: nothing to check. */
  binding: Binding | null;
}

/** The editor's check: one key set to the draft binding. */
export function useCheck({ token, layoutRef, revisionId, slot, binding }: CheckInput) {
  const { layerId, position } = slot;
  const bindingKey = binding === null ? null : JSON.stringify(binding);
  const ops = useMemo<ChangeOp[] | null>(
    () => (bindingKey === null ? null : [{ op: "setBinding", at: { layerId, position }, binding: JSON.parse(bindingKey) as Binding }]),
    [bindingKey, layerId, position],
  );
  return useOpsCheck({ token, layoutRef, revisionId, ops });
}
