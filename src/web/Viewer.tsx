import { useEffect, useMemo, useRef, useState } from "react";
import type { GeometryKey } from "../boards/schema.ts";
import type { ApplyResponse, ChatSelection, LayoutDetail, ProposalCard } from "../api/http.ts";
import { describeKey, type KeyDescription } from "../layout/describe.ts";
import { ApiError } from "./api.ts";
import { undoChange } from "./api-write.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { PreviewBanner } from "./chat/PreviewBanner.tsx";
import { layerName } from "./chat/proposal-facts.ts";
import { marksOn, previewProposal } from "./chat/preview.ts";
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
  /** Opens the Build and flash dialog, which the chat points at after an apply. */
  onOpenRelease: () => void;
}

type Editing = { layerId: string; position: number; focus: boolean };
const CLEAN: DraftState = { binding: null, dirty: false };
const NONE: ReadonlySet<number> = new Set();

// The selected key survives a layer change, so flipping layers shows what the same key does on each.
export function Viewer({ detail, keys, token, layoutRef, onChanged, onOpenRelease }: ViewerProps) {
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
  // The keys clicked for the chat, on one layer, and the proposal being previewed (hovered or pinned).
  const [chatSelection, setChatSelection] = useState<ChatSelection | null>(null);
  const [hoveredProposal, setHoveredProposal] = useState<ProposalCard | null>(null);
  const [pinnedProposal, setPinnedProposal] = useState<ProposalCard | null>(null);
  const stage = useRef<HTMLElement>(null);
  const keyboard = useRef<KeyboardHandle>(null);
  const editorBox = useRef<HTMLDivElement>(null);

  const headIndex = Math.max(
    0,
    layout.layers.findIndex((candidate) => candidate.id === layerId),
  );
  const proposal = hoveredProposal ?? pinnedProposal;
  // The editor and a preview never share the board: opening a key to edit ends the preview.
  const preview = useMemo(
    () => (proposal === null || editing !== null ? null : previewProposal(board, layout, proposal, layout.layers[headIndex]?.id ?? "")),
    [proposal, editing, board, layout, headIndex],
  );
  const layer = layout.layers.find((candidate) => candidate.id === preview?.layerId) ?? layout.layers[headIndex];

  // While a draft is complete the board shows it, so the key reads as it will once applied.
  const shown = useMemo(() => {
    const base = preview?.layout ?? layout;
    return editing !== null && draft.binding !== null ? withBinding(base, editing.layerId, editing.position, draft.binding) : base;
  }, [layout, preview, editing, draft.binding]);
  const layerIndex = Math.max(
    0,
    shown.layers.findIndex((candidate) => candidate.id === layer?.id),
  );
  const descriptions = useMemo(
    () => keys.map((_, index) => describeKey(shown, layerIndex, index)),
    [shown, layerIndex, keys],
  );
  const marks = useMemo(() => marksOn(preview, layer?.id ?? ""), [preview, layer]);
  const chatSelected = useMemo(
    () => (chatSelection !== null && chatSelection.layerId === layer?.id ? new Set(chatSelection.positions) : NONE),
    [chatSelection, layer],
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

  function toggleChatKey(position: number) {
    if (layer === undefined) return;
    setChatSelection((previous) => {
      if (previous === null || previous.layerId !== layer.id) return { layerId: layer.id, positions: [position] };
      const positions = previous.positions.includes(position)
        ? previous.positions.filter((candidate) => candidate !== position)
        : [...previous.positions, position].sort((a, b) => a - b);
      return positions.length === 0 ? null : { layerId: previous.layerId, positions };
    });
  }

  function removeChatKey(position: number) {
    setChatSelection((previous) => {
      if (previous === null) return null;
      const positions = previous.positions.filter((candidate) => candidate !== position);
      return positions.length === 0 ? null : { layerId: previous.layerId, positions };
    });
  }

  // On a narrow screen the board is above the chat, so pinning a preview brings the board into view.
  function pinProposal(card: ProposalCard) {
    const unpin = pinnedProposal?.changeSetId === card.changeSetId;
    setPinnedProposal(unpin ? null : card);
    if (unpin || !window.matchMedia("(max-width: 1279px)").matches) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.current?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  }

  // A proposal was applied on the server: show the new layout, on the layer where it changed.
  async function onProposalApplied(card: ProposalCard, _result: ApplyResponse) {
    setHoveredProposal(null);
    setPinnedProposal(null);
    await onChanged();
    const changed = card.validation.diff.changed;
    const here = changed.find((slot) => slot.layerId === layout.layers[headIndex]?.id) ?? changed[0];
    if (here !== undefined) {
      setLayerId(here.layerId);
      setApplied(here);
    }
    setNotice({ kind: "success", message: "Applied", detail: card.title });
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
      setNotice({ kind: "info", message: restored ? "Change restored" : "Undone", detail: undone.replace(/^(Undo|Redo): /, "") });
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
    <div className="workspace">
      <div className="workspace-main">
        {notice === null ? null : <Notice {...notice} onDismiss={() => setNotice(null)} />}
        <section className="stage" aria-label="Layout" ref={stage}>
          <div className="stage-bar">
            <LayerTabs layers={layout.layers} selectedId={layer.id} onSelect={chooseLayer} />
            {preview !== null && proposal !== null ? (
              <PreviewBanner
                title={proposal.title}
                layerName={layerName(layout, preview.layerId)}
                onStop={pinnedProposal !== null && hoveredProposal === null ? () => setPinnedProposal(null) : undefined}
              />
            ) : (
              <RevisionBar revision={revision} busy={undoing} blockedReason={undoBlock} onUndo={() => void undo()} />
            )}
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
            chatSelected={chatSelected}
            marks={marks}
            onToggle={toggleChatKey}
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
      </div>
      <ChatPanel
        token={token}
        layoutRef={layoutRef}
        layout={layout}
        board={board}
        selection={chatSelection}
        onRemoveKey={removeChatKey}
        onClearSelection={() => setChatSelection(null)}
        onRestoreSelection={(restored) => setChatSelection((current) => current ?? restored)}
        pinnedId={pinnedProposal?.changeSetId ?? null}
        onPreview={setHoveredProposal}
        onPin={pinProposal}
        onApplied={onProposalApplied}
        onOpenRelease={onOpenRelease}
      />
    </div>
  );
}
