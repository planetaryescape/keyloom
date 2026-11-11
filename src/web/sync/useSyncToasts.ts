import { useEffect, useRef } from "react";
import type { BoardSync } from "../../api/http.ts";
import type { ToastInput } from "../shell/Toasts.tsx";
import type { ConfirmProblem } from "../configs/ConfigDialogs.tsx";
import type { SyncApi } from "./useSync.ts";
import { type RefusalAction, knownRefusal, refusalNotice, syncNotice } from "./words.ts";

/** What a refusal's button does on this page. An action the page can't take leaves the toast without a button. */
export type RefusalHandlers = Partial<Record<RefusalAction, () => void>>;

/** A notice's button, when this page has a handler for it. Read at press time, so the button acts on the page as it is then. */
const buttonFor = (action: { id: RefusalAction; label: string } | undefined, handlers: () => RefusalHandlers): { label: string; run: () => void } | undefined =>
  action !== undefined && handlers()[action.id] !== undefined ? { label: action.label, run: () => handlers()[action.id]?.() } : undefined;

/**
 * A refused request (its server code) as words and the button that fixes it, for a dialog that shows it in place of a toast (R3-01).
 * Null for a failure that isn't a refusal, which the caller says in its own words.
 */
export function refusalProblem(error: { code?: string | undefined }, handlers: RefusalHandlers): ConfirmProblem | null {
  const notice = knownRefusal(error.code);
  if (notice === null) return null;
  const action = buttonFor(notice.action, () => handlers);
  return { message: notice.message, ...(notice.detail === undefined ? {} : { detail: notice.detail }), ...(action === undefined ? {} : { action }) };
}

// Says when a change reaches a keyboard, and when it doesn't. The first state after the page opens says nothing: it isn't news.
export function useSyncToasts(sync: SyncApi, show: (toast: ToastInput) => void, handlers: RefusalHandlers = {}): void {
  const latest = useRef<RefusalHandlers>({});
  latest.current = handlers;
  const current = () => latest.current;
  const before = useRef<ReadonlyMap<string, BoardSync> | null>(null);
  useEffect(() => {
    if (!sync.live) return;
    const now = new Map(sync.boards.map((b) => [b.boardId, b]));
    if (before.current !== null) {
      for (const board of sync.boards) {
        const notice = syncNotice(before.current.get(board.boardId), board);
        if (notice === null) continue;
        const action = buttonFor(notice.action, current);
        show({ kind: notice.kind, message: notice.message, ...(notice.detail === undefined ? {} : { detail: notice.detail }), ...(action === undefined ? {} : { action }) });
      }
    }
    before.current = now;
  }, [sync.boards, sync.live, show]);

  useEffect(() => {
    if (sync.error === null) return;
    const notice = refusalNotice(sync.error.code, sync.error.message);
    const action = buttonFor(notice.action, current);
    show({ kind: "error", message: notice.message, ...(notice.detail === undefined ? {} : { detail: notice.detail }), ...(action === undefined ? {} : { action }) });
  }, [sync.error, show]);
}
