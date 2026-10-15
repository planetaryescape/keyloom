import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { coverage, positionFacts, type BoardDevView } from "../../boards/dev.ts";
import type { KeyDescription } from "../../layout/describe.ts";
import { fetchBoardDev } from "../api.ts";
import { Keyboard } from "../keyboard/Keyboard.tsx";
import { applyDisplayRotation } from "../keyboard/geometry.ts";
import { Header } from "../shell/Header.tsx";
import { ErrorState, Loading } from "../shell/States.tsx";
import "./boarddev.css";

const NONE: ReadonlySet<number> = new Set();

// A key's cap prints its position, which is the number board.json uses (counted from 0).
function describePosition(position: number): KeyDescription {
  return {
    kind: "key",
    legend: { kind: "key", tap: String(position) },
    headline: `Position ${position}`,
    fields: [],
    steps: [],
    options: [],
    combos: [],
  };
}

export function BoardDevApp({ token }: { token: string }) {
  const [view, setView] = useState<BoardDevView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // board.json is edited while this page is open, so the page reads it again on demand instead of once.
  const load = useCallback(() => {
    const controller = new AbortController();
    fetchBoardDev(token, controller.signal)
      .then((next) => {
        setView(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Something went wrong loading the board.");
      });
    return () => controller.abort();
  }, [token]);
  useEffect(load, [load]);

  const keys = useMemo(() => {
    if (view === null) return null;
    try {
      return applyDisplayRotation(view.geometry.keys, view.display);
    } catch {
      // A display rotation that names a position the geometry doesn't have is a board.json problem, and the plain keys still help.
      return view.geometry.keys;
    }
  }, [view]);
  const descriptions = useMemo(() => view?.geometry.keys.map((_, i) => describePosition(i)) ?? [], [view]);

  if (error !== null && view === null) {
    return (
      <Shell>
        <ErrorState title="Can't show this board" onRetry={load}>
          {error}
        </ErrorState>
      </Shell>
    );
  }
  if (view === null || keys === null) {
    return (
      <Shell>
        <Loading>Loading board…</Loading>
      </Shell>
    );
  }

  const shown = hovered ?? selected;
  const facts = shown === null ? null : positionFacts(view, shown);
  const done = coverage(view);
  const partners = facts?.mirror != null ? new Set([facts.mirror]) : NONE;

  return (
    <Shell>
      <div className="boarddev-bar">
        <div>
          <h1 className="layout-name">{view.name}</h1>
          <ul className="meta">
            <li>{view.id === "" ? "no id yet" : view.id}</li>
            <li>{view.geometry.keys.length} keys</li>
            <li>Position numbers start at 0</li>
          </ul>
        </div>
        <button type="button" className="button" onClick={load}>
          <RefreshCw size={14} aria-hidden="true" />
          Reload board.json
        </button>
      </div>

      <section className="card">
        <Keyboard
          keys={keys}
          hands={view.hands}
          descriptions={descriptions}
          fingers={view.fingers}
          layerName={view.name}
          selected={selected}
          partners={partners}
          comboKeys={NONE}
          onSelect={setSelected}
          onHover={setHovered}
        />
      </section>

      <section className="card boarddev-facts" aria-label="What board.json says">
        <div className="boarddev-key" aria-live="polite">
          {facts === null || shown === null ? (
            <p className="boarddev-idle">Hover or select a key to see what board.json says about it.</p>
          ) : (
            <dl className="fields">
              <Fact label="Position" value={String(shown)} code />
              <Fact label="Hand" value={facts.hand} />
              <Fact label="Finger" value={facts.finger} />
              <Fact label="Row" value={facts.row} />
              <Fact label="Mirror" value={facts.mirror === null ? null : `position ${facts.mirror}`} />
            </dl>
          )}
        </div>
        <ul className="boarddev-coverage">
          <Cover label="hands" have={done.hands} of={done.keys} />
          <Cover label="fingers" have={done.fingers} of={done.keys} />
          <Cover label="rows" have={done.rows} of={done.keys} />
          <li data-complete={done.mirror > 0}>
            <strong>{done.mirror}</strong> mirror pairs
          </li>
        </ul>
        {view.problems.length === 0 ? null : (
          <ul className="boarddev-problems" role="alert">
            {view.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function Fact({ label, value, code = false }: { label: string; value: string | null; code?: boolean }) {
  return (
    <div className={code ? "field field-code" : "field"}>
      <dt>{label}</dt>
      <dd>{value ?? <span className="boarddev-unset">not set</span>}</dd>
    </div>
  );
}

function Cover({ label, have, of }: { label: string; have: number; of: number }) {
  return (
    <li data-complete={have === of}>
      <strong>
        {have} of {of}
      </strong>{" "}
      {label}
    </li>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <Header />
      <main className="app-main">{children}</main>
    </div>
  );
}
