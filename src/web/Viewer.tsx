import { MousePointerClick, Repeat2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeometryKey } from "../boards/schema.ts";
import type { Binding } from "../layout/schema.ts";
import type { Slot } from "../layout/change.ts";
import type { ApplyResponse, ChatSelection, LayoutDetail, LayoutSummary as Summary, ProposalCard } from "../api/http.ts";
import { describeKey } from "../layout/describe.ts";
import { ApiError } from "./api.ts";
import { undoChange } from "./api-write.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { PreviewBanner } from "./chat/PreviewBanner.tsx";
import { layerName } from "./chat/proposal-facts.ts";
import { arrowsOn, marksOn, otherMarkedLayers, previewProposal, rememberedOn } from "./chat/preview.ts";
import { Reminders } from "./decisions/Reminders.tsx";
import { withBinding } from "./editor/draft.ts";
import { functionName } from "./editor/function-label.ts";
import type { Placement } from "./editor/lost-functions.ts";
import { RepeatPanel } from "./editor/RepeatPanel.tsx";
import type { LastChange } from "./editor/repeat-plan.ts";
import { advancedLegend } from "./keyboard/advanced-legend.ts";
import { Keyboard, type KeyboardHandle } from "./keyboard/Keyboard.tsx";
import { LayerTabs } from "./keyboard/LayerTabs.tsx";
import { KeyPanel, type DraftState, type KeyPanelHandle, type PlaceRequest } from "./panel/KeyPanel.tsx";
import { ChatBar } from "./shell/ChatBar.tsx";
import { FirstRunTip } from "./shell/FirstRunTip.tsx";
import { LayoutSummary } from "./shell/LayoutSummary.tsx";
import { SidePanel, type PanelMode } from "./shell/SidePanel.tsx";
import { readStored, writeStored } from "./shell/storage.ts";
import { Toasts, useToasts } from "./shell/Toasts.tsx";
import { Toolbar } from "./shell/Toolbar.tsx";
import type { SyncApi } from "./sync/useSync.ts";
import { useSyncToasts } from "./sync/useSyncToasts.ts";

interface ViewerProps {
  detail: LayoutDetail;
  summary: Summary;
  /** Geometry with the board's display rotation already applied. */
  keys: readonly GeometryKey[];
  token: string;
  /** The ref the write routes address this layout by. */
  layoutRef: string;
  /** Fetches the layout again after a change, resolving once the new one is on screen. */
  onChanged: () => Promise<void>;
  /** Opens the Build and flash dialog, which the chat points at after an apply. */
  onOpenRelease: () => void;
  /** The keyboard's sync state, for the toasts that say a change reached it or didn't. */
  sync: SyncApi;
}

type Editing = { layerId: string; position: number; focus: boolean };
const CLEAN: DraftState = { binding: null, dirty: false };
const NONE: ReadonlySet<number> = new Set();
const ADVANCED_KEY = "keyloom.advanced";

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null;

// The selected key survives a layer change, so flipping layers shows what the same key does on each.
export function Viewer({ detail, summary, keys, token, layoutRef, onChanged, onOpenRelease, sync }: ViewerProps) {
  const { document: layout, board, revision } = detail;
  const [layerId, setLayerId] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<DraftState>(CLEAN);
  const [blocked, setBlocked] = useState(false);
  // Place mode (D-092): a lost function waiting for the next key clicked on the board, and the keys already chosen.
  const [placing, setPlacing] = useState<PlaceRequest | null>(null);
  const [placements, setPlacements] = useState<readonly Placement[]>([]);
  const toasts = useToasts();
  useSyncToasts(sync, toasts.show);
  const [applied, setApplied] = useState<{ layerId: string; position: number } | null>(null);
  const [undoing, setUndoing] = useState(false);
  // The chat drawer. Open, a click on a key adds it to the "Asking about" chips; closed, it opens the key's panel (D-099).
  const [chatOpen, setChatOpen] = useState(false);
  // The keys in the chips, on one layer, and the proposal being previewed (hovered or pinned).
  const [chatSelection, setChatSelection] = useState<ChatSelection | null>(null);
  const [hoveredProposal, setHoveredProposal] = useState<ProposalCard | null>(null);
  const [pinnedProposal, setPinnedProposal] = useState<ProposalCard | null>(null);
  // The editor's last applied change, and whether the panel that repeats it on the chips' keys is open.
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
  const [repeating, setRepeating] = useState(false);
  // The keys of the decision being pointed at in the decisions list.
  const [decisionFocus, setDecisionFocus] = useState<Slot[] | null>(null);
  const [advanced, setAdvanced] = useState(() => readStored(ADVANCED_KEY) === "1");
  const keyboard = useRef<KeyboardHandle>(null);
  const panel = useRef<KeyPanelHandle>(null);

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
  // Pointing at a decision shows the layer its keys are on, unless the layer on screen has one of them.
  const focusLayerId =
    decisionFocus === null || decisionFocus.length === 0
      ? null
      : (decisionFocus.find((slot) => slot.layerId === layout.layers[headIndex]?.id) ?? decisionFocus[0])?.layerId ?? null;
  const layer = layout.layers.find((candidate) => candidate.id === (preview?.layerId ?? focusLayerId)) ?? layout.layers[headIndex];

  // While a draft is complete the board shows it, so the key reads as it will once applied.
  const shown = useMemo(() => {
    const base = preview?.layout ?? layout;
    if (editing === null || draft.binding === null) return base;
    // The board shows both keys of the change: the edited one and every key a kept function was put on.
    return placements.reduce(
      (acc, placement) => withBinding(acc, placement.slot.layerId, placement.slot.position, placement.binding),
      withBinding(base, editing.layerId, editing.position, draft.binding),
    );
  }, [layout, preview, editing, draft.binding, placements]);
  const layerIndex = Math.max(
    0,
    shown.layers.findIndex((candidate) => candidate.id === layer?.id),
  );
  const descriptions = useMemo(
    () => keys.map((_, index) => describeKey(shown, layerIndex, index)),
    [shown, layerIndex, keys],
  );
  // Firmware names, in the Advanced view only (D-101).
  const legendOverrides = useMemo(
    () => (advanced ? (shown.layers[layerIndex]?.bindings ?? []).map((binding) => advancedLegend(binding, shown) ?? undefined) : undefined),
    [advanced, shown, layerIndex],
  );
  // A layer key's edge takes the colour of the layer it points at.
  const layerColors = useMemo(() => {
    const colors = new Map<number, number>();
    descriptions.forEach((description, index) => {
      const target = description?.kind === "layer" ? shown.layers.findIndex((candidate) => candidate.id === description.targetLayerId) : -1;
      if (target >= 0) colors.set(index, (target % 6) + 1);
    });
    return colors;
  }, [descriptions, shown]);
  const marks = useMemo(() => {
    const own = marksOn(preview, layer?.id ?? "");
    if (placements.length === 0) return own;
    const withPlaced = new Map(own);
    for (const placement of placements) if (placement.slot.layerId === layer?.id) withPlaced.set(placement.slot.position, "home");
    return withPlaced;
  }, [preview, layer, placements]);
  const arrows = useMemo(() => arrowsOn(preview, layer?.id ?? ""), [preview, layer]);
  const markedLayers = useMemo(() => otherMarkedLayers(preview, layer?.id ?? ""), [preview, layer]);
  const remembered = useMemo(() => rememberedOn(preview, decisionFocus, layer?.id ?? ""), [preview, decisionFocus, layer]);
  const reminders = preview !== null && proposal !== null ? proposal.validation.diff.reminders : [];
  const chatSelected = useMemo(
    () => (chatOpen && chatSelection !== null && chatSelection.layerId === layer?.id ? new Set(chatSelection.positions) : NONE),
    [chatOpen, chatSelection, layer],
  );

  const inspected = hovered ?? selected;

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

  // Escape leaves place mode before it can close anything else, wherever focus is.
  useEffect(() => {
    if (placing === null) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPlacing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [placing]);

  // A draft that goes back to no change takes its kept functions with it.
  useEffect(() => {
    if (draft.binding !== null) return;
    setPlacements((previous) => (previous.length === 0 ? previous : []));
    setPlacing(null);
  }, [draft.binding]);

  const mode: PanelMode = chatOpen ? "chat" : editing !== null ? "key" : repeating ? "repeat" : "summary";

  // Opening the chat puts the cursor in its box, so Cmd-K then typing is one gesture.
  useEffect(() => {
    if (!chatOpen) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("#side-chat .composer textarea")?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [chatOpen]);

  const editingHere = editing !== null && layer !== undefined && editing.layerId === layer.id;

  // In place mode a click on the board chooses where the kept function goes, not which key opens.
  function placeOn(index: number) {
    if (placing === null || editing === null || layer === undefined) return;
    if (layer.id === editing.layerId && index === editing.position) {
      toasts.show({ kind: "info", message: "Choose a different key", detail: "This is the key you are changing." });
      return;
    }
    setPlacements((previous) => [
      ...previous.filter((candidate) => candidate.function !== placing.function),
      { function: placing.function, slot: { layerId: layer.id, position: index }, binding: placing.binding },
    ]);
    setPlacing(null);
  }

  function select(index: number | null) {
    // Place mode owns clicks; moving focus must not place anything.
    if (placing !== null) return;
    if (chatOpen || editing === null || index === null) {
      setSelected(index);
      return;
    }
    // A draft is the person's work; moving to another key doesn't get to discard it silently.
    if (draft.dirty && index !== editing.position) {
      setBlocked(true);
      return;
    }
    setSelected(index);
    if (index !== editing.position) setEditing({ layerId: editing.layerId, position: index, focus: false });
  }

  function press(index: number, via: "pointer" | "keyboard") {
    if (placing !== null) {
      placeOn(index);
      return;
    }
    if (chatOpen) {
      toggleChatKey(index);
      return;
    }
    // Enter on the key whose panel is open applies it (18#keyboard-use); a second click does nothing of the kind.
    if (via === "keyboard" && editing !== null && editing.position === index && editing.layerId === layer?.id) {
      panel.current?.apply();
      return;
    }
    openEditor(index);
  }

  function chooseLayer(id: string) {
    // A kept function can go on any layer, so place mode lets the board show another one.
    if (placing !== null) {
      setLayerId(id);
      return;
    }
    if (editing !== null && !chatOpen && draft.dirty) {
      setBlocked(true);
      return;
    }
    setLayerId(id);
    if (editing !== null) setEditing({ ...editing, layerId: id, focus: false });
  }

  function openEditor(position: number, onLayer?: string) {
    if (layer === undefined) return;
    if (editing !== null && draft.dirty && (position !== editing.position || (onLayer ?? layer.id) !== editing.layerId)) {
      setBlocked(true);
      return;
    }
    setSelected(position);
    setBlocked(false);
    if (editing?.position === position && editing.layerId === (onLayer ?? layer.id)) return;
    setDraft(CLEAN);
    setPlacing(null);
    setPlacements([]);
    setRepeating(false);
    setEditing({ layerId: onLayer ?? layer.id, position, focus: true });
  }

  function closeEditor(refocus: boolean) {
    const position = editing?.position ?? null;
    setEditing(null);
    setDraft(CLEAN);
    setPlacing(null);
    setPlacements([]);
    setBlocked(false);
    if (refocus && position !== null) keyboard.current?.focusKey(position);
  }

  function openChat() {
    if (editing !== null && draft.dirty) {
      toasts.show({ kind: "info", message: "Apply or reset the key you are editing first" });
      return;
    }
    if (editing !== null) closeEditor(false);
    setRepeating(false);
    setChatOpen(true);
  }

  function toggleChat() {
    if (chatOpen) setChatOpen(false);
    else openChat();
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

  // A chip is the one way from the chat to a key's panel (D-099).
  function openKeyFromChip(position: number) {
    const chipLayer = chatSelection?.layerId ?? layer?.id;
    if (chipLayer === undefined) return;
    setChatOpen(false);
    setLayerId(chipLayer);
    openEditor(position, chipLayer);
  }

  // Keyboard shortcuts that belong to the page, not to a control (18#keyboard-use).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleChat();
        return;
      }
      if (document.querySelector("dialog[open]") !== null) return;
      if (event.key === "Escape") {
        if (panel.current?.closePicker() === true) return;
        if (chatOpen) setChatOpen(false);
        else if (editing !== null) closeEditor(true);
        else if (repeating) setRepeating(false);
        return;
      }
      // 1 to 9 switch layers. With a key's panel open a digit is a key to type, so it goes to the panel instead.
      if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target) && (editing === null || chatOpen)) {
        const target = layout.layers[Number(event.key) - 1];
        if (target !== undefined) {
          event.preventDefault();
          chooseLayer(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // The handler reads the latest state through the closures of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // On a narrow screen the board is above the chat, so pinning a preview brings the board into view.
  function pinProposal(card: ProposalCard) {
    const unpin = pinnedProposal?.changeSetId === card.changeSetId;
    setPinnedProposal(unpin ? null : card);
  }

  // A proposal was applied on the server: show the new layout, on the layer where it changed.
  async function onProposalApplied(card: ProposalCard, _result: ApplyResponse) {
    setHoveredProposal(null);
    setPinnedProposal(null);
    await onChanged();
    const changed = [...card.validation.diff.changed, ...card.validation.diff.retuned];
    const here = changed.find((slot) => slot.layerId === layout.layers[headIndex]?.id) ?? changed[0];
    if (here !== undefined) {
      setLayerId(here.layerId);
      setApplied(here);
    }
    toasts.show({ kind: "success", message: "Applied", detail: card.title });
  }

  // The panel stays on the key after an apply, so the next slot can be filled straight away (16#the-key-panel).
  async function onApplied(summaryText: string, change: { before: Binding; after: Binding }) {
    if (editing === null) return;
    const { layerId: appliedLayer, position } = editing;
    setLastChange({ layerId: appliedLayer, position, ...change });
    await onChanged();
    setApplied({ layerId: appliedLayer, position });
    setDraft(CLEAN);
    setPlacements([]);
    setPlacing(null);
    toasts.show({ kind: "success", message: "Applied", detail: summaryText });
  }

  async function onRepeated(summaryText: string, firstPosition: number) {
    await onChanged();
    if (chatSelection !== null) {
      setLayerId(chatSelection.layerId);
      setApplied({ layerId: chatSelection.layerId, position: firstPosition });
    }
    toasts.show({ kind: "success", message: "Applied", detail: summaryText });
    setRepeating(false);
  }

  // The layout moved on (another tab, the CLI): nothing was written, so say so and show the latest.
  function onStale() {
    toasts.show({
      kind: "error",
      message: "The layout changed while you were editing",
      detail: "Your change was not applied. The latest version is showing, so you can make it again.",
    });
    closeEditor(true);
    setRepeating(false);
    void onChanged().catch(() => {});
  }

  async function undo() {
    setUndoing(true);
    const undone = revision.summary;
    const restored = revision.origin === "undo";
    try {
      await undoChange(token, layoutRef, { revisionId: revision.id });
      await onChanged();
      toasts.show({ kind: "info", message: restored ? "Change restored" : "Undone", detail: undone.replace(/^(Undo|Redo): /, "") });
    } catch (error) {
      const stale = error instanceof ApiError && error.status === 409;
      toasts.show({
        kind: "error",
        message: stale ? "The layout changed since this page loaded" : "Couldn't undo",
        ...(stale ? { detail: "Showing the latest version now." } : error instanceof Error ? { detail: error.message } : {}),
      });
      if (stale) void onChanged().catch(() => {});
    } finally {
      setUndoing(false);
    }
  }

  async function onTuned(summaryText: string) {
    await onChanged();
    toasts.show({ kind: "success", message: "Applied", detail: summaryText });
  }

  if (layer === undefined) return null;
  const undoBlock = editing !== null && draft.dirty ? "Apply or reset the key you are editing first" : null;
  const chips = chatSelection?.positions.length ?? 0;

  return (
    <div className="workspace">
      <Toolbar
        tabs={<LayerTabs layers={layout.layers} selectedId={layer.id} onSelect={chooseLayer} marked={markedLayers} />}
        revision={revision}
        busy={undoing}
        blockedReason={undoBlock}
        onUndo={() => void undo()}
        advanced={advanced}
        onAdvanced={(value) => {
          setAdvanced(value);
          writeStored(ADVANCED_KEY, value ? "1" : "0");
        }}
      />
      <div className="workbench">
        <section className="stage" aria-label="Layout" data-placing={placing !== null}>
          <Keyboard
            handle={keyboard}
            keys={keys}
            hands={board.hands}
            descriptions={descriptions}
            fingers={board.fingers}
            layerName={layer.name}
            selected={selected}
            current={mode === "key" && editingHere ? (editing?.position ?? null) : null}
            partners={partners}
            comboKeys={comboKeys}
            pendingIndex={editingHere && draft.binding !== null ? editing.position : null}
            appliedIndex={applied !== null && applied.layerId === layer.id ? applied.position : null}
            chatSelected={chatSelected}
            marks={marks}
            remembered={remembered}
            arrows={arrows}
            legendOverrides={legendOverrides}
            layerColors={layerColors}
            onSelect={select}
            onHover={setHovered}
            onPress={press}
          />
          <div className="stage-notes">
            {preview !== null && proposal !== null ? (
              <PreviewBanner
                title={proposal.title}
                layerName={layerName(layout, preview.layerId)}
                onStop={pinnedProposal !== null && hoveredProposal === null ? () => setPinnedProposal(null) : undefined}
              />
            ) : null}
            {placing === null ? null : (
              <p className="place-banner" role="status">
                <MousePointerClick size={16} aria-hidden="true" />
                <span>Click the key that should get {functionName(placing.function, layout)}. Escape cancels.</span>
                <button type="button" className="button" onClick={() => setPlacing(null)}>Cancel</button>
              </p>
            )}
            <FirstRunTip />
          </div>
          <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} />
        </section>
        <SidePanel
          mode={mode}
          summary={<LayoutSummary summary={summary} layout={layout} board={board} revision={revision} />}
          key_={
            editing === null ? null : (
              <KeyPanel
                key={`${revision.id}:${editing.layerId}:${editing.position}`}
                handle={panel}
                token={token}
                layoutRef={layoutRef}
                layout={layout}
                revisionId={revision.id}
                layerId={editing.layerId}
                position={editing.position}
                finger={board.fingers[String(editing.position)]}
                homeRow={(board.rows.home ?? []).includes(editing.position)}
                advanced={advanced}
                autoFocus={editing.focus}
                blocked={blocked}
                onDraft={(next) => {
                  setDraft(next);
                  setBlocked(false);
                }}
                placements={placements}
                placing={placing}
                onPlace={setPlacing}
                onUnplace={(fn) => setPlacements((previous) => previous.filter((candidate) => candidate.function !== fn))}
                onClose={() => closeEditor(true)}
                onApplied={onApplied}
                onTuned={onTuned}
                onStale={onStale}
                onShowLayer={(id) => {
                  if (!draft.dirty) setLayerId(id);
                }}
              />
            )
          }
          chat={
            <>
              {reminders.length === 0 ? null : (
                <section className="card remembered-card" aria-label="Remembered reasons">
                  <Reminders reminders={reminders} layout={layout} />
                </section>
              )}
              {chips === 0 || lastChange === null ? null : (
                <div className="repeat-strip">
                  <button type="button" className="button" onClick={() => { setChatOpen(false); setRepeating(true); }}>
                    <Repeat2 size={14} aria-hidden="true" />
                    Repeat my last change on {chips} {chips === 1 ? "key" : "keys"}
                  </button>
                </div>
              )}
              <ChatPanel
                token={token}
                layoutRef={layoutRef}
                layout={layout}
                board={board}
                revisionId={revision.id}
                onHighlightDecision={setDecisionFocus}
                selection={chatSelection}
                onRemoveKey={removeChatKey}
                onOpenKey={openKeyFromChip}
                onClearSelection={() => setChatSelection(null)}
                onRestoreSelection={(restored) => setChatSelection((current) => current ?? restored)}
                pinnedId={pinnedProposal?.changeSetId ?? null}
                onPreview={setHoveredProposal}
                onPin={pinProposal}
                onApplied={onProposalApplied}
                onOpenRelease={onOpenRelease}
              />
            </>
          }
          repeat={
            repeating && chatSelection !== null && lastChange !== null ? (
              <div className="repeat-pane">
                <button type="button" className="icon-button repeat-close" aria-label="Close" onClick={() => setRepeating(false)}>
                  <X size={16} aria-hidden="true" />
                </button>
                <RepeatPanel
                  key={`${revision.id}:${chatSelection.layerId}:${chatSelection.positions.join(",")}`}
                  token={token}
                  layoutRef={layoutRef}
                  layout={layout}
                  revisionId={revision.id}
                  layerId={chatSelection.layerId}
                  positions={chatSelection.positions}
                  last={lastChange}
                  onClose={() => setRepeating(false)}
                  onApplied={onRepeated}
                  onStale={onStale}
                />
              </div>
            ) : null
          }
        />
      </div>
      <ChatBar open={chatOpen} onToggle={toggleChat} />
    </div>
  );
}
