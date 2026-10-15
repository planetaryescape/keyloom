import { useEffect, useRef } from "react";
import type { BoardSync } from "../../api/http.ts";
import type { ToastInput } from "../shell/Toasts.tsx";
import type { SyncApi } from "./useSync.ts";
import { syncNotice } from "./words.ts";

// Says when a change reaches a keyboard, and when it doesn't. The first state after the page opens says nothing: it isn't news.
export function useSyncToasts(sync: SyncApi, show: (toast: ToastInput) => void): void {
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

  useEffect(() => {
    if (sync.error !== null) show({ kind: "error", message: "keyloom couldn't do that", detail: sync.error });
  }, [sync.error, show]);
}
