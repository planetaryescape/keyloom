import { useEffect, useState, type ReactNode } from "react";
import type { GeometryKey } from "../boards/schema.ts";
import type { LayoutDetail, LayoutSummary } from "../server/responses.ts";
import { ApiError, fetchLayout, fetchLayouts } from "./api.ts";
import { applyDisplayRotation } from "./keyboard/geometry.ts";
import { Keyboard } from "./keyboard/Keyboard.tsx";
import { LayerTabs } from "./keyboard/LayerTabs.tsx";

type View = { id: string; detail: LayoutDetail } | { id: string; error: string };

export function App({ token }: { token: string }) {
  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [layerId, setLayerId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchLayouts(token, controller.signal)
      .then((list) => {
        setLayouts(list);
        setSelectedId(list[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListError(describe(error));
      });
    return () => controller.abort();
  }, [token]);

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
  }, [token, selectedId]);

  if (listError !== null) {
    return (
      <Shell>
        <Message error>{listError}</Message>
      </Shell>
    );
  }
  if (layouts === null) {
    return (
      <Shell>
        <Message>Loading layouts…</Message>
      </Shell>
    );
  }
  if (layouts.length === 0) {
    return (
      <Shell>
        <Message>No layouts yet.</Message>
      </Shell>
    );
  }

  // A view for an earlier selection is ignored until the new one arrives.
  const current = view !== null && view.id === selectedId ? view : null;
  const picker =
    layouts.length > 1 ? (
      <select
        aria-label="Layout"
        value={selectedId ?? ""}
        onChange={(event) => {
          setSelectedId(event.target.value);
          setLayerId(null);
        }}
      >
        {layouts.map((layout) => (
          <option key={layout.id} value={layout.id}>
            {layout.name}
          </option>
        ))}
      </select>
    ) : (
      <span className="layout-name">{layouts[0]?.name}</span>
    );

  if (current === null) {
    return (
      <Shell picker={picker}>
        <Message>Loading layout…</Message>
      </Shell>
    );
  }
  if ("error" in current) {
    return (
      <Shell picker={picker}>
        <Message error>{current.error}</Message>
      </Shell>
    );
  }

  const { document: layout, board, geometry } = current.detail;
  const problem = findProblem(current.detail);
  if (problem !== null) {
    return (
      <Shell picker={picker}>
        <Message error>{problem}</Message>
      </Shell>
    );
  }

  const layerIndex = Math.max(
    0,
    layout.layers.findIndex((candidate) => candidate.id === layerId),
  );
  const layer = layout.layers[layerIndex];
  if (layer === undefined) {
    return (
      <Shell picker={picker}>
        <Message>This layout has no layers.</Message>
      </Shell>
    );
  }

  let keys: GeometryKey[];
  try {
    keys = applyDisplayRotation(geometry.keys, board.display);
  } catch (error) {
    return (
      <Shell picker={picker}>
        <Message error>{describe(error)}</Message>
      </Shell>
    );
  }

  return (
    <Shell picker={picker} board={board.name}>
      <LayerTabs layers={layout.layers} selectedId={layer.id} onSelect={setLayerId} />
      <div className="keyboard-frame">
        <Keyboard layout={layout} layerIndex={layerIndex} keys={keys} />
      </div>
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
  picker,
  board,
  children,
}: {
  picker?: ReactNode;
  board?: string;
  children?: ReactNode;
}) {
  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">keyloom</span>
        {picker}
        {board ? <span className="board-name">{board}</span> : null}
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}

function Message({ error = false, children }: { error?: boolean; children: ReactNode }) {
  return <p className={error ? "app-message app-error" : "app-message"}>{children}</p>;
}

function describe(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "The keyloom server rejected this page's token. Open the link printed by keyloom again.";
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong loading the layout.";
}
