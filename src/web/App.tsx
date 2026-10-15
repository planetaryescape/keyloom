import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LayoutDetail, LayoutSummary } from "../api/http.ts";
import { ApiError, fetchLayout, fetchLayouts } from "./api.ts";
import { applyDisplayRotation } from "./keyboard/geometry.ts";
import { Header, type HeaderFacts } from "./shell/Header.tsx";
import { EmptyState, ErrorState, Loading } from "./shell/States.tsx";
import { ReleaseButton } from "./release/ReleaseButton.tsx";
import { ReleaseDialog } from "./release/ReleaseDialog.tsx";
import { releaseStatus } from "./release/status.ts";
import { useNow } from "./release/useNow.ts";
import { useRelease } from "./release/useRelease.ts";
import { Viewer } from "./Viewer.tsx";

type Failure = { message: string; retryable: boolean };
type View = { id: string; detail: LayoutDetail } | { id: string; error: Failure };

export function App({ token }: { token: string }) {
  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null);
  const [listError, setListError] = useState<Failure | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  // Bumping this refetches the list; it backs the "Check again" and "Try again" buttons.
  const [attempt, setAttempt] = useState(0);

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
        if (!controller.signal.aborted) setView({ id: selectedId, detail });
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
  if (layouts === null) {
    return (
      <Shell>
        <Loading>Loading layouts…</Loading>
      </Shell>
    );
  }
  if (layouts.length === 0) {
    return (
      <Shell>
        <EmptyState onRetry={retry} />
      </Shell>
    );
  }

  const summary = layouts.find((layout) => layout.id === selectedId) ?? layouts[0];
  if (summary === undefined) return null;
  const picker =
    layouts.length > 1 ? (
      <select
        className="layout-picker"
        aria-label="Layout"
        value={summary.id}
        onChange={(event) => setSelectedId(event.target.value)}
      >
        {layouts.map((layout) => (
          <option key={layout.id} value={layout.id}>
            {layout.name}
          </option>
        ))}
      </select>
    ) : undefined;

  // A view for an earlier selection is ignored until the new one arrives.
  const current = view !== null && view.id === summary.id ? view : null;
  if (current === null) {
    return (
      <Shell picker={picker}>
        <Loading>Loading layout…</Loading>
      </Shell>
    );
  }
  if ("error" in current) {
    return (
      <Shell picker={picker}>
        <ErrorState title="Can't show this layout" {...(current.error.retryable ? { onRetry: retry } : {})}>
          {current.error.message}
        </ErrorState>
      </Shell>
    );
  }

  return (
    <LayoutPage
      key={summary.id}
      token={token}
      summary={summary}
      detail={current.detail}
      picker={picker}
      onChanged={refresh}
    />
  );
}

function LayoutPage({
  token,
  summary,
  detail,
  picker,
  onChanged,
}: {
  token: string;
  summary: LayoutSummary;
  detail: LayoutDetail;
  picker: ReactNode;
  onChanged: () => Promise<void>;
}) {
  const { document: layout, board, geometry } = detail;
  const release = useRelease(token, summary.id);
  const [releaseOpen, setReleaseOpen] = useState(false);
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

  const facts: HeaderFacts = {
    layoutName: summary.name,
    board: `${board.vendor} ${board.name}`,
    firmware: layout.firmware,
    keyCount: board.keyCount,
    layerCount: layout.layers.length,
    createdAt: summary.createdAt,
    revisionId: detail.revision.id,
  };

  const failure = problem ?? ("error" in rotated ? rotated.error : null);
  return (
    <Shell
      facts={facts}
      picker={picker}
      actions={failure === null ? <ReleaseButton status={status} onOpen={() => setReleaseOpen(true)} /> : undefined}
    >
      {failure !== null || !("keys" in rotated) ? (
        <ErrorState title="This layout doesn't match its board">{failure}</ErrorState>
      ) : (
        <Viewer detail={detail} keys={rotated.keys} token={token} layoutRef={summary.id} onChanged={onChanged} />
      )}
      <ReleaseDialog
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        release={release}
        head={detail.revision}
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

function Shell({
  facts,
  picker,
  actions,
  children,
}: {
  facts?: HeaderFacts;
  picker?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="app">
      <Header {...(facts === undefined ? {} : { facts })} picker={picker} actions={actions} />
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
