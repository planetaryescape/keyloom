import { useCallback, useRef } from "react";
import type { ChangeOp } from "../../layout/change.ts";
import { ApiError } from "../api.ts";
import { applyChange } from "../api-write.ts";
import { lostFunctionsIn } from "./lost-functions.ts";

export type ChangeOutcome =
  | { ok: true; warnings: string[] }
  // `lost` holds the functions the change would drop when that is the only thing wrong with it: the person can choose to drop them (D-092).
  | { ok: false; message: string; problems: string[]; lost: string[]; stale: boolean };

interface Input {
  token: string;
  layoutRef: string;
  revisionId: string;
  /** Resolves once the new layout is on screen. */
  onChanged: () => Promise<void>;
  /** The layout moved on under the change: nothing was written. */
  onStale: () => void;
}

// The validator marks a problem the layout already had; only news about this change is worth a toast.
const ALREADY_SO = "(already so before this change)";

const refused = (message: string, extra: Partial<Omit<Extract<ChangeOutcome, { ok: false }>, "ok" | "message">> = {}): ChangeOutcome => ({
  ok: false, message, problems: [], lost: [], stale: false, ...extra,
});

// One change set from the board or the tabs (swap, paste, combo, layer): the same apply route the key
// panel uses, so the server's validator is the only judge and the revision history gets one entry.
// A second call while one is in flight is refused, not queued: it would be built from a layout that is about to change.
export function useChange({ token, layoutRef, revisionId, onChanged, onStale }: Input) {
  const busy = useRef(false);
  return useCallback(
    async (ops: ChangeOp[], summary: string): Promise<ChangeOutcome> => {
      if (busy.current) return refused("Another change is still being saved.");
      busy.current = true;
      try {
        const applied = await applyChange(token, layoutRef, { baseRevisionId: revisionId, ops, summary: summary.slice(0, 200) });
        await onChanged();
        return { ok: true, warnings: applied.validation.warnings.filter((issue) => !issue.message.includes(ALREADY_SO)).map((issue) => issue.plain ?? issue.message) };
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.code?.startsWith("stale")) {
          onStale();
          return refused("The layout changed while you were editing.", { stale: true });
        }
        if (error instanceof ApiError && error.validation !== undefined) {
          const problems = error.validation.errors.map((issue) => issue.plain ?? issue.message);
          const lost = lostFunctionsIn(error.validation);
          const onlyLost = lost.length > 0 && lost.length === error.validation.errors.length;
          return refused("keyloom refused this change. Nothing was saved.", { problems, lost: onlyLost ? lost.map((entry) => entry.function) : [] });
        }
        return refused(error instanceof Error ? error.message : "The change could not be applied.");
      } finally {
        busy.current = false;
      }
    },
    [token, layoutRef, revisionId, onChanged, onStale],
  );
}
