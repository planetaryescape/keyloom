import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { BoardChoice, FittingRevisionResponse, ImportResponse, LayoutDetail, LayoutSummary } from "../api/http.ts";
import { ApiError, TOKEN_REJECTED, fetchLayout, fetchLayouts } from "./api.ts";
import { applyDisplayRotation } from "./keyboard/geometry.ts";
import { Header } from "./shell/Header.tsx";
import { fetchBoards } from "./import/api-import.ts";
import { ImportScreen } from "./import/ImportScreen.tsx";
import { BoardSkeleton } from "./shell/BoardSkeleton.tsx";
import { rememberShape } from "./shell/shape.ts";
import { ErrorState } from "./shell/States.tsx";
import { RestartAdvice, ServerGoneBanner, useServerGone } from "./shell/ServerGone.tsx";
import { ReleaseHost, type ReleaseHandle } from "./release/ReleaseHost.tsx";
import type { ReleaseStatus } from "./release/status.ts";
import { useSync, type SyncApi } from "./sync/useSync.ts";
import { Viewer, type Arrival } from "./Viewer.tsx";
import { KeyboardCollection } from "./keyboards/KeyboardCollection.tsx";
import { KeyboardWelcome } from "./keyboards/KeyboardWelcome.tsx";
import { Pegboard } from "./home/Pegboard.tsx";
import { markOpened, undoChange } from "./api-write.ts";
import { fetchFittingRevision } from "./release/flash-api.ts";
import { headline } from "../layout/history-summary.ts";
import { archiveConfig } from "./configs/api-configs.ts";
import { type GoBackRefusal, goBackRefusal } from "./shell/mismatch-words.ts";
import type { FindingRepairDraft } from "../api/review.ts";

// `gone` is a layout that isn't there (404), which no Try again brings back (R1-08); `waiting` is a keyloom that stopped answering,
// which the page reads again by itself when it is back (D-494).
type Failure = { message: string; retryable: boolean; kind?: "gone" | "waiting" | "token" };
type View = { id: string; detail: LayoutDetail } | { id: string; error: Failure };

// Runs a state change that replaces the page as a crossfade where the browser has view transitions; elsewhere, and with reduced
// motion, it happens at once. flushSync makes React commit inside the transition's callback, so the new page is what it captures.
function crossfade(update: () => void, onComplete?: () => void) {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };
  // A collection change can switch the underlying layout. Do not cover an open dialog with the page's transition snapshot.
  if (doc.startViewTransition === undefined || document.querySelector("dialog[open]") !== null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    onComplete?.();
    return;
  }
  const transition = doc.startViewTransition(() => flushSync(update));
  if (onComplete && transition && typeof transition.finished?.then === "function") {
    transition.finished.finally(onComplete);
  }
}

export function App({ token }: { token: string }) {
  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null);
  const [listError, setListError] = useState<Failure | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Whether the pegboard wall is shown.
  const [onWall, setOnWall] = useState(true);
  const [flyingId, setFlyingId] = useState<string | null>(null);
  // What a board or config switch carries to the layout it opens (D-317), kept with that layout's ID so nothing else picks it up.
  const [carry, setCarry] = useState<(Arrival & { id: string }) | null>(null);
  const [view, setView] = useState<View | null>(null);
  // Only this new request is carried across the pegboard's Viewer unmount, scoped by config.
  const [repairDrafts, setRepairDrafts] = useState<Record<string, FindingRepairDraft>>({});
  const requestSequence = useRef(0);
  // The import screen from the layout menu; with no layouts it is the page itself.
  const [importing, setImporting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [manageRemoved, setManageRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  // Bumping this refetches the list; it backs the "Check again" and "Try again" buttons.
  const [attempt, setAttempt] = useState(0);
  // Where each keyboard stands against its layout's head; the server's engine does the work and this follows it (17).
  const sync = useSync(token);
  // Said once for the whole page while keyloom is gone; when it is back, everything on screen is read again (D-494).
  const gone = useServerGone(sync.live, () => setAttempt((count) => count + 1));
  const banner = gone ? <ServerGoneBanner tokenRejected={sync.tokenRejected} /> : null;
  // Every board keyloom knows, for the silhouettes in the board switcher. Without it the switcher shows a plain keyboard icon.
  const [boardChoices, setBoardChoices] = useState<BoardChoice[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchBoards(token, controller.signal).then(setBoardChoices, () => {});
    return () => controller.abort();
    // Again on a reload: a keyboard just added is a board the switch should draw (D-336).
  }, [token, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    setListError(null);
    fetchLayouts(token, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        const live = list.filter((layout) => layout.archivedAt == null);
        setLayouts(live);
        setSelectedId((previous) =>
          live.some((layout) => layout.id === previous) ? previous : (live[0]?.id ?? null),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(describe(error));
      });
    return () => controller.abort();
  }, [token, attempt, sync.lastLayoutUpdated]);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    fetchLayout(token, selectedId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted && sequence === requestSequence.current) crossfade(() => setView({ id: selectedId, detail }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && sequence === requestSequence.current) setView({ id: selectedId, error: describe(error) });
      });
    return () => controller.abort();
  }, [token, selectedId, attempt, sync.lastLayoutUpdated]);

  // Refetches the open layout in place after an edit or undo, without the loading state a retry has.
  const refresh = useCallback(async () => {
    if (selectedId === null) return;
    const sequence = ++requestSequence.current;
    const detail = await fetchLayout(token, selectedId, new AbortController().signal);
    if (sequence === requestSequence.current) setView({ id: selectedId, detail });
  }, [token, selectedId]);

  const retry = () => {
    setView(null);
    setAttempt((count) => count + 1);
  };

  const reload = (selectId?: string) => {
    if (selectId !== undefined) { setSelectedId(selectId); setOnWall(false); setAdding(false); setImporting(false); }
    setAttempt((count) => count + 1);
  };
  const controls = {
    onManageKeyboards: () => { setManageRemoved(false); setManaging(true); },
    onAddKeyboard: () => { setManaging(false); setImporting(false); setAdding(true); },
  };
  const wrap = (page: ReactNode) => <>{banner}{page}{managing ? <KeyboardCollection token={token} choices={boardChoices}
    active={layouts?.find((layout) => layout.id === selectedId)?.boardId ?? null} onChanged={reload} initiallyRemoved={manageRemoved}
    onClose={() => setManaging(false)} onAdd={controls.onAddKeyboard} /> : null}</>;

  if (listError !== null) {
    return wrap(
      <Shell>
        <ErrorState title="Can't load your layouts" {...(listError.retryable ? { onRetry: retry } : {})}>
          {listError.kind === "token" ? <RestartAdvice lead="keyloom restarted, so this page's link no longer works." /> : listError.message}
        </ErrorState>
      </Shell>
    );
  }
  // The imported layout is selected before the list that holds it arrives; the skeleton covers the gap, so the old layout doesn't flash.
  const imported = (result: ImportResponse) => {
    setLayouts(null);
    setView(null);
    setSelectedId(result.layoutId);
    setCarry({ id: result.layoutId, layerName: null, chatOpen: false, thread: null, review: true });
    setImporting(false);
    setAdding(false);
    setOnWall(false);
    setAttempt((count) => count + 1);
  };
  if (layouts === null) {
    return (
      <Shell fill>
        <BoardSkeleton boardId={null} label="Loading layouts" />
      </Shell>
    );
  }
  if (layouts.length === 0 || adding) {
    return wrap(
      <Shell menu={{ ...controls, layouts, selectedId: selectedId ?? "", boardChoices, onSelect: (id) => { setSelectedId(id); setAdding(false); }, onImport: () => setImporting(true) }}>
        <KeyboardWelcome token={token} collectionVersion={attempt} choices={boardChoices.filter((board) => !layouts.some((layout) => layout.boardId === board.id))} sync={sync} sources={layouts.map((layout) => ({ id: layout.id, name: layout.name,
          boardName: boardChoices.find((b) => b.id === layout.boardId)?.name ?? layout.boardId, note: null }))}
          onMade={(id, proposals = false) => { setAdding(false); setImporting(false); setLayouts(null); setView(null); setCarry({ id, layerName: null, chatOpen: false, thread: null, proposals }); reload(id); }}
          onManage={(removed = false) => { setManageRemoved(removed); setManaging(true); }} onBack={layouts.length === 0 ? undefined : () => setAdding(false)} />
      </Shell>
    );
  }

  const summary = layouts.find((layout) => layout.id === selectedId) ?? layouts[0];
  if (summary === undefined) return null;
  // A new, renamed or restored config changes the list; the switcher asks for it again, and a new config opens (D-315).
  const menu = {
    ...controls,
    layouts,
    selectedId: summary.id,
    onSelect: (id: string) => {
      setImporting(false);
      setCarry(null);
      setSelectedId(id);
      setOnWall(false);
    },
    onImport: () => setImporting(true),
    onReload: (selectId?: string) => {
      if (selectId !== undefined) {
        setSelectedId(selectId);
        setOnWall(false);
      }
      reload(selectId);
    },
    boardChoices,
  };

  const openBoardFromWall = (target: LayoutSummary, detail: LayoutDetail, triggerElement?: HTMLElement | null) => {
    if (triggerElement) {
      triggerElement.style.viewTransitionName = "flying-board";
    }
    setFlyingId(target.id);
    setSelectedId(target.id);
    setView({ id: target.id, detail });
    void markOpened(token, target.id);
    crossfade(
      () => {
        setOnWall(false);
      },
      () => {
        setFlyingId(null);
        if (triggerElement) triggerElement.style.viewTransitionName = "";
      },
    );
  };

  const returnToWall = () => {
    const deskBoard = document.querySelector<HTMLElement>(".stage > .keyboard-well");
    if (deskBoard) {
      deskBoard.style.viewTransitionName = "flying-board";
    }
    setFlyingId(selectedId);
    crossfade(
      () => {
        setOnWall(true);
        setAttempt((n) => n + 1);
      },
      () => {
        setFlyingId(null);
        if (deskBoard) deskBoard.style.viewTransitionName = "";
      },
    );
  };

  if (onWall) {
    return wrap(
      <Shell fill>
        <Pegboard token={token} layouts={layouts} sync={sync} flying={flyingId} onOpen={openBoardFromWall} onOpenById={(target) => { setView(null); setSelectedId(target.id); setOnWall(false); }} />
      </Shell>
    );
  }
  if (importing) {
    return wrap(
      <Shell menu={menu}>
        <ImportScreen token={token} onImported={imported} onBack={() => setImporting(false)} />
      </Shell>
    );
  }

  // A switch keeps the board on screen until the next one has loaded, then the two crossfade: a loading skeleton in between flashed
  // the whole page (BK, 2026-10-17: "the screen kinda just flashes, it's a little jarring").
  const previous = view !== null && "detail" in view ? layouts.find((layout) => layout.id === view.id) : undefined;
  const current = view !== null && view.id === summary.id ? view : previous !== undefined ? view : null;
  const shown = current !== null && current.id !== summary.id && previous !== undefined ? previous : summary;
  if (current === null) {
    return wrap(
      <Shell menu={menu} fill>
        <BoardSkeleton boardId={summary.boardId} label="Loading layout" />
      </Shell>
    );
  }
  if ("error" in current) {
    const gone = current.error.kind === "gone";
    return wrap(
      <Shell menu={menu}>
        <ErrorState
          title={gone ? "This layout is gone" : "Can't show this layout"}
          {...(current.error.retryable ? { onRetry: retry } : {})}
          {...(gone ? { actions: <button type="button" className="button button-primary" onClick={() => { setView(null); setSelectedId(null); setOnWall(true); setAttempt((count) => count + 1); }}>Show your other layouts</button> } : {})}
        >
          {current.error.kind === "token" ? <RestartAdvice lead="keyloom restarted, so this page's link no longer works." /> : current.error.message}
        </ErrorState>
      </Shell>
    );
  }

  return wrap(
    <LayoutPage
      key={shown.id}
      token={token}
      summary={shown}
      detail={current.detail}
      menu={menu}
      boardChoices={boardChoices}
      sync={sync}
      onHome={returnToWall}
      onChanged={refresh}
      arrival={carry !== null && carry.id === shown.id ? carry : null}
      repairDraft={repairDrafts[shown.id] ?? null}
      onRepairDraft={(id, draft, replace = false) => setRepairDrafts((current) => {
        if (replace && current[shown.id] !== undefined) return current;
        if (!replace && current[shown.id]?.id !== id) return current;
        if (draft === null) {
          if (current[shown.id] === undefined) return current;
          const next = { ...current };
          delete next[shown.id];
          return next;
        }
        return { ...current, [shown.id]: draft };
      })}
      onCarry={(id, next) => {
        setCarry({ id, ...next });
        setImporting(false);
        setSelectedId(id);
        setOnWall(false);
      }}
    />
  );
}

function LayoutPage({
  token,
  summary,
  detail,
  menu,
  boardChoices,
  sync,
  onHome,
  onChanged,
  arrival,
  repairDraft,
  onRepairDraft,
  onCarry,
}: {
  token: string;
  summary: LayoutSummary;
  detail: LayoutDetail;
  menu: HeaderMenu;
  boardChoices: readonly BoardChoice[];
  sync: SyncApi;
  onHome?: () => void;
  onChanged: () => Promise<void>;
  arrival: Arrival | null;
  repairDraft: FindingRepairDraft | null;
  onRepairDraft: (id: string, draft: FindingRepairDraft | null, replace?: boolean) => void;
  onCarry: (id: string, carry: Arrival) => void;
}) {
  const { document: layout, board, geometry } = detail;
  const problem = findProblem(detail);
  const rotated = useMemo(() => {
    try {
      return { keys: applyDisplayRotation(geometry.keys, board.display) };
    } catch (error) {
      return { error: describe(error).message };
    }
  }, [geometry.keys, board.display]);

  const boardSync = sync.boards.find((candidate) => candidate.boardId === summary.boardId);
  const autoSync = boardSync === undefined ? null : { on: boardSync.auto.on, paused: boardSync.auto.paused, onPause: () => void sync.setPaused(boardSync.boardId, true), onResume: () => void sync.setPaused(boardSync.boardId, false) };
  // The shape of the board is kept for the next first load's skeleton.
  useEffect(() => {
    if ("keys" in rotated) rememberShape(summary.boardId, rotated.keys, board.hands.left);
  }, [summary.boardId, rotated, board.hands.left]);

  const failure = problem ?? ("error" in rotated ? rotated.error : null);
  const page = (release: ReleaseHandle | null, dialog: ReactNode) => (
    <Shell menu={menu} bare={failure === null && "keys" in rotated} fill>
      {failure !== null || !("keys" in rotated) ? (
        <MismatchState token={token} summary={summary} fixable={problem !== null && board.keyCount === geometry.keys.length} problem={failure ?? "keyloom couldn't place this layout's keys on its board."} onHome={onHome} onReload={menu.onReload} />
      ) : (
        <Viewer
          detail={detail}
          summary={summary}
          keys={rotated.keys}
          token={token}
          layoutRef={summary.id}
          sync={sync}
          onChanged={onChanged}
          onOpenRelease={release?.open ?? noRelease}
          repairDraft={repairDraft}
          onRepairDraft={onRepairDraft}
          chrome={{ ...menu, onHome, boardChoices, ...(release === null ? {} : { release: { status: release.status, onOpen: () => release.open() } }), arrival, onCarry }}
        />
      )}
      {dialog}
    </Shell>
  );
  // The MacBook keyboard is applied by kanata, never built or flashed (R2-01): no dialog, no header button, no Docker check.
  if (board.firmware === "kanata") return page(null, null);
  return (
    <ReleaseHost token={token} layoutId={summary.id} head={detail.revision} boardName={board.name} boardRevisions={board.revisions} autoSync={autoSync}>
      {page}
    </ReleaseHost>
  );
}

// A board with no Build and flash ignores a request to open it; nothing on its page offers one.
const noRelease = (): void => undefined;

// Each check names the mismatch in plain words. Drawing a layer whose bindings don't line
// up with the keys would put labels on the wrong keys without any visible sign.
function findProblem({ document: layout, board, geometry }: LayoutDetail): string | null {
  if (board.keyCount !== geometry.keys.length) {
    return `${board.name} declares ${board.keyCount} keys, but its drawing has ${geometry.keys.length}, so keyloom can't place the keys.`;
  }
  const mismatch = layout.layers.find((layer) => layer.bindings.length !== geometry.keys.length);
  if (mismatch !== undefined) {
    return `Layer "${mismatch.name}" has ${mismatch.bindings.length} bindings, but ${board.name} has ${geometry.keys.length} keys.`;
  }
  return null;
}

/**
 * A layout keyloom can't draw on its board (R1-20). Trying again can't change that. When an earlier revision fits, the way back is one
 * button: History lives in the editor, which can't draw this layout, so the page offers that revision itself (D-502). Otherwise it
 * offers another layout, from the wall or the board switcher in the header, or archiving this one, which keeps its history.
 */
function MismatchState({ token, summary, problem, fixable, onHome, onReload }: { token: string; summary: LayoutSummary; problem: string; fixable: boolean; onHome?: (() => void) | undefined; onReload?: ((selectId?: string) => void) | undefined }) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [fitting, setFitting] = useState<FittingRevision>(null);
  // Set when the server refused Go back; the button then reloads the layout or goes, with the reason beside it (D-503).
  const [goBackRefused, setGoBackRefused] = useState<GoBackRefusal | null>(null);
  useEffect(() => {
    setGoBackRefused(null);
    setRefused(null);
  }, [summary.revisionId]);
  useEffect(() => {
    if (!fixable) return;
    const controller = new AbortController();
    // Not finding one leaves the other ways on; the page never says it looked.
    fetchFittingRevision(token, summary.id, controller.signal).then(setFitting).catch(() => setFitting(null));
    return () => controller.abort();
  }, [token, summary.id, fixable]);
  // Going back keeps this layout on screen; an archived one leaves it, so the reload selects nothing.
  const act = async (run: () => Promise<unknown>, failed: string, stay: boolean) => {
    setBusy(true);
    setRefused(null);
    try {
      await run();
      if (stay) onReload?.(summary.id);
      else onReload?.();
    } catch (error) {
      setRefused(error instanceof Error ? error.message : failed);
      setBusy(false);
    }
  };
  const goBack = (to: string) =>
    act(async () => {
      try {
        await undoChange(token, summary.id, { revisionId: summary.revisionId, to });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) setGoBackRefused(goBackRefusal(error.code, error.message));
        throw error;
      }
    }, "keyloom couldn't go back to that revision.", true);
  const archive = () => act(() => archiveConfig(token, summary.id), "keyloom couldn't archive it.", false);
  return (
    <ErrorState
      title="This layout doesn't match its board"
      actions={
        <>
          {fitting === null ? null : goBackRefused === null ? (
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void goBack(fitting.id)}>
              Go back to the last revision that matched
            </button>
          ) : goBackRefused.next === "reload" && onReload !== undefined ? (
            <button type="button" className="button button-primary" disabled={busy} onClick={() => onReload(summary.id)}>
              Reload this layout
            </button>
          ) : null}
          {onHome === undefined ? null : <button type="button" className={fitting === null ? "button button-primary" : "button"} onClick={onHome}>Show your other layouts</button>}
          <button type="button" className="button" disabled={busy} onClick={() => void archive()}>Archive this config</button>
        </>
      }
    >
      {problem}{" "}
      {fitting === null
        ? "Pick another layout, or archive this one; it keeps its history."
        : <>The last revision that matched is “{headline(fitting.summary)}”. Going back adds a new revision, so this one stays in History.</>}
      {refused === null ? null : <span className="state-refused" role="alert"> {goBackRefused?.text ?? refused}</span>}
    </ErrorState>
  );
}

type FittingRevision = FittingRevisionResponse["revision"];

export type HeaderMenu = { layouts: readonly LayoutSummary[]; selectedId: string; onSelect: (id: string) => void; onImport: () => void; onReload?: (selectId?: string) => void; boardChoices?: readonly BoardChoice[]; onManageKeyboards?: () => void; onAddKeyboard?: () => void };

// `fill` is the layout page, which is exactly the window tall so the board and its panel never scroll the page. A `bare` page draws its
// own top bar (the layout page's has the sync line, undo and the menu).
function Shell({
  menu,
  bare = false,
  fill = false,
  children,
}: {
  menu?: HeaderMenu;
  bare?: boolean;
  fill?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="app" data-fill={fill}>
      {bare ? null : <Header {...(menu ?? {})} />}
      <main className="app-main">{children}</main>
    </div>
  );
}

// A rejected token won't be accepted on a retry; the person has to open keyloom's link again.
function describe(error: unknown): Failure {
  if (error instanceof ApiError && error.status === 401) return { message: TOKEN_REJECTED, retryable: false, kind: "token" };
  if (error instanceof ApiError && error.code === "not_found") return { message: error.message, retryable: false, kind: "gone" };
  // Try again can work once keyloom is back; the banner's own reconnect also reads it again by itself.
  if (error instanceof ApiError && error.code === "unreachable") return { message: error.message, retryable: true, kind: "waiting" };
  if (error instanceof Error) return { message: error.message, retryable: true };
  return { message: "Something went wrong loading the layout.", retryable: true };
}
