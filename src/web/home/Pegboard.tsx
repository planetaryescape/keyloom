import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LayoutDetail, LayoutSummary } from "../../api/http.ts";
import { recentBoards } from "../../api/recent-boards.ts";
import type { GeometryKey } from "../../boards/schema.ts";
import { describeKey } from "../../layout/describe.ts";
import { fetchLayout } from "../api.ts";
import { tonesOf, useColourway } from "../keyboard/colourway.ts";
import { applyDisplayRotation } from "../keyboard/geometry.ts";
import { Keyboard } from "../keyboard/Keyboard.tsx";
import { boardDisplayName } from "../shell/Header.tsx";
import { boardLight } from "../sync/SyncStatus.tsx";
import type { SyncApi } from "../sync/useSync.ts";
import "./pegboard.css";

// The size each board is drawn at before the wall scales it down. The board renderer never draws a key under 34 px (legends stay
// readable in the editor), so a Glove80 can't be drawn into a quarter of the window directly; drawing it full size and scaling the
// picture keeps it the same board the editor shows, which is what lets it fly from the wall to the desk as one object (D-476).
const STAGE_W = 1100;
const STAGE_H = 520;

const NONE: ReadonlySet<number> = new Set();
const noop = () => {};

// Details are kept for the session, so coming home draws the wall at once and the flight has a board to land on.
const details = new Map<string, LayoutDetail>();
const detailKey = (layout: LayoutSummary) => `${layout.id}@${layout.revisionId}`;

const TONE_WORD = { ok: "On keyboard", pending: "Not on keyboard yet", bad: "Needs attention" } as const;

/** The home page (D-476): a pegboard with the boards opened most recently, newest at top left. Clicking one flies it to the desk. */
export function Pegboard({ token, layouts, sync, flying, onOpen, onOpenById }: {
  token: string;
  layouts: readonly LayoutSummary[];
  sync: SyncApi;
  /** The layout whose board is in flight to or from the desk; its board carries the transition's name. */
  flying: string | null;
  onOpen: (summary: LayoutSummary, detail: LayoutDetail, triggerElement?: HTMLElement | null) => void;
  /** Opens a layout whose board couldn't be drawn here; the editor loads it itself and says why if it can't (R1-21). */
  onOpenById: (summary: LayoutSummary) => void;
}) {
  const hung = useMemo(() => recentBoards(layouts), [layouts]);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    for (const layout of hung) {
      if (details.has(detailKey(layout))) continue;
      fetchLayout(token, layout.id, controller.signal).then(
        (detail) => {
          details.set(detailKey(layout), detail);
          setLoaded((n) => n + 1);
        },
        () => {
          if (!controller.signal.aborted) setFailed((was) => new Set([...was, layout.id]));
        },
      );
    }
    return () => controller.abort();
  }, [token, hung, attempt]);
  const retry = () => {
    setFailed(new Set());
    setAttempt((n) => n + 1);
  };

  return (
    <div className="pegboard-room" data-loaded={loaded}>
      <section className="pegboard" aria-labelledby="pegboard-title" data-count={hung.length}>
        {/* The wall has no visible title in the design; the page still needs one for a screen reader's heading list. */}
        <h1 id="pegboard-title" className="sr-only">Your keyboards</h1>
        <ul className="peg-grid">
          {hung.map((layout) => {
            const detail = details.get(detailKey(layout));
            const tone = boardLight(sync.boards.find((candidate) => candidate.boardId === layout.boardId));
            return (
              <li key={layout.boardId} className="peg-slot" data-flying={flying === layout.id ? "" : undefined}>
                {detail === undefined ? (
                  <div className="peg-board peg-board-empty" aria-busy={!failed.has(layout.id)}>
                    {failed.has(layout.id) ? (
                      <span className="peg-missing">
                        Can't draw this board
                        <span className="peg-missing-actions">
                          <button type="button" className="button" onClick={retry}>Try again</button>
                          <button type="button" className="button" onClick={() => onOpenById(layout)}>Open {layout.name}</button>
                        </span>
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <WallBoard
                    detail={detail}
                    name={layout.name}
                    flying={flying === layout.id}
                    onOpen={(element) => onOpen(layout, detail, element)}
                  />
                )}
                <p className="peg-label">
                  <span className="peg-name">{boardDisplayName(detail?.board.name ?? layout.boardId)}</span>
                  <span className="peg-config">{layout.name}</span>
                  {tone === null ? null : (
                    <span className="peg-state" data-tone={tone}>
                      <i aria-hidden="true" />
                      {TONE_WORD[tone]}
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function WallBoard({ detail, name, flying, onOpen }: { detail: LayoutDetail; name: string; flying?: boolean; onOpen: (element: HTMLElement | null) => void }) {
  const { document: layout, board, geometry } = detail;
  const keys = useMemo<readonly GeometryKey[] | null>(() => {
    try {
      return applyDisplayRotation(geometry.keys, board.display);
    } catch {
      return null;
    }
  }, [geometry.keys, board.display]);
  const [colourway] = useColourway(board.id, board.display?.colourways);
  const descriptions = useMemo(() => (keys ?? []).map((_, index) => describeKey(layout, 0, index)), [keys, layout]);
  const frame = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0);
  const [ledges, setLedges] = useState<readonly { left: number; width: number; top: number }[]>([]);

  const handleClick = () => {
    if (tiltRef.current) {
      tiltRef.current.style.viewTransitionName = "flying-board";
    }
    onOpen(tiltRef.current);
  };

  useLayoutEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const fit = () => setScale(Math.min(element.clientWidth / STAGE_W, element.clientHeight / STAGE_H));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The cradles sit under the case pieces as drawn: one ledge for a one-piece board, one per half for a split board, so each half rests
  // on its own bracket the way a split board is hung on a real wall.
  useEffect(() => {
    const element = frame.current;
    if (element === null || scale === 0) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const pieces = [...element.querySelectorAll<SVGGraphicsElement>(".keyboard-case > path, .keyboard-case > g")];
      const rects = pieces.map((piece) => piece.getBoundingClientRect()).filter((rect) => rect.width > 0);
      const spans = rects.length === 0 ? [] : mergeSpans(rects.map((rect) => ({ left: rect.left - box.left, right: rect.right - box.left })));
      const bottom = Math.max(...rects.map((rect) => rect.bottom)) - box.top;
      setLedges(spans.map((span) => ({ left: span.left + (span.right - span.left) * 0.14, width: (span.right - span.left) * 0.72, top: bottom - 6 })));
    };
    const frameId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frameId);
  }, [scale, keys]);

  // Opening it is still the way on: the layout page says why it can't be drawn and offers a way back (R3-22).
  if (keys === null) {
    return (
      <div className="peg-board peg-board-empty">
        <span className="peg-missing">
          Can't draw this board
          <span className="peg-missing-actions">
            {/* The layout's name, as on the tile that failed to load: two configs on one board would otherwise read the same. */}
            <button type="button" className="button" onClick={() => onOpen(null)}>Open {name}</button>
          </span>
        </span>
      </div>
    );
  }
  return (
    // The drawn keyboard's caps are buttons, so the board can't be one: an open button is laid over it instead.
    <div ref={frame} className="peg-board">
      <span ref={tiltRef} className={`peg-tilt${flying ? " peg-flying-cradle" : ""}`}>
        <span className="peg-stage" style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }} inert>
          <Keyboard
            keys={keys}
            keycaps={board.display?.keycaps}
            colourway={tonesOf(colourway, board.display?.colourways)}
            hands={board.hands}
            descriptions={descriptions}
            fingers={board.fingers}
            layerName={layout.layers[0]?.name ?? "Base"}
            selected={null}
            partners={NONE}
            comboKeys={NONE}
            onSelect={noop}
            onHover={noop}
            onPress={noop}
            display={board.display}
          />
        </span>
      </span>
      {ledges.map((ledge, index) => (
        <span key={index} className="peg-ledge" style={{ left: ledge.left, width: ledge.width, top: ledge.top }} aria-hidden="true" />
      ))}
      <button type="button" className="peg-open" onClick={handleClick} aria-label={`Open ${boardDisplayName(board.name)}`} />
    </div>
  );
}

/** Overlapping horizontal spans joined, so the pieces of one half (case, thumb cluster) share a ledge. */
function mergeSpans(spans: readonly { left: number; right: number }[]): { left: number; right: number }[] {
  const sorted = [...spans].sort((a, b) => a.left - b.left);
  const out: { left: number; right: number }[] = [];
  for (const span of sorted) {
    const last = out.at(-1);
    if (last !== undefined && span.left <= last.right + 4) last.right = Math.max(last.right, span.right);
    else out.push({ ...span });
  }
  return out;
}
