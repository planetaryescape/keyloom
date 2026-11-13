import { useEffect, useRef } from "react";
import type { BoardSync } from "../../api/http.ts";
import type { ToastInput } from "../shell/Toasts.tsx";
import type { ConfirmProblem } from "../configs/ConfigDialogs.tsx";
import type { PageFailure } from "../shell/unexpected.ts";
import type { SettingsPaneName } from "../../api/system-remapper.ts";
import type { SyncApi } from "./useSync.ts";
import { type RefusalAction, knownRefusal, noticeOnPage, refusalNotice, settingsOpenFailure, syncNotice } from "./words.ts";

/**
 * What a refusal's button does on this page. An action the page can't take leaves the toast without a button. `open_release` takes the
 * sync's failed build, which the dialog opens on (R8-01).
 */
export type RefusalHandlers = Partial<Record<Exclude<RefusalAction, "restart_keyloom">, (buildId?: string) => void>> & {
  /** Opens the restart dialog for a failure no screen planned for (R9-05). Without it, that toast has no button. */
  restart_keyloom?: (failure: PageFailure) => void;
};

/** A notice's button, when this page has a handler for it. Read at press time, so the button acts on the page as it is then. */
const buttonFor = (action: { id: RefusalAction; label: string; buildId?: string | undefined } | undefined, handlers: () => RefusalHandlers): { label: string; run: () => void } | undefined => {
  if (action === undefined || action.id === "restart_keyloom" || handlers()[action.id] === undefined) return undefined;
  const id = action.id;
  return { label: action.label, run: () => handlers()[id]?.(action.buildId) };
};

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

/** The board and config on screen, and how to open another board's or config's page, which a toast about that one offers. */
export type SyncToastPage = { boardId: string; layoutId: string; openBoard: (boardId: string) => void; openConfig: (layoutId: string) => void };

// Says when a change reaches a keyboard, and when it doesn't. The first state after the page opens says nothing: it isn't news.
export function useSyncToasts(sync: SyncApi, show: (toast: ToastInput) => void, handlers: RefusalHandlers = {}, page?: SyncToastPage): void {
  const latest = useRef<RefusalHandlers>({});
  latest.current = handlers;
  const current = () => latest.current;
  const pageNow = useRef<SyncToastPage | undefined>(page);
  pageNow.current = page;
  const before = useRef<ReadonlyMap<string, BoardSync> | null>(null);
  // A sync's toast opens the System Settings pane its flash was refused for; when that fails, the toast says where the setting is (R9-01).
  const openPane = (pane: SettingsPaneName) => {
    const failed = (reason: string) => show({ kind: "error", message: "keyloom couldn't open System Settings", detail: settingsOpenFailure(pane, reason) });
    sync.remapperSetup.openSettings(pane).then((r) => { if (!r.ok) failed(r.reason); }, (e: unknown) => failed(e instanceof Error ? e.message : "System Settings didn't open."));
  };
  const openPaneNow = useRef(openPane);
  openPaneNow.current = openPane;
  useEffect(() => {
    if (!sync.live) return;
    const now = new Map(sync.boards.map((b) => [b.boardId, b]));
    if (before.current !== null) {
      for (const board of sync.boards) {
        const raw = syncNotice(before.current.get(board.boardId), board);
        if (raw === null) continue;
        const onScreen = pageNow.current;
        const notice = noticeOnPage(raw, board, onScreen);
        const to = notice.action;
        const action = to === undefined ? undefined
          : to.id === "open_config" ? (onScreen === undefined ? undefined : { label: to.label, run: () => onScreen.openConfig(to.layoutId) })
          : to.id === "open_board" ? (onScreen === undefined ? undefined : { label: to.label, run: () => onScreen.openBoard(board.boardId) })
          : to.id === "open_settings" ? { label: to.label, run: () => openPaneNow.current(to.pane) }
          : buttonFor({ id: to.id, label: to.label, buildId: to.buildId }, current);
        show({ kind: notice.kind, message: notice.message, ...(notice.detail === undefined ? {} : { detail: notice.detail }), ...(action === undefined ? {} : { action }) });
      }
    }
    before.current = now;
  }, [sync.boards, sync.live, show]);

  useEffect(() => {
    if (sync.error === null) return;
    const error = sync.error;
    const notice = refusalNotice(error.code, error.message, error.generic);
    const restart = current().restart_keyloom;
    const action = notice.action?.id === "restart_keyloom"
      ? (restart === undefined ? undefined : { label: notice.action.label, run: () => restart({ message: error.message, code: error.code, ...(error.generic === true ? { generic: true } : {}) }) })
      : buttonFor(notice.action, current);
    show({ kind: "error", message: notice.message, ...(notice.detail === undefined ? {} : { detail: notice.detail }), ...(action === undefined ? {} : { action }) });
  }, [sync.error, show]);
}
