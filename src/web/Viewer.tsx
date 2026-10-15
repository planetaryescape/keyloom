import { useEffect, useMemo, useRef, useState } from "react";
import type { GeometryKey } from "../boards/schema.ts";
import type { LayoutDetail } from "../api/http.ts";
import { describeKey, type KeyDescription } from "../layout/describe.ts";
import { ApiError } from "./api.ts";
import { undoChange } from "./api-write.ts";
import { BindingEditor, type DraftState } from "./editor/BindingEditor.tsx";
import { withBinding } from "./editor/draft.ts";
import { RevisionBar } from "./history/RevisionBar.tsx";
import { Inspector } from "./inspector/Inspector.tsx";
import { Legend } from "./inspector/Legend.tsx";
import { Keyboard, type KeyboardHandle } from "./keyboard/Keyboard.tsx";
import { LayerTabs } from "./keyboard/LayerTabs.tsx";
import { Notice, type NoticeState } from "./shell/Notice.tsx";

interface ViewerProps {
  detail: LayoutDetail;
  /** Geometry with the board's display rotation already applied. */
  keys: readonly GeometryKey[];
  token: string;
  /** The ref the write routes address this layout by. */
  layoutRef: string;
  /** Fetches the layout again after a change, resolving once the new one is on screen. */
  onChanged: () => Promise<void>;
}

type Editing = { layerId: string; position: number; focus: boolean };
const CLEAN: DraftState = { binding: null, dirty: false };

// The selected key survives a layer change, so flipping layers shows what the same key does on each.
export function Viewer({ detail, keys, token, layoutRef, onChanged }: ViewerProps) {
  const { document: layout, board, revision } = detail;
  const [layerId, setLayerId] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<DraftState>(CLEAN);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [applied, setApplied] = useState<{ layerId: string; position: number } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const keyboard = useRef<KeyboardHandle>(null);
  const editorBox = useRef<HTMLDivElement>(null);

  const layerIndex = Math.max(
    0,
    layout.layers.findIndex((candidate) => candidate.id === layerId),
  );
  const layer = layout.layers[layerIndex];

  // While a draft is complete the board shows it, so the key reads as it will once applied.
  const shown = useMemo(
    () =>
      editing !== null && draft.binding !== null
        ? withBinding(layout, editing.layerId, editing.position, draft.binding)
        : layout,
    [layout, editing, draft.binding],
  );
  const descriptions = useMemo(
    () => keys.map((_, index) => describeKey(shown, layerIndex, index)),
    [shown, layerIndex, keys],
  );

  const inspected = hovered ?? selected;
  const description: KeyDescription | null = inspected === null ? null : (descriptions[inspected] ?? null);

  const { partners, comboKeys } = useMemo(() => {
    const active = layout.combos.filter(
      (combo) => combo.layerIds === "all" || (layer !== undefined && combo.layerIds.includes(layer.id)),
    );
    const partnerSet = new Set<number>();
    for (const combo of active) {
      if (inspected !== null && combo.positions.includes(inspected)) {
        for (const position of combo.positions) if (position !== inspected) partnerSet.add(position);
      }
    }
    return { partners: partnerSet, comboKeys: new Set(active.flatMap((combo) => combo.positions)) };
  }, [layout.combos, layer, inspected]);

  // A pulse that outlives the apply would read as a second change, so it clears itself.
  useEffect(() => {
    if (applied === null) return;
    const timer = window.setTimeout(() => setApplied(null), 2200);
    return () => window.clearTimeout(timer);
  }, [applied]);

  // A freshly opened editor can start below the fold on a short window; bring it into view.
  useEffect(() => {
    if (editing?.focus !== true) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    editorBox.current?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
  }, [editing?.layerId, editing?.position, editing?.focus]);

  if (layer === undefined) return null;
  const editingHere = editing !== null && editing.layerId === layer.id;

  function select(index: number | null) {
    // A draft is the person's work; moving to another key doesn't get to discard it silently.
    if (editing !== null && draft.dirty && index !== editing.position) {
      setBlocked(true);
      return;
    }
    setSelected(index);
    if (editing === null) return;
    if (index === null) closeEditor(false);
    else if (index !== editing.position) setEditing({ layerId: editing.layerId, position: index, focus: false });
  }

  function chooseLayer(id: string) {
    if (editing !== null && draft.dirty) {
      setBlocked(true);
      return;
    }
    setLayerId(id);
    if (editing !== null) setEditing({ ...editing, layerId: id, focus: false });
  }

  function openEditor(position: number) {
    if (layer === undefined) return;
    setSelected(position);
    setNotice(null);
    setBlocked(false);
    setDraft(CLEAN);
    setEditing({ layerId: layer.id, position, focus: true });
  }

  function closeEditor(refocus: boolean) {
    const position = editing?.position ?? null;
    setEditing(null);
    setDraft(CLEAN);
    setBlocked(false);
    if (refocus && position !== null) keyboard.current?.focusKey(position);
  }

  async function onApplied(summary: string) {
    if (editing === null) return;
    const { layerId: appliedLayer, position } = editing;
    await onChanged();
    setApplied({ layerId: appliedLayer, position });
    setNotice({ kind: "success", message: "Applied", detail: summary });
    closeEditor(true);
  }

  // The layout moved on (another tab, the CLI): nothing was written, so say so and show the latest.
  function onStale() {
    setNotice({
      kind: "error",
      message: "The layout changed while you were editing",
      detail: "Your change was not applied. The latest version is showing, so you can make it again.",
    });
    closeEditor(true);
    void onChanged().catch(() => {});
  }

  async function undo() {
    setUndoing(true);
    const undone = revision.summary;
    const restored = revision.origin === "undo";
    try {
      await undoChange(token, layoutRef, { revisionId: revision.id });
      await onChanged();
      setNotice({ kind: "info", message: restored ? "Change restored" : "Undone", detail: undone.replace(/^Undid: /, "") });
    } catch (error) {
      const stale = error instanceof ApiError && error.status === 409;
      setNotice({
        kind: "error",
        message: stale ? "The layout changed since this page loaded" : "Couldn't undo",
        ...(stale
          ? { detail: "Showing the latest version now." }
          : error instanceof Error
            ? { detail: error.message }
            : {}),
      });
      if (stale) void onChanged().catch(() => {});
    } finally {
      setUndoing(false);
    }
  }

  const undoBlock = editing !== null && draft.dirty ? "Apply or cancel the key you are editing first" : null;

  return (
    <>
      {notice === null ? null : <Notice {...notice} onDismiss={() => setNotice(null)} />}
      <section className="stage" aria-label="Layout">
        <div className="stage-bar">
          <LayerTabs layers={layout.layers} selectedId={layer.id} onSelect={chooseLayer} />
          <RevisionBar revision={revision} busy={undoing} blockedReason={undoBlock} onUndo={() => void undo()} />
        </div>
        <Keyboard
          handle={keyboard}
          keys={keys}
          hands={board.hands}
          descriptions={descriptions}
          fingers={board.fingers}
          layerName={layer.name}
          selected={selected}
          partners={partners}
          comboKeys={comboKeys}
          pendingIndex={editingHere && draft.binding !== null ? editing.position : null}
          appliedIndex={applied !== null && applied.layerId === layer.id ? applied.position : null}
          onSelect={select}
          onHover={setHovered}
          onActivate={openEditor}
        />
        <Legend firmware={layout.firmware} />
      </section>
      {editing !== null ? (
        <div ref={editorBox}>
          <BindingEditor
            key={`${revision.id}:${editing.layerId}:${editing.position}`}
            token={token}
            layoutRef={layoutRef}
            layout={layout}
            revisionId={revision.id}
            layerId={editing.layerId}
            position={editing.position}
            finger={board.fingers[String(editing.position)]}
            autoFocus={editing.focus}
            blocked={blocked}
            onDraft={(next) => {
              setDraft(next);
              setBlocked(false);
            }}
            onClose={() => closeEditor(true)}
            onApplied={onApplied}
            onStale={onStale}
          />
        </div>
      ) : (
        <Inspector
          description={description}
          position={inspected}
          finger={inspected === null ? undefined : board.fingers[String(inspected)]}
          layerName={layer.name}
          tapAt={(position) => descriptions[position]?.legend.tap || "empty"}
          onOpenLayer={chooseLayer}
          {...(selected === null ? {} : { onEdit: () => openEditor(selected) })}
        />
      )}
    </>
  );
}
