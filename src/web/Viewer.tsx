import { MousePointerClick, Repeat2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { GeometryKey } from "../boards/schema.ts";
import type { Binding, Layout } from "../layout/schema.ts";
import type { ChangeOp, Slot } from "../layout/change.ts";
import { addLayerChange, convertLayerOps, duplicateLayerChange, layerColorOf, moveLayerOps, niceLayerName } from "../layout/layer-ops.ts";
import { bindingLegend } from "../layout/legend.ts";
import type { ApplyResponse, ChatSelection, LayoutDetail, LayoutSummary as Summary, ProposalCard, RevisionEntry } from "../api/http.ts";
import { describeKey } from "../layout/describe.ts";
import { ApiError } from "./api.ts";
import { undoChange, upgradeStoredLayout } from "./api-write.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { PreviewBanner } from "./chat/PreviewBanner.tsx";
import { layerName } from "./chat/proposal-facts.ts";
import { arrowsOn, marksOn, otherMarkedLayers, previewProposal, rememberedOn } from "./chat/preview.ts";
import { Reminders } from "./decisions/Reminders.tsx";
import { HistoryPanel } from "./history/HistoryPanel.tsx";
import { useRevisions } from "./history/useRevisions.ts";
import { ComboEditor, ComboList, draftFromCombo, type ComboDraft } from "./combos/ComboPane.tsx";
import { combosOn, newComboId } from "./combos/combo-ops.ts";
import { bindingSummary, withBinding } from "./editor/draft.ts";
import { DropConfirm } from "./editor/DropConfirm.tsx";
import { bindingAt, copyOps, copySummary, pasteOps, pasteSummary, quickAssignOps, quickAssignSummary, swapOps, swapSummary } from "./editor/move-ops.ts";
import { useChange, type ChangeOutcome } from "./editor/useChange.ts";
import { functionName } from "./editor/function-label.ts";
import type { Placement } from "./editor/lost-functions.ts";
import { RepeatPanel } from "./editor/RepeatPanel.tsx";
import type { LastChange } from "./editor/repeat-plan.ts";
import { advancedLegend } from "./keyboard/advanced-legend.ts";
import type { ComboLine } from "./keyboard/ComboLines.tsx";
import { Keyboard, type KeyboardHandle } from "./keyboard/Keyboard.tsx";
import { LayerTabs, type LayerActions } from "./keyboard/LayerTabs.tsx";
import { SelectionBar } from "./keyboard/SelectionBar.tsx";
import { extendSelection } from "./keyboard/selection.ts";
import { KeyMoves } from "./panel/KeyMoves.tsx";
import { LibraryPane } from "./panel/LibraryPane.tsx";
import { UpgradeOffer } from "./settings/UpgradeOffer.tsx";
import { KeyColour } from "./settings/KeyColour.tsx";
import { SettingsPane } from "./settings/SettingsPane.tsx";
import { type LightingDraft, withKeyColour, withLighting } from "./settings/lighting-ops.ts";
import { colourAt, hsvToHex, isDark } from "../layout/colour.ts";
import type { LayerLighting } from "../layout/schema.ts";
import { KeyPanel, type DraftState, type KeyPanelHandle, type PlaceRequest } from "./panel/KeyPanel.tsx";
import { keyForChar } from "./panel/slots.ts";
import { ChatBar } from "./shell/ChatBar.tsx";
import { FirstRunTip } from "./shell/FirstRunTip.tsx";
import { HalfSwitcher, type Half } from "./shell/HalfSwitcher.tsx";
import { LayoutSummary } from "./shell/LayoutSummary.tsx";
import { sheetHeight, type SheetSize } from "./shell/sheet.ts";
import { Shortcuts } from "./shell/Shortcuts.tsx";
import { SidePanel, type PanelMode } from "./shell/SidePanel.tsx";
import { readStored, writeStored } from "./shell/storage.ts";
import { Toasts, useToasts } from "./shell/Toasts.tsx";
import { Toolbar } from "./shell/Toolbar.tsx";
import { NARROW, PHONE, useMediaQuery } from "./shell/useMediaQuery.ts";
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
  /** Opens the Build and flash dialog, which the chat points at after an apply. With a revision, it builds that one instead of the head (History's "Flash this"). */
  onOpenRelease: (revision?: { id: string; summary: string }) => void;
  /** The keyboard's sync state, for the toasts that say a change reached it or didn't. */
  sync: SyncApi;
}

type Editing = { layerId: string; position: number; focus: boolean };
const CLEAN: DraftState = { binding: null, dirty: false, after: null };
const NONE: ReadonlySet<number> = new Set();
const ADVANCED_KEY = "keyloom.advanced";
const SHOW_COMBOS_KEY = "keyloom.showCombos";

// The window's height, so the sheet's three heights follow a rotated phone or a keyboard that opens.
function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
}

const editedNativeSource = (layout: Layout, at: { layerId: string; position: number }): string => {
  const b = layout.layers.find((l) => l.id === at.layerId)?.bindings[at.position];
  return b?.kind === "native" ? b.source : "";
};

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
  // Combos drawn as lines, the combos list, and the combo being made or edited (16#combos-are-made-from-a-selection).
  const [showCombos, setShowCombos] = useState(() => readStored(SHOW_COMBOS_KEY) === "1");
  const [combosOpen, setCombosOpen] = useState(false);
  const [comboDraft, setComboDraft] = useState<ComboDraft | null>(null);
  const [comboPicking, setComboPicking] = useState(false);
  const [hoverCombo, setHoverCombo] = useState<string | null>(null);
  // Moving keys (16#moving-and-copying-keys): the key waiting for a swap partner, the copied key, taps selecting instead of opening,
  // the keys typed so far in a quick-assign run, and a change that needs the person to agree to drop a function.
  const [swapping, setSwapping] = useState<Slot | null>(null);
  const [clipboard, setClipboard] = useState<{ binding: Binding; from: Slot } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [quick, setQuick] = useState<readonly string[] | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ ops: ChangeOp[]; summary: string; lost: string[]; reason: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const keyboard = useRef<KeyboardHandle>(null);
  const panel = useRef<KeyPanelHandle>(null);
  // History is a panel of its own; it stays chosen while a key or the chat is looked at, and comes back when they close.
  const [historyOpen, setHistoryOpen] = useState(false);
  // The library pane works the same way, and the keys on the board it points at (a hovered row's users). It shares the column with History, so one closes the other.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryKeys, setLibraryKeys] = useState<readonly number[] | null>(null);
  // The settings page shares the column with History and the library. Its staged layer colours are drawn on the board before they are applied (D-190).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lightingDraft, setLightingDraft] = useState<LightingDraft>(new Map());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const history = useRevisions(token, layoutRef, revision.id, historyOpen);
  // Phones: the panel is a bottom sheet and a split board shows one hand (18#phones).
  const narrow = useMediaQuery(NARROW);
  const phone = useMediaQuery(PHONE);
  const [sheet, setSheet] = useState<SheetSize>("half");
  const [half, setHalf] = useState<Half>("left");
  const viewportHeight = useViewportHeight();
  const splitBoard = board.hands.left.length > 0 && board.hands.right.length > 0;
  const shownHalf = phone && splitBoard ? half : null;

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
    // A change that brings a tap dance or a macro with it is drawn from the layout it makes.
    if (draft.after !== null) return draft.after;
    // The board shows both keys of the change: the edited one and every key a kept function was put on.
    return placements.reduce(
      (acc, placement) => withBinding(acc, placement.slot.layerId, placement.slot.position, placement.binding),
      withBinding(base, editing.layerId, editing.position, draft.binding),
    );
  }, [layout, preview, editing, draft.binding, draft.after, placements]);
  // Keys typed in a quick-assign run show on the board before they are applied, like a draft.
  const quickTargets = useMemo<Slot[]>(
    () => (chatSelection === null ? [] : chatSelection.positions.map((position) => ({ layerId: chatSelection.layerId, position }))),
    [chatSelection],
  );
  const view = useMemo(
    () =>
      quick === null
        ? shown
        : quick.reduce((acc, code, i) => {
            const at = quickTargets[i];
            return at === undefined ? acc : withBinding(acc, at.layerId, at.position, { kind: "key", code });
          }, shown),
    [shown, quick, quickTargets],
  );
  const layerIndex = Math.max(
    0,
    view.layers.findIndex((candidate) => candidate.id === layer?.id),
  );
  const descriptions = useMemo(
    () => keys.map((_, index) => describeKey(view, layerIndex, index)),
    [view, layerIndex, keys],
  );
  // Firmware names, in the Advanced view only (D-101).
  const legendOverrides = useMemo(
    () => (advanced ? (view.layers[layerIndex]?.bindings ?? []).map((binding) => advancedLegend(binding, view) ?? undefined) : undefined),
    [advanced, view, layerIndex],
  );
  // A layer key's edge takes the colour of the layer it points at: the one chosen for that layer, or the one its place picks.
  const layerColors = useMemo(() => {
    const colors = new Map<number, number>();
    descriptions.forEach((description, index) => {
      const target = description?.kind === "layer" ? view.layers.findIndex((candidate) => candidate.id === description.targetLayerId) : -1;
      if (target >= 0) colors.set(index, layerColorOf(view.layers, target));
    });
    return colors;
  }, [descriptions, view]);
  // The LED colour each key shows on this layer, with the staged colours applied, as a faint wash on the cap (D-192).
  const ledColors = useMemo(() => {
    const lit = withLighting(view, lightingDraft).layers[layerIndex];
    if (board.lighting === undefined || lit?.lighting === undefined) return undefined;
    const colours = new Map<number, string>();
    keys.forEach((_, index) => {
      const colour = colourAt(lit, index);
      if (!isDark(colour)) colours.set(index, hsvToHex(colour));
    });
    return colours;
  }, [view, lightingDraft, layerIndex, board.lighting, keys]);
  const marks = useMemo(() => {
    const own = marksOn(preview, layer?.id ?? "");
    if (placements.length === 0 && quick === null) return own;
    const withPlaced = new Map(own);
    for (const placement of placements) if (placement.slot.layerId === layer?.id) withPlaced.set(placement.slot.position, "home");
    quick?.forEach((_, i) => {
      const at = quickTargets[i];
      if (at !== undefined && at.layerId === layer?.id) withPlaced.set(at.position, "changed");
    });
    return withPlaced;
  }, [preview, layer, placements, quick, quickTargets]);
  const arrows = useMemo(() => arrowsOn(preview, layer?.id ?? ""), [preview, layer]);
  const markedLayers = useMemo(() => otherMarkedLayers(preview, layer?.id ?? ""), [preview, layer]);
  const remembered = useMemo(() => rememberedOn(preview, decisionFocus, layer?.id ?? ""), [preview, decisionFocus, layer]);
  const reminders = preview !== null && proposal !== null ? proposal.validation.diff.reminders : [];
  const chatSelected = useMemo(
    () => (chatSelection !== null && chatSelection.layerId === layer?.id ? new Set(chatSelection.positions) : NONE),
    [chatSelection, layer],
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

  // The lines "Show combos" draws, and the one being edited, which is drawn whether or not the toggle is on.
  const comboLines = useMemo<ComboLine[]>(() => {
    if (layer === undefined) return [];
    const ctx = { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances };
    const lineFor = (id: string, name: string, positions: readonly number[], output: Binding | null, editing: boolean): ComboLine => {
      const legend = output === null ? null : bindingLegend(output, ctx);
      const label = legend === null ? "…" : legend.hold === undefined ? legend.tap : `${legend.tap} ${legend.hold}`;
      return {
        id, positions, label, editing,
        name: `${name}, keys ${positions.map((position) => position + 1).join(" and ")}${output === null ? "" : `, sends ${bindingSummary(output, layout)}`}`,
      };
    };
    const lines = showCombos ? combosOn(layout, layer.id).filter((combo) => combo.id !== comboDraft?.id).map((combo) => lineFor(combo.id, combo.name, combo.positions, combo.output, false)) : [];
    if (comboDraft !== null && comboDraft.positions.length >= 2) lines.push(lineFor(comboDraft.id, comboDraft.name || "New combo", comboDraft.positions, comboDraft.output, true));
    return lines;
  }, [showCombos, layout, layer, comboDraft]);
  // Pointing at a combo (its line, its label or its row) lights the keys it is made of.
  const comboLit = useMemo<ReadonlySet<number>>(() => {
    const positions = new Set<number>(comboDraft?.positions ?? []);
    const hovered = hoverCombo === null ? undefined : (hoverCombo === comboDraft?.id ? comboDraft : layout.combos.find((combo) => combo.id === hoverCombo));
    for (const position of hovered?.positions ?? []) positions.add(position);
    return positions;
  }, [comboDraft, hoverCombo, layout.combos]);

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

  const undoBlock = editing !== null && draft.dirty ? "Apply or reset the key you are editing first" : null;
  const mode: PanelMode = chatOpen ? "chat" : editing !== null ? "key" : comboDraft !== null || combosOpen ? "combo" : repeating ? "repeat" : historyOpen ? "history" : libraryOpen ? "library" : settingsOpen ? "settings" : "summary";
  const libraryHighlight = useMemo(() => (mode === "library" && libraryKeys !== null ? new Set(libraryKeys) : NONE), [mode, libraryKeys]);

  // Opening the chat puts the cursor in its box, so Cmd-K then typing is one gesture.
  useEffect(() => {
    if (!chatOpen) return;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("#side-chat .composer textarea")?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [chatOpen]);

  // A panel that opens on a narrow screen opens at half height, not left at a peek from the last one.
  useEffect(() => {
    if (narrow && mode !== "summary") setSheet((current) => (current === "peek" ? "half" : current));
  }, [narrow, mode]);

  // A key on the hand that isn't showing can't be edited from view, so the board turns to its hand.
  useEffect(() => {
    if (editing === null || !phone) return;
    if (board.hands.left.includes(editing.position)) setHalf("left");
    else if (board.hands.right.includes(editing.position)) setHalf("right");
  }, [editing?.position, editing?.layerId, phone, board.hands]);

  // The key being edited stays above the sheet that opens over the lower part of the screen.
  useEffect(() => {
    if (editing === null || !narrow || mode !== "key") return;
    const frame = window.requestAnimationFrame(() => keyboard.current?.scrollKeyIntoView(editing.position));
    return () => window.cancelAnimationFrame(frame);
  }, [editing?.position, editing?.layerId, narrow, mode, sheet, shownHalf]);

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

  // One change set from the board or the tabs. A change that would drop the only copy of a function asks first (D-092).
  const change = useChange({ token, layoutRef, revisionId: revision.id, onChanged, onStale });

  async function perform(ops: ChangeOp[], summary: string, options: { dropReason?: string; quiet?: boolean } = {}): Promise<ChangeOutcome> {
    setChanging(true);
    const outcome = await change(ops, summary);
    setChanging(false);
    if (outcome.ok) {
      toasts.show({ kind: "success", message: "Applied", detail: [summary, outcome.warnings[0]].filter(Boolean).join(". ") });
    } else if (outcome.lost.length > 0 && options.dropReason !== undefined) {
      setPendingDrop({ ops, summary, lost: outcome.lost, reason: options.dropReason });
    } else if (options.quiet !== true && !outcome.stale) {
      toasts.show({ kind: "error", message: outcome.message, detail: outcome.problems.slice(0, 2).join(" ") });
    }
    return outcome;
  }

  // The panel's draft would be lost under a change that reloads the layout, so the board's moves wait for it.
  function draftBlocks(): boolean {
    if (editing === null || !draft.dirty) return false;
    toasts.show({ kind: "info", message: "Apply or reset the key you are editing first" });
    return true;
  }

  const dropOps = (functions: readonly string[], reason: string): ChangeOp[] => functions.map((fn) => ({ op: "dropFunction", function: fn, reason }));

  // Layers (16#layers-are-managed-in-their-tabs): each action is one change set, by layer id.
  const layerNameOf = (id: string) => niceLayerName(layout.layers.find((candidate) => candidate.id === id)?.name ?? id);
  const layerActions: LayerActions | undefined =
    preview !== null
      ? undefined
      : {
          blockedReason: undoBlock,
          add: async () => {
            const added = addLayerChange(layout);
            const outcome = await perform(added.ops, `Added ${added.name}`);
            if (!outcome.ok) return;
            setLayerId(added.layerId);
            setRenamingId(added.layerId);
          },
          rename: async (id, name) => {
            if (layout.layers.some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === name.toLowerCase())) {
              toasts.show({ kind: "info", message: `Another layer is already called ${name}` });
              return;
            }
            await perform([{ op: "renameLayer", layerId: id, name }], `Renamed ${layerNameOf(id)} to ${name}`);
          },
          duplicate: async (id) => {
            const copy = duplicateLayerChange(layout, id);
            if (copy === null) return;
            const outcome = await perform(copy.ops, `Duplicated ${layerNameOf(id)} as ${copy.name}`);
            if (outcome.ok) setLayerId(copy.layerId);
          },
          move: async (id, toIndex) => {
            const ops = moveLayerOps(layout, id, toIndex);
            if (ops === null) {
              toasts.show({ kind: "info", message: "The base layer stays first" });
              return;
            }
            await perform(ops, `Moved ${layerNameOf(id)} to position ${toIndex + 1}`);
          },
          style: async (id, label, color) => {
            await perform([{ op: "setLayerStyle", layerId: id, shortLabel: label, color }], `Changed the label and colour of ${layerNameOf(id)}`);
          },
          convert: async (id, from, to) => {
            const ops = convertLayerOps(layout, id, from, to);
            if (ops === null) return;
            await perform(ops, `Turned ${ops.length} ${from} ${ops.length === 1 ? "key" : "keys"} into ${to} on ${layerNameOf(id)}`);
          },
          remove: async (id, drops) => {
            const name = layerNameOf(id);
            const outcome = await perform([...dropOps(drops, `Deleted layer ${name}`), { op: "removeLayer", layerId: id }], `Deleted layer ${name}`, { quiet: true });
            if (outcome.ok && editing?.layerId === id) closeEditor(false);
            return outcome;
          },
          openKey: (slot) => {
            setLayerId(slot.layerId);
            openEditor(slot.position, slot.layerId);
          },
          notify: (message) => toasts.show({ kind: "info", message }),
          nameFunction: (fn) => functionName(fn, layout),
        };

  // Selecting several keys: Shift- or Cmd-click, or taps in select mode. The key whose panel is open joins the first Shift-click.
  function extendSelectionTo(position: number) {
    if (layer === undefined) return;
    setChatSelection((previous) => extendSelection(previous, layer.id, position, editingHere && editing !== null ? editing.position : null));
  }

  // Combos: "Make a combo" takes the selected keys to the combo panel, which opens on the output picker.
  function makeCombo() {
    if (chatSelection === null || chatSelection.positions.length < 2 || draftBlocks()) return;
    if (editing !== null) closeEditor(false);
    setChatOpen(false);
    setSelectMode(false);
    setComboDraft({ id: newComboId(layout), isNew: true, name: "", positions: [...chatSelection.positions], layerIds: "all", output: null, timeoutMs: undefined });
    setComboPicking(false);
    setCombosOpen(true);
    setChatSelection(null);
  }

  function openCombo(id: string) {
    const combo = layout.combos.find((candidate) => candidate.id === id);
    if (combo === undefined || draftBlocks()) return;
    if (editing !== null) closeEditor(false);
    setChatOpen(false);
    setComboDraft(draftFromCombo(combo));
    setComboPicking(false);
    setCombosOpen(true);
  }

  function toggleCombos() {
    const on = !showCombos;
    setShowCombos(on);
    writeStored(SHOW_COMBOS_KEY, on ? "1" : "0");
    if (!on) {
      setCombosOpen(false);
      setComboDraft(null);
      setComboPicking(false);
      return;
    }
    if (draftBlocks()) return;
    if (editing !== null) closeEditor(false);
    setCombosOpen(true);
  }

  // The keys a paste reaches: the selected keys, or the open key.
  function pasteTargets(): Slot[] {
    if (chatSelection !== null) return chatSelection.positions.map((position) => ({ layerId: chatSelection.layerId, position }));
    return editing === null ? [] : [{ layerId: editing.layerId, position: editing.position }];
  }

  function copyKey(slot: Slot) {
    const binding = bindingAt(layout, slot);
    if (binding === undefined) return;
    setClipboard({ binding, from: slot });
    toasts.show({ kind: "info", message: "Copied", detail: bindingSummary(binding, layout) });
  }

  async function paste() {
    const targets = pasteTargets();
    if (clipboard === null || targets.length === 0 || draftBlocks()) return;
    const ops = pasteOps(layout, clipboard.binding, targets);
    if (ops === null) {
      toasts.show({ kind: "info", message: "Already that", detail: "Every key already does this." });
      return;
    }
    const what = bindingSummary(clipboard.binding, layout);
    // The history line counts the keys that changed, not the ones that already had it.
    const changed = ops.flatMap((op) => (op.op === "setBinding" ? [op.at] : []));
    const outcome = await perform(ops, pasteSummary(layout, clipboard.binding, changed), { dropReason: `Replaced by pasting ${what}` });
    if (outcome.ok) setChatSelection(null);
  }

  async function finishSwap(index: number) {
    if (swapping === null || layer === undefined) return;
    const to = { layerId: layer.id, position: index };
    const ops = swapOps(swapping, to);
    if (ops === null) {
      toasts.show({ kind: "info", message: "Choose a different key", detail: "This is the key you are swapping." });
      return;
    }
    const summaryText = swapSummary(layout, swapping, to);
    setSwapping(null);
    const outcome = await perform(ops, summaryText);
    if (outcome.ok) setApplied(to);
  }

  // A drag from one key onto another swaps them; with Option held it copies instead. Both are on the layer showing.
  async function dropKey(from: number, to: number, copy: boolean) {
    if (layer === undefined || draftBlocks()) return;
    const a = { layerId: layer.id, position: from };
    const b = { layerId: layer.id, position: to };
    const ops = copy ? copyOps(layout, a, b) : swapOps(a, b);
    if (ops === null) {
      toasts.show({ kind: "info", message: "Already that", detail: "Both keys do the same thing." });
      return;
    }
    const what = bindingSummary(bindingAt(layout, a) ?? { kind: "none" }, layout);
    const outcome = await perform(ops, copy ? copySummary(layout, a, b) : swapSummary(layout, a, b), { dropReason: `Replaced by a copy of ${what}` });
    if (outcome.ok) setApplied(b);
  }

  // Quick assign: typed keys go to the selected keys in order and are applied together when the run ends.
  function startQuick() {
    if (chatSelection === null || draftBlocks()) return;
    if (editing !== null) closeEditor(false);
    setChatOpen(false);
    setSelectMode(false);
    setQuick([]);
  }

  async function applyQuick() {
    if (quick === null || quick.length === 0) return;
    const ops = quickAssignOps(quickTargets, quick);
    if (ops === null) return;
    const outcome = await perform(ops, quickAssignSummary(layout, quickTargets, quick), { dropReason: "Replaced by typing the key" });
    if (outcome.ok) {
      setQuick(null);
      setChatSelection(null);
    }
  }

  // While a run is open the keyboard types into it, ahead of every other shortcut.
  useEffect(() => {
    if (quick === null) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (typing(event.target) || document.querySelector("dialog[open]") !== null) return;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === "Escape") {
        handled();
        setQuick(null);
      } else if (event.key === "Enter") {
        handled();
        void applyQuick();
      } else if (event.key === "Backspace") {
        handled();
        setQuick((codes) => (codes === null ? codes : codes.slice(0, -1)));
      } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        handled();
        const code = keyForChar(event.key)?.name;
        if (code === undefined) toasts.show({ kind: "info", message: `${event.key} isn't a key keyloom knows how to type` });
        else if (quick.length >= quickTargets.length) toasts.show({ kind: "info", message: "Every selected key has its key", detail: "Press Enter to apply, or Backspace to change one." });
        else setQuick((codes) => [...(codes ?? []), code]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // applyQuick reads the latest run through this render's closure; the effect is rebuilt as the run grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick, quickTargets, layout, revision.id]);

  function select(index: number | null) {
    // Place, swap and combo-key modes own clicks; moving focus must not choose anything.
    if (placing !== null || swapping !== null || comboPicking) return;
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

  function press(index: number, via: "pointer" | "keyboard", extend = false) {
    if (placing !== null) {
      placeOn(index);
      return;
    }
    if (comboPicking && comboDraft !== null) {
      const has = comboDraft.positions.includes(index);
      if (has && comboDraft.positions.length <= 2) {
        toasts.show({ kind: "info", message: "A combo needs at least two keys" });
        return;
      }
      setComboDraft({ ...comboDraft, positions: (has ? comboDraft.positions.filter((candidate) => candidate !== index) : [...comboDraft.positions, index]).sort((a, b) => a - b) });
      return;
    }
    if (swapping !== null) {
      void finishSwap(index);
      return;
    }
    if (quick !== null) return;
    if (via === "pointer" && (extend || selectMode) && !chatOpen) {
      if (extend) extendSelectionTo(index);
      else toggleChatKey(index);
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
    // A kept function, or a swap partner, can be on any layer, so those modes let the board show another one.
    if (placing !== null || swapping !== null || comboPicking) {
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
    // A key opens over the combo being made; the combo is not kept.
    setComboDraft(null);
    setComboPicking(false);
    if (editing?.position === position && editing.layerId === (onLayer ?? layer.id)) return;
    setDraft(CLEAN);
    setPlacing(null);
    setPlacements([]);
    setRepeating(false);
    setSwapping(null);
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
      // Undo and redo are the revisions' (18#keyboard-use); inside a text box they stay the box's own.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z" && !typing(event.target)) {
        event.preventDefault();
        stepRevision(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target)) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      // Copy and paste act on selected keys, or on the open key; anywhere else the browser's own copy and paste are left alone.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !typing(event.target) && (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "v") && window.getSelection()?.toString() === "") {
        const source = chatSelection?.positions.length === 1 ? { layerId: chatSelection.layerId, position: chatSelection.positions[0] ?? 0 } : editing !== null ? { layerId: editing.layerId, position: editing.position } : null;
        if (event.key.toLowerCase() === "c" && source !== null) {
          event.preventDefault();
          copyKey(source);
          return;
        }
        if (event.key.toLowerCase() === "v" && clipboard !== null && (chatSelection !== null || editing !== null)) {
          event.preventDefault();
          void paste();
          return;
        }
      }
      if (event.key === "Escape") {
        if (panel.current?.closePicker() === true) return;
        if (swapping !== null) setSwapping(null);
        else if (comboPicking) setComboPicking(false);
        else if (comboDraft !== null) setComboDraft(null);
        else if (chatOpen) setChatOpen(false);
        else if (editing !== null) closeEditor(true);
        else if (repeating) setRepeating(false);
        else if (historyOpen) setHistoryOpen(false);
        else if (libraryOpen) setLibraryOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (combosOpen) setCombosOpen(false);
        else if (chatSelection !== null) setChatSelection(null);
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

  // One step back or forward (the head's undo), or, with `target`, back to any earlier revision as one new revision (D-170).
  async function undo(target?: RevisionEntry) {
    setUndoing(true);
    const undone = target?.summary ?? revision.summary;
    const restored = target === undefined && revision.origin === "undo";
    try {
      await undoChange(token, layoutRef, { revisionId: revision.id, ...(target === undefined ? {} : { to: target.id }) });
      await onChanged();
      toasts.show(
        target === undefined
          ? { kind: "info", message: restored ? "Change restored" : "Undone", detail: undone.replace(/^(Undo|Redo): /, "") }
          : { kind: "info", message: "Went back", detail: undone },
      );
    } catch (error) {
      const stale = error instanceof ApiError && error.status === 409 && error.code !== "validation_failed";
      toasts.show({
        kind: "error",
        message: stale ? "The layout changed since this page loaded" : target === undefined ? "Couldn't undo" : "Couldn't go back",
        ...(stale ? { detail: "Showing the latest version now." } : error instanceof Error ? { detail: error.message } : {}),
      });
      if (stale) void onChanged().catch(() => {});
    } finally {
      setUndoing(false);
    }
  }

  // The toolbar's two buttons call the same route; the shortcut says why when the one it means is off.
  function stepRevision(direction: "undo" | "redo") {
    const allowed = direction === "undo" ? revision.origin !== "undo" && revision.undoable : revision.origin === "undo" && revision.undoable;
    if (undoing) return;
    if (undoBlock !== null) {
      toasts.show({ kind: "info", message: undoBlock });
      return;
    }
    if (!allowed) {
      toasts.show({ kind: "info", message: direction === "undo" ? "Nothing to undo" : "Nothing to redo" });
      return;
    }
    void undo();
  }

  // The one place a stored layout's Oryx code is read into the model, and only on the button (D-193).
  async function upgradeNow() {
    const out = await upgradeStoredLayout(token, layoutRef);
    await onChanged();
    toasts.show({ kind: out.changed ? "success" : "info", message: out.changed ? "Updated" : "Nothing to update", detail: out.message });
  }
  const offer = detail.upgrade === null || detail.upgrade === undefined ? null : <UpgradeOffer offer={detail.upgrade} onUpgrade={upgradeNow} />;

  async function onTuned(summaryText: string) {
    await onChanged();
    toasts.show({ kind: "success", message: "Applied", detail: summaryText });
  }

  if (layer === undefined) return null;
  // The sheet's height is also the room the board keeps below it, so a key opened under it can be scrolled up (18#phones).
  const workbenchStyle = { "--sheet-h": `${sheetHeight(sheet, viewportHeight)}px` } as CSSProperties;
  const chips = chatSelection?.positions.length ?? 0;

  return (
    <div className="workspace">
      <Toolbar
        tabs={
          <LayerTabs
            layout={layout}
            selectedId={layer.id}
            onSelect={chooseLayer}
            marked={markedLayers}
            {...(layerActions === undefined ? {} : { actions: layerActions })}
            renamingId={renamingId}
            onRenaming={setRenamingId}
          />
        }
        revision={revision}
        busy={undoing}
        blockedReason={undoBlock}
        onUndo={() => void undo()}
        historyOpen={historyOpen}
        onHistory={() => {
          setLibraryOpen(false);
          setSettingsOpen(false);
          setHistoryOpen((open) => !open);
        }}
        libraryOpen={libraryOpen}
        onLibrary={() => {
          setHistoryOpen(false);
          setSettingsOpen(false);
          setLibraryKeys(null);
          setLibraryOpen((open) => !open);
        }}
        settingsOpen={settingsOpen}
        onSettings={() => {
          setHistoryOpen(false);
          setLibraryOpen(false);
          setSettingsOpen((open) => !open);
        }}
        combosShown={showCombos}
        onCombos={toggleCombos}
        onShortcuts={() => setShortcutsOpen(true)}
        advanced={advanced}
        onAdvanced={(value) => {
          setAdvanced(value);
          writeStored(ADVANCED_KEY, value ? "1" : "0");
        }}
      />
      <div className="workbench" data-sheet={narrow && mode !== "summary" ? sheet : undefined} style={workbenchStyle}>
        <section className="stage" aria-label="Layout" data-placing={placing !== null}>
          {shownHalf === null ? null : <HalfSwitcher value={half} onChange={setHalf} hands={board.hands} />}
          <FirstRunTip />
          <SelectionBar
            count={chatSelection?.positions.length ?? 0}
            layerName={chatSelection === null ? layer.name : layerNameOf(chatSelection.layerId)}
            selectMode={selectMode}
            onSelectMode={setSelectMode}
            onClear={() => setChatSelection(null)}
            onCombo={makeCombo}
            copied={clipboard === null ? null : bindingSummary(clipboard.binding, layout)}
            onPaste={() => void paste()}
            quick={quick === null ? null : { labels: quick.map((code) => functionName(`key:${code}`, layout)), total: quickTargets.length }}
            onQuickStart={startQuick}
            onQuickApply={() => void applyQuick()}
            onQuickCancel={() => setQuick(null)}
            busy={changing}
          />
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
            highlighted={libraryHighlight}
            marks={marks}
            remembered={remembered}
            arrows={arrows}
            legendOverrides={legendOverrides}
            layerColors={layerColors}
            ledColors={ledColors}
            onSelect={select}
            onHover={setHovered}
            onPress={press}
            half={shownHalf}
            onSwipe={(direction) => setHalf(direction === "left" ? "right" : "left")}
            comboLines={comboLines}
            comboHovered={hoverCombo}
            comboLit={comboLit}
            onComboHover={setHoverCombo}
            onComboOpen={openCombo}
            dragEnabled={placing === null && swapping === null && !comboPicking && quick === null && !chatOpen && !changing}
            onDropKey={(from, to, copy) => void dropKey(from, to, copy)}
          />
          <div className="stage-notes">
            {preview !== null && proposal !== null ? (
              <PreviewBanner
                title={proposal.title}
                layerName={layerName(layout, preview.layerId)}
                onStop={pinnedProposal !== null && hoveredProposal === null ? () => setPinnedProposal(null) : undefined}
              />
            ) : null}
            {swapping === null || layer === undefined ? null : (
              <p className="place-banner" role="status">
                <MousePointerClick size={16} aria-hidden="true" />
                <span>Click the key to swap with key {swapping.position + 1} on {layerNameOf(swapping.layerId)}. You can change layer first. Escape cancels.</span>
                <button type="button" className="button" onClick={() => setSwapping(null)}>Cancel</button>
              </p>
            )}
            {comboPicking ? (
              <p className="place-banner" role="status">
                <MousePointerClick size={16} aria-hidden="true" />
                <span>Click keys to add or remove them from the combo. Escape stops.</span>
                <button type="button" className="button" onClick={() => setComboPicking(false)}>Done</button>
              </p>
            ) : null}
            {placing === null ? null : (
              <p className="place-banner" role="status">
                <MousePointerClick size={16} aria-hidden="true" />
                <span>Click the key that should get {functionName(placing.function, layout)}. Escape cancels.</span>
                <button type="button" className="button" onClick={() => setPlacing(null)}>Cancel</button>
              </p>
            )}
          </div>
          <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} />
        </section>
        <SidePanel
          mode={mode}
          size={sheet}
          viewportHeight={viewportHeight}
          onSize={setSheet}
          settings={
            settingsOpen ? (
              <SettingsPane
                key={revision.id}
                token={token}
                layoutRef={layoutRef}
                layout={layout}
                board={board}
                revisionId={revision.id}
                advanced={advanced}
                lighting={lightingDraft}
                onLighting={(id, next) =>
                  setLightingDraft((previous) => {
                    const map = new Map(previous);
                    if (next === undefined) map.delete(id);
                    else map.set(id, next);
                    return map;
                  })
                }
                currentLayerId={layer.id}
                onShowLayer={chooseLayer}
                offer={detail.upgrade?.colours === true ? offer : null}
                onClose={() => setSettingsOpen(false)}
                onApplied={async (summaryText) => {
                  await onChanged();
                  setLightingDraft(new Map());
                  toasts.show({ kind: "success", message: "Applied", detail: summaryText });
                }}
                onStale={onStale}
              />
            ) : null
          }
          library={
            libraryOpen ? (
              <LibraryPane
                layout={layout}
                layerId={layer.id}
                onHighlight={setLibraryKeys}
                onOpenKey={(slot) => {
                  setLibraryKeys(null);
                  setLayerId(slot.layerId);
                  openEditor(slot.position, slot.layerId);
                }}
                onClose={() => {
                  setLibraryKeys(null);
                  setLibraryOpen(false);
                }}
              />
            ) : null
          }
          history={
            historyOpen ? (
              <HistoryPanel
                revisions={history.revisions}
                onClose={() => setHistoryOpen(false)}
                onReload={history.reload}
                onGoBack={(target) => undo(target)}
                onFlash={(target) => onOpenRelease({ id: target.id, summary: target.summary })}
                blockedReason={undoBlock}
              />
            ) : null
          }
          combo={
            comboDraft !== null ? (
              <ComboEditor
                key={`${revision.id}:${comboDraft.id}`}
                token={token}
                layoutRef={layoutRef}
                revisionId={revision.id}
                layout={layout}
                layerId={layer.id}
                draft={comboDraft}
                onDraft={setComboDraft}
                picking={comboPicking}
                onPicking={setComboPicking}
                onBack={() => {
                  setComboDraft(null);
                  setComboPicking(false);
                }}
                onApplied={async (summaryText) => {
                  await onChanged();
                  setComboDraft(null);
                  setComboPicking(false);
                  toasts.show({ kind: "success", message: "Applied", detail: summaryText });
                }}
                onStale={onStale}
              />
            ) : combosOpen ? (
              <ComboList layout={layout} onOpen={(combo) => openCombo(combo.id)} onHover={setHoverCombo} onClose={() => { setCombosOpen(false); setHoverCombo(null); }} />
            ) : null
          }
          summary={<LayoutSummary summary={summary} layout={layout} board={board} revision={revision} offer={offer} />}
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
                footerExtra={
                  <>
                  <KeyMoves
                    swapping={swapping !== null}
                    onSwap={() => setSwapping((current) => (current === null ? { layerId: editing.layerId, position: editing.position } : null))}
                    onCopy={() => copyKey({ layerId: editing.layerId, position: editing.position })}
                    copied={clipboard === null ? null : bindingSummary(clipboard.binding, layout)}
                    pasteTargets={Math.max(1, chatSelection?.positions.length ?? 0)}
                    onPaste={() => void paste()}
                    blockedReason={draft.dirty ? "Apply or reset this key first" : null}
                  />
                  {detail.upgrade?.tapDances !== true || !/^TD\(/.test(editedNativeSource(layout, editing)) ? null : offer}
                  {board.lighting === undefined ? null : (
                    <KeyColour
                      layer={layout.layers.find((candidate) => candidate.id === editing.layerId) ?? layer}
                      position={editing.position}
                      busy={changing}
                      onPick={(colour) => {
                        const target = layout.layers.find((candidate) => candidate.id === editing.layerId);
                        if (target === undefined) return;
                        const lighting: LayerLighting = withKeyColour(target.lighting, editing.position, colour);
                        void perform([{ op: "setLayerLighting", layerId: target.id, lighting }], `${target.name}, key ${editing.position + 1}: ${colour === null ? "follows the layer colour" : "own colour"}`);
                      }}
                    />
                  )}
                  </>
                }
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
      <Shortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {pendingDrop === null ? null : (
        <DropConfirm
          summary={pendingDrop.summary}
          names={pendingDrop.lost.map((fn) => functionName(fn, layout))}
          onCancel={() => setPendingDrop(null)}
          onConfirm={() => {
            const { ops, summary: summaryText, lost, reason } = pendingDrop;
            setPendingDrop(null);
            void perform([...ops, ...dropOps(lost, reason)], summaryText);
          }}
        />
      )}
    </div>
  );
}
