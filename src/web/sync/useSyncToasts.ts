import { useEffect, useRef } from "react";
import type { BoardSync } from "../../api/http.ts";
import type { ToastInput } from "../shell/Toasts.tsx";
import type { SyncApi } from "./useSync.ts";
import { type RefusalAction, refusalNotice, syncNotice } from "./words.ts";

/** What a refusal's button does on this page. An action the page can't take leaves the toast without a button. */
export type RefusalHandlers = Partial<Record<RefusalAction, () => void>>;

// Says when a change reaches a keyboard, and when it doesn't. The first state after the page opens says nothing: it isn't news.
export function useSyncToasts(sync: SyncApi, show: (toast: ToastInput) => void, handlers: RefusalHandlers = {}): void {
  const before = useRef<ReadonlyMap<string, BoardSync> | null>(null);
  useEffect(() => {
    if (!sync.live) return;
    const now = new Map(sync.boards.map((b) => [b.boardId, b]));
    if (before.current !== null) {
      for (const board of sync.boards) {
        const notice = syncNotice(before.current.get(board.boardId), board);
        if (notice !== null) show({ kind: notice.kind, message: notice.message, ...(notice.detail === undefined ? {} : { detail: notice.detail }) });
      }
    }
    before.current = now;
  }, [sync.boards, sync.live, show]);

  // Read at the moment the button is pressed, so the toast acts on the page as it is then.
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (sync.error === null) return;
    const notice = refusalNotice(sync.error.code, sync.error.message);
    const id = notice.action?.id;
    const run = id === undefined ? undefined : latest.current[id];
    show({
      kind: "error", message: notice.message, ...(notice.detail === undefined ? {} : { detail: notice.detail }),
      ...(notice.action !== undefined && id !== undefined && run !== undefined ? { action: { label: notice.action.label, run: () => latest.current[id]?.() } } : {}),
    });
  }, [sync.error, show]);
}
