import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { BoardChoice, ImportResponse, LayoutDetail, LayoutSummary } from "../api/http.ts";
import { ApiError, fetchLayout, fetchLayouts } from "./api.ts";
import { applyDisplayRotation } from "./keyboard/geometry.ts";
import { Header } from "./shell/Header.tsx";
import { fetchBoards } from "./import/api-import.ts";
import { ImportScreen } from "./import/ImportScreen.tsx";
import { BoardSkeleton } from "./shell/BoardSkeleton.tsx";
import { rememberShape } from "./shell/shape.ts";
import { ErrorState } from "./shell/States.tsx";
import { ReleaseDialog } from "./release/ReleaseDialog.tsx";
import { releaseStatus, type ReleaseStatus } from "./release/status.ts";
import { useNow } from "./release/useNow.ts";
import { useRelease } from "./release/useRelease.ts";
import { useSync, type SyncApi } from "./sync/useSync.ts";
import { Viewer, type Arrival } from "./Viewer.tsx";

type Failure = { message: string; retryable: boolean };
type View = { id: string; detail: LayoutDetail } | { id: string; error: Failure };

// Runs a state change that replaces the page as a crossfade where the browser has view transitions; elsewhere, and with reduced
// motion, it happens at once. flushSync makes React commit inside the transition's callback, so the new page is what it captures.
function crossfade(update: () => void) {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (doc.startViewTransition === undefined || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

export function App({ token }: { token: string }) {
  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null);
  const [listError, setListError] = useState<Failure | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // What a board or config switch carries to the layout it opens (D-317), kept with that layout's ID so nothing else picks it up.
  const [carry, setCarry] = useState<(Arrival & { id: string }) | null>(null);
  const [view, setView] = useState<View | null>(null);
  // The import screen from the layout menu; with no layouts it is the page itself.
  const [importing, setImporting] = useState(false);
  // Bumping this refetches the list; it backs the "Check again" and "Try again" buttons.
  const [attempt, setAttempt] = useState(0);
  // Where each keyboard stands against its layout's head; the server's engine does the work and this follows it (17).
  const sync = useSync(token);
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
        setLayouts(list);
        setSelectedId((previous) =>
          list.some((layout) => layout.id === previous) ? previous : (list[0]?.id ?? null),
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListError(describe(error));
      });
    return () => controller.abort();
  }, [token, attempt]);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    fetchLayout(token, selectedId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) crossfade(() => setView({ id: selectedId, detail }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setView({ id: selectedId, error: describe(error) });
      });
    return () => controller.abort();
  }, [token, selectedId, attempt]);

  // Refetches the open layout in place after an edit or undo, without the loading state a retry has.
  const refresh = useCallback(async () => {
    if (selectedId === null) return;
    const detail = await fetchLayout(token, selectedId, new AbortController().signal);
    setView({ id: selectedId, detail });
  }, [token, selectedId]);

  // When a CLI write (e.g. keyloom change apply) updates the layout, refresh the open editor.
  useEffect(() => {
    if (sync.lastLayoutUpdated && sync.lastLayoutUpdated.layoutId === selectedId) {
      void refresh();
    }
  }, [sync.lastLayoutUpdated, selectedId, refresh]);

  const retry = () => {
    setView(null);
    setAttempt((count) => count + 1);
  };

  if (listError !== null) {
    return (
      <Shell>
        <ErrorState title="Can't load your layouts" {...(listError.retryable ? { onRetry: retry } : {})}>
          {listError.message}
        </ErrorState>
      </Shell>
    );
  }
  // The imported layout is selected before the list that holds it arrives; the skeleton covers the gap, so the old layout doesn't flash.
  const imported = (result: ImportResponse) => {
    setLayouts(null);
    setView(null);
    setSelectedId(result.layoutId);
    setImporting(false);
    setAttempt((count) => count + 1);
  };
  if (layouts === null) {
    return (
      <Shell fill>
        <BoardSkeleton boardId={null} label="Loading layouts" />
      </Shell>
    );
  }
  if (layouts.length === 0) {
    return (
      <Shell>
        <ImportScreen token={token} onImported={imported} />
      </Shell>
    );
  }

  const summary = layouts.find((layout) => layout.id === selectedId) ?? layouts[0];
  if (summary === undefined) return null;
  // A new, renamed or restored config changes the list; the switcher asks for it again, and a new config opens (D-315).
  const reload = (selectId?: string) => {
    if (selectId !== undefined) setSelectedId(selectId);
    setAttempt((count) => count + 1);
  };
  const menu = { layouts, selectedId: summary.id, onSelect: (id: string) => { setImporting(false); setSelectedId(id); }, onImport: () => setImporting(true), onReload: reload, boardChoices };
  if (importing) {
    return (
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
    return (
      <Shell menu={menu} fill>
        <BoardSkeleton boardId={summary.boardId} label="Loading layout" />
      </Shell>
    );
  }
  if ("error" in current) {
    return (
      <Shell menu={menu}>
        <ErrorState title="Can't show this layout" {...(current.error.retryable ? { onRetry: retry } : {})}>
          {current.error.message}
        </ErrorState>
      </Shell>
    );
  }

  return (
    <LayoutPage
      key={shown.id}
      token={token}
      summary={shown}
      detail={current.detail}
      menu={menu}
      boardChoices={boardChoices}
      sync={sync}
      onChanged={refresh}
      arrival={carry !== null && carry.id === shown.id ? carry : null}
      onCarry={(id, next) => {
        setCarry({ id, ...next });
        setImporting(false);
        setSelectedId(id);
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
  onChanged,
  arrival,
  onCarry,
}: {
  token: string;
  summary: LayoutSummary;
  detail: LayoutDetail;
  menu: HeaderMenu;
  boardChoices: readonly BoardChoice[];
  sync: SyncApi;
  onChanged: () => Promise<void>;
  arrival: Arrival | null;
  onCarry: (id: string, carry: Arrival) => void;
}) {
  const { document: layout, board, geometry } = detail;
  const release = useRelease(token, summary.id);
  const [releaseOpen, setReleaseOpen] = useState(false);
  // History's "Flash this revision" builds an earlier revision instead of the head; null is the head.
  const [releaseTarget, setReleaseTarget] = useState<{ id: string; summary: string } | null>(null);
  const openRelease = (revision?: { id: string; summary: string }) => {
    setReleaseTarget(revision === undefined || revision.id === detail.revision.id ? null : revision);
    setReleaseOpen(true);
  };
  const releasing = release.build?.status === "running" || release.flash?.status === "waiting_for_bootloader" || release.flash?.status === "writing";
  const now = useNow(releasing);
  const status = releaseStatus(release.build, release.flash, detail.revision.id, now);
  const problem = findProblem(detail);
  const rotated = useMemo(() => {
    try {
      return { keys: applyDisplayRotation(geometry.keys, board.display) };
    } catch (error) {
      return { error: describe(error).message };
    }
  }, [geometry.keys, board.display]);

  const boardSync = sync.boards.find((candidate) => candidate.boardId === summary.boardId);
  const autoSync = boardSync === undefined ? null : { on: boardSync.auto.on, paused: boardSync.auto.paused, onPause: () => void sync.setPaused(boardSync.boardId, true) };
  // The shape of the board is kept for the next first load's skeleton.
  useEffect(() => {
    if ("keys" in rotated) rememberShape(summary.boardId, rotated.keys, board.hands.left);
  }, [summary.boardId, rotated, board.hands.left]);

  const failure = problem ?? ("error" in rotated ? rotated.error : null);
  return (
    <Shell menu={menu} bare={failure === null && "keys" in rotated} fill>
      {failure !== null || !("keys" in rotated) ? (
        <ErrorState title="This layout doesn't match its board">{failure}</ErrorState>
      ) : (
        <Viewer
          detail={detail}
          summary={summary}
          keys={rotated.keys}
          token={token}
          layoutRef={summary.id}
          sync={sync}
          onChanged={onChanged}
          onOpenRelease={openRelease}
          chrome={{ ...menu, boardChoices, release: { status, onOpen: () => openRelease() }, arrival, onCarry }}
        />
      )}
      <ReleaseDialog
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        release={release}
        head={releaseTarget ?? detail.revision}
        earlierRevision={releaseTarget !== null}
        autoSync={autoSync}
        boardName={board.name}
        status={status}
        now={now}
      />
    </Shell>
  );
}

// Each check names the mismatch in plain words. Drawing a layer whose bindings don't line
// up with the keys would put labels on the wrong keys without any visible sign.
function findProblem({ document: layout, board, geometry }: LayoutDetail): string | null {
  if (board.keyCount !== geometry.keys.length) {
    return `${board.name} declares ${board.keyCount} keys, but its geometry has ${geometry.keys.length}. Regenerate the board's geometry.`;
  }
  const mismatch = layout.layers.find((layer) => layer.bindings.length !== geometry.keys.length);
  if (mismatch !== undefined) {
    return `Layer "${mismatch.name}" has ${mismatch.bindings.length} bindings, but ${board.name} has ${geometry.keys.length} keys.`;
  }
  return null;
}

export type HeaderMenu = { layouts: readonly LayoutSummary[]; selectedId: string; onSelect: (id: string) => void; onImport: () => void; onReload?: (selectId?: string) => void; boardChoices?: readonly BoardChoice[] };

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
  if (error instanceof ApiError && error.status === 401) {
    return {
      message: "The keyloom server rejected this page's token. Open the link printed by keyloom again.",
      retryable: false,
    };
  }
  if (error instanceof Error) return { message: error.message, retryable: true };
  return { message: "Something went wrong loading the layout.", retryable: true };
}
