import { useEffect, useRef } from "react";
import type { BoardSync } from "../../api/http.ts";
import type { ToastInput } from "../shell/Toasts.tsx";
import type { ConfirmProblem } from "../configs/ConfigDialogs.tsx";
import type { SyncApi } from "./useSync.ts";
import { type RefusalAction, knownRefusal, noticeOnPage, refusalNotice, syncNotice } from "./words.ts";

/**
 * What a refusal's button does on this page. An action the page can't take leaves the toast without a button. `open_release` takes the
 * sync's failed build, which the dialog opens on (R8-01).
 */
export type RefusalHandlers = Partial<Record<RefusalAction, (buildId?: string) => void>>;

/** A notice's button, when this page has a handler for it. Read at press time, so the button acts on the page as it is then. */
const buttonFor = (action: { id: RefusalAction; label: string; buildId?: string | undefined } | undefined, handlers: () => RefusalHandlers): { label: string; run: () => void } | undefined =>
  action !== undefined && handlers()[action.id] !== undefined ? { label: action.label, run: () => handlers()[action.id]?.(action.buildId) } : undefined;

/**
 * A refused request (its server code) as words and the button that fixes it, for a dialog that shows it in place of a toast (R3-01).
 * Null for a failure that isn't a refusal, which the caller says in its own words.
 */
export function refusalProblem(error: { code?: string | undefined }, handlers: RefusalHandlers, elsewhere?: (action: RefusalAction) => Elsewhere | undefined): ConfirmProblem | null {
  const notice = knownRefusal(error.code);
  if (notice === null) return null;
  const action = buttonFor(notice.action, () => handlers);
  // A fix this page doesn't have is on another config's page, so the button goes there instead of leaving the dialog without one.
  const there = action === undefined && notice.action !== undefined ? elsewhere?.(notice.action.id) : undefined;
  if (there !== undefined && notice.action !== undefined) {
    return {
      message: notice.message,
      detail: `${notice.detail ?? ""} ${there.name}'s page has ${notice.action.label.replace(/…$/, "")}.`.trim(),
      action: { label: `Open ${there.name}`, run: there.open },
    };
  }
  return { message: notice.message, ...(notice.detail === undefined ? {} : { detail: notice.detail }), ...(action === undefined ? {} : { action }) };
}

/** The page that has a refusal's fix when this one doesn't: a config, by name. */
export type Elsewhere = { name: string; open: () => void };

/** The board on screen, and how to open another board's page, which a toast about that board offers. */
export type SyncToastPage = { boardId: string; openBoard: (boardId: string) => void };

// Says when a change reaches a keyboard, and when it doesn't. The first state after the page opens says nothing: it isn't news.
export function useSyncToasts(sync: SyncApi, show: (toast: ToastInput) => void, handlers: RefusalHandlers = {}, page?: SyncToastPage): void {
  const latest = useRef<RefusalHandlers>({});
  latest.current = handlers;
  const current = () => latest.current;
  const pageNow = useRef<SyncToastPage | undefined>(page);
  pageNow.current = page;
  const before = useRef<ReadonlyMap<string, BoardSync> | null>(null);
  useEffect(() => {
    if (!sync.live) return;
    const now = new Map(sync.boards.map((b) => [b.boardId, b]));
    if (before.current !== null) {
      for (const board of sync.boards) {
        const raw = syncNotice(before.current.get(board.boardId), board);
        if (raw === null) continue;
        const notice = noticeOnPage(raw, board, pageNow.current?.boardId);
        const openBoard = pageNow.current?.openBoard;
        const action = notice.action?.id === "open_board"
          ? (openBoard === undefined ? undefined : { label: notice.action.label, run: () => openBoard(board.boardId) })
          : buttonFor(notice.action === undefined ? undefined : { id: notice.action.id, label: notice.action.label, buildId: notice.action.buildId }, current);
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
