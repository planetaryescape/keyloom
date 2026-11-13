import { Eye, MousePointerClick, RefreshCw, Repeat2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AgentView, ViewResult } from "../api/open-view.ts";
import type { OpenRequestedView } from "./chat/useChat.ts";
import { isOnePiece } from "../boards/one-piece.ts";
import type { GeometryKey } from "../boards/schema.ts";
import type { Binding, Layout } from "../layout/schema.ts";
import type { ChangeOp, Slot } from "../layout/change.ts";
import { addLayerChange, convertLayerOps, duplicateLayerChange, moveLayerOps, niceLayerName } from "../layout/layer-ops.ts";
import { bindingLegend } from "../layout/legend.ts";
import type { ApplyResponse, BoardChoice, ChatPresentation, ChatSelection, LayoutDetail, LayoutSummary as Summary, ProposalCard } from "../api/http.ts";
import { describeKey } from "../layout/describe.ts";
import { ApiError } from "./api.ts";
import { RestartDialog } from "./shell/RestartDialog.tsx";
import { RestartKeyloom } from "./shell/RestartKeyloom.tsx";
import { type PageFailure, unexpectedWayOut, wayOutFor } from "./shell/unexpected.ts";
import { type UnexpectedDialog, failedToast as failedToastInput } from "./shell/failed-toast.ts";
import { request, undoChange, upgradeStoredLayout } from "./api-write.ts";
import { CollectionKeyboardSchema } from "../api/keyboards.ts";
import { useBarFit } from "./chat/bar-fit.ts";
import { ViewControls } from "./shell/ViewControls.tsx";
import { useLab } from "./lab/useLab.ts";
import { applyChangeSet } from "./api-write.ts";
import { LabPanel, LabStage } from "./lab/LabScreens.tsx";
import { matchCommands, type Command } from "./chat/commands.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { ChatStopButton } from "./chat/Composer.tsx";
import { sidebarAfterUpdate, type Sidebar } from "./shell/sidebars.ts";
import { useNewKeyboard } from "./keyboards/useNewKeyboard.ts";
import { NewKeyboardCard } from "./keyboards/NewKeyboardCard.tsx";
import { SetupCard } from "./keyboards/SetupCard.tsx";
import { NewBoardPanel, type PutSource } from "./keyboards/NewBoardPanel.tsx";
import { NewBoardKeyboard, newBoardHalf } from "./keyboards/NewBoardKeyboard.tsx";
import { OpenProposals } from "./keyboards/OpenProposals.tsx";
import { useReview } from "./review/useReview.ts";
import { ReviewMarker, ReviewPanel, reviewTextWords } from "./review/ReviewPanel.tsx";
import { APPLIED_NOT_SHOWN } from "./review/review-words.ts";
import { readAfterApply, readIfChanged } from "./editor/read-after-apply.ts";
import { NOT_SHOWN_LINE, notShownLine } from "./editor/not-shown.ts";
import { LATEST_NOT_SHOWN, STALE_CHECK, STALE_EDIT, STALE_UNDO } from "./editor/stale-edit-words.ts";
import { fetchOpenProposals } from "./keyboards/api-keyboards.ts";
import type { CarriedThread } from "./chat/CarriedThread.tsx";
import { withoutRepeats } from "./chat/transcript.ts";
import type { Turn } from "./chat/transcript.ts";
import { formatFindingRepairRequest, type FindingRepairDraft } from "../api/review.ts";
import { formatProposalRecoveryRequest, type RecoveryContext, type RecoverySource } from "../validation/proposal-recovery.ts";
import { proposalContext } from "./chat/recovery-context.ts";
import { PreviewBanner } from "./chat/PreviewBanner.tsx";
import { findingRepairState } from "./chat/repair-words.ts";
import { layerName } from "./chat/proposal-facts.ts";
import { marksOn, otherMarkedLayers, previewProposal, rememberedOn } from "./chat/preview.ts";
import { Reminders } from "./decisions/Reminders.tsx";
import { HistoryPanel, type Milestone } from "./history/HistoryPanel.tsx";
import { useVersions } from "./history/useVersions.ts";
import { VersionCompare, type Comparing, compareFailure } from "./history/VersionCompare.tsx";
import { versionTitle } from "./history/version-words.ts";
import { archiveConfig, compareVersion, createConfig, deleteConfig, nameVersion, renameConfig, restoreConfig, restoreVersion, syncConfig, useConfig } from "./configs/api-configs.ts";
import { ConfigMenu } from "./configs/ConfigMenu.tsx";
import { ConfirmDialog, DeleteConfigDialog, NewConfigDialog, RenameDialog } from "./configs/ConfigDialogs.tsx";
import { leaveToast, takeToast } from "./shell/toast-flash.ts";
import { EditingStatus } from "./configs/EditingStatus.tsx";
import { useConfigs } from "./configs/useConfigs.ts";
import { autoOpenTarget } from "./configs/agent-made-configs.ts";
import { useMadeConfigRefresh } from "./configs/useMadeConfigRefresh.ts";
import { ComboEditor, ComboList, comboDraftWaits, draftFromCombo, openComboFromElsewhere, type ComboDraft } from "./combos/ComboPane.tsx";
import { combosOn, newComboId } from "./combos/combo-ops.ts";
import { bindingSummary, withBinding, type Draft } from "./editor/draft.ts";
import { draftsForChat, draftsOn, park, slotKey, stillApplying, unpark, type ParkedDrafts } from "./editor/parked-drafts.ts";
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
import { tonesOf, useColourway } from "./keyboard/colourway.ts";
import { LayerTabs, type LayerActions } from "./keyboard/LayerTabs.tsx";
import { deleteLayerOps } from "./layers/conditional-ops.ts";
import { SelectionBar } from "./keyboard/SelectionBar.tsx";
import { layerLight, reachedLayer, reachKey } from "./light/layer-light.ts";
import { extendSelection } from "./keyboard/selection.ts";
import { KEY_MOVES_BLOCKED, KeyMoves, keyMovesNote } from "./panel/KeyMoves.tsx";
import { LibraryPane } from "./panel/LibraryPane.tsx";
import { UpgradeOffer } from "./settings/UpgradeOffer.tsx";
import { KeyColour } from "./settings/KeyColour.tsx";
import { type Place, onOpenPlace } from "./shell/open-place.ts";
import { SettingsPane } from "./settings/SettingsPane.tsx";
import { type LightingDraft, withKeyColour, withLighting } from "./settings/lighting-ops.ts";
import { colourAt, hsvToHex, isDark } from "../layout/colour.ts";
import type { LayerLighting } from "../layout/schema.ts";
import { KeyPanel, type DraftState, type KeyPanelHandle, type PlaceRequest } from "./panel/KeyPanel.tsx";
import { FloatingCard, type BoardLayout } from "./card/FloatingCard.tsx";
import { keyForChar } from "./panel/slots.ts";
import { Caption } from "./shell/Caption.tsx";
import { boardDisplayName, boardEntries } from "./shell/Header.tsx";
import { TopBar } from "./shell/TopBar.tsx";
import { boardLight, openKeyboardStatus, ReplaceForeignHost, SyncStatus } from "./sync/SyncStatus.tsx";
import type { ReleaseStatus } from "./release/status.ts";
import { AfterApplyContext, type AfterApplyKeyboard, afterApplyRun } from "./release/AfterApply.tsx";
import { afterApply } from "./release/flash-words.ts";
import { reachWords } from "./light/reach-words.ts";
import { HalfSwitcher, type Half } from "./shell/HalfSwitcher.tsx";
import { sheetHeight, type SheetSize } from "./shell/sheet.ts";
import { Shortcuts } from "./shell/Shortcuts.tsx";
import { SidePanel, type PanelMode } from "./shell/SidePanel.tsx";
import { readStored, writeStored } from "./shell/storage.ts";
import { Toasts, useToasts } from "./shell/Toasts.tsx";
import { NARROW, PHONE, useMediaQuery } from "./shell/useMediaQuery.ts";
import type { SyncApi } from "./sync/useSync.ts";
import { type RefusalHandlers, refusalProblem, useSyncToasts } from "./sync/useSyncToasts.ts";
import { keyIn, keyOn } from "../validation/words.ts";

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
  /** `failedBuildId`: a sync's failed build, which the dialog opens on (R8-01). */
  onOpenRelease: (revision?: { id: string; summary: string }, failedBuildId?: string) => void;
  repairDraft: FindingRepairDraft | null;
  onRepairDraft: (id: string, draft: FindingRepairDraft | null, replace?: boolean) => void;
  /** "Ask keyloom about this build" from Build and flash (R5-02): a new one opens the chat with the question in it to check and send. */
  buildQuestion?: { id: string; buildId: string; request: string } | null;
  /** The keyboard's sync state, for the sync line and the toasts that say a change reached it or didn't. */
  sync: SyncApi;
  /** What the top bar needs from the page around the layout: the layouts and boards to switch between, and Build and flash. */
  chrome: {
    onManageKeyboards?: (() => void) | undefined;
    onAddKeyboard?: (() => void) | undefined;
    layouts: readonly Summary[];
    selectedId: string;
    onSelect: (id: string) => void;
    onHome?: (() => void) | undefined;
    /** `boardId`: show only that board's card, for that board's setup (R7-13). */
    onImport: (boardId?: string | null) => void;
    /** What a switch carries to the next layout (D-317): the layer by name, and the chat if it was open. */
    arrival?: Arrival | null;
    /** Opens another layout with what the switch carries; without it, a switch is a plain `onSelect`. */
    onCarry?: (id: string, carry: Arrival) => void;
    /** Fetches the layout list again after a config is made, renamed or restored; with an ID, opens that config. */
    onReload?: (selectId?: string) => void;
    boardChoices: readonly BoardChoice[];
    /** Absent for a board that is never built or flashed (the MacBook keyboard). */
    release?: { status: ReleaseStatus; onOpen: () => void };
  };
}

/** What a board or config switch carries to the next layout (D-317). */
export type Arrival = { layerName: string | null; chatOpen: boolean; thread: CarriedThread | null; /** Open the config's waiting proposals (D-336). */ proposals?: boolean; review?: boolean; conversationId?: string; continueCopy?: boolean; /** Open the keyboard's status popover. */ status?: boolean };

// `resume` is a draft kept from an earlier visit to this key (D-317); the card opens on it.
type Editing = { layerId: string; position: number; focus: boolean; resume?: Draft };
const CLEAN: DraftState = { binding: null, dirty: false, after: null };
const NONE: ReadonlySet<number> = new Set();
const ADVANCED_KEY = "keyloom.advanced";
const INSPECT_KEY = "keyloom.inspect";
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
export function Viewer({ detail, summary, keys, token, layoutRef, onChanged, onOpenRelease, repairDraft, onRepairDraft, buildQuestion = null, sync, chrome }: ViewerProps) {
  const [repairNotice, setRepairNotice] = useState<string | null>(null);
  const planRecovery = (source: RecoverySource, context: RecoveryContext) => {
    if (repairDraft) { setRepairNotice("Finish or dismiss the existing repair request first. It has been kept."); return; }
    const id = crypto.randomUUID();
    onRepairDraft(id, { id, source, context, headRevisionId: detail.revision.id, request: formatProposalRecoveryRequest(context), sent: false }, true);
    setProposalsOpen(false);
    setChatOpen(true);
  };
  const { document: layout, board, geometry, revision } = detail;
  // The revision on screen when a read after a write failed (R7-06): the editor marks it until a read works.
  const [notShownOn, setNotShownOn] = useState<string | null>(null);
  // Each question asked from Build and flash once (R5-02): into the chat as a request to check and send, unless one is already waiting there.
  const askedBuild = useRef<string | null>(null);
  useEffect(() => {
    if (buildQuestion === null || askedBuild.current === buildQuestion.id) return;
    askedBuild.current = buildQuestion.id;
    if (repairDraft) setRepairNotice("Finish or dismiss the existing request first. It has been kept; ask about the build again after.");
    else onRepairDraft(buildQuestion.id, { id: buildQuestion.id, buildId: buildQuestion.buildId, headRevisionId: detail.revision.id, request: buildQuestion.request, sent: false }, true);
    setChatOpen(true);
    // Once per question; the draft and the setters are read as they are when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildQuestion?.id]);
  // Arriving from another board or config lands on the layer of the same name, if this layout has one (D-317).
  const [layerId, setLayerId] = useState<string | null>(() => {
    const name = chrome.arrival?.layerName?.trim().toLowerCase();
    return name === undefined ? null : (detail.document.layers.find((candidate) => candidate.name.trim().toLowerCase() === name)?.id ?? null);
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<DraftState>(CLEAN);
  // Drafts kept when their card closed (D-317): on the board as dashed amber until applied or discarded.
  const [parked, setParked] = useState<ParkedDrafts>(new Map());
  const [blocked, setBlocked] = useState(false);
  // Place mode (D-092): a lost function waiting for the next key clicked on the board, and the keys already chosen.
  const [placing, setPlacing] = useState<PlaceRequest | null>(null);
  const [placements, setPlacements] = useState<readonly Placement[]>([]);
  const toasts = useToasts();
  // A refused sync's toast offers the fix (R1-16); each handler is the same one the page's own control uses.
  // The status popover hangs off the sync pill. A config that isn't on the keyboard shows EditingStatus in its place (D-315), so there it
  // opens on the keyboard's config, which opens the popover when it arrives.
  const openStatus = () => {
    if (editingOther && keyboardConfig !== null) switchLayout(keyboardConfig.id, { status: true });
    else openKeyboardStatus();
  };
  useEffect(() => {
    if (chrome.arrival?.status !== true) return;
    const frame = requestAnimationFrame(openKeyboardStatus);
    return () => cancelAnimationFrame(frame);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A Sync now waiting for a build or flash belongs to this page: the sync hook outlives it, so leaving stops the wait.
  const stopWaiting = useRef(sync.stopWaiting);
  stopWaiting.current = sync.stopWaiting;
  useEffect(() => () => stopWaiting.current(), []);
  const refusalHandlers: RefusalHandlers = {
    open_status: openStatus,
    restore: () => void restoreArchived(summary.id),
    put_on: () => setConfigDialog({ kind: "put-on", target: { id: summary.id, name: summary.name } }),
    open_release: (buildId?: string) => onOpenRelease(undefined, buildId),
    replace_foreign: () => sync.setReplaceAsk(summary.id),
    // The exit chord is kanata's, and the MacBook is the one board that runs it.
    check_exit_chord: () => {
      const remapper = sync.boards.find((b) => b.remapper === true);
      if (remapper !== undefined) void sync.confirmExitChord(remapper.boardId);
    },
    // The same restore as Your keyboards' Restore button, for the board on screen, which the refused sync was for.
    restore_keyboard: () => {
      request("POST", "/api/keyboards/restore", token, CollectionKeyboardSchema, undefined, { board: summary.boardId }).then(
        (restored) => {
          // Restore leaves syncing paused (D-476); the toast offers the resume itself (R3-19).
          toasts.show({
            kind: "success", message: `${restored.name} restored`, detail: "Syncing stays paused until you resume it.",
            action: { label: "Resume syncing", run: () => void sync.setPaused(summary.boardId, false) },
          });
          onChanged();
        },
        (error: unknown) => {
          const manage = chrome.onManageKeyboards;
          toasts.show({
            kind: "error", message: "keyloom couldn't restore the keyboard", detail: error instanceof Error ? error.message : "Your keyboards can restore it too.",
            ...(manage === undefined ? {} : { action: { label: "Open Your keyboards", run: manage } }),
          });
        },
      );
    },
  };
  // A toast about another keyboard, or another config of this one, opens that page, where its fix is, not this layout's Build and flash.
  useSyncToasts(sync, toasts.show, refusalHandlers, { boardId: summary.boardId, layoutId: summary.id, openBoard, openConfig: (id) => switchLayout(id) });
  // A refused put-on says why in its dialog, with the same fix as the toast (R3-01). Restore and Replace it act on the config being put on.
  // Build and flash here builds this layout, so a put-on of another config opens that config, whose Build and flash builds it.
  const putOnProblem = (target: { id: string; name: string }) => (error: unknown) => {
    if (!(error instanceof ApiError)) return null;
    const handlers: RefusalHandlers = { ...refusalHandlers, restore: () => void restoreArchived(target.id), replace_foreign: () => sync.setReplaceAsk(target.id) };
    if (target.id === summary.id) return refusalProblem(error, handlers);
    delete handlers.open_release;
    return refusalProblem(error, handlers, (action) => (action === "open_release" ? { name: target.name, open: () => switchLayout(target.id) } : undefined));
  };
  // Keys applied from the bar since the keyboard last had this layout. They keep an amber dot until the sync line says the keyboard has
  // them (D-263, P3 review); an undo clears them, since what changed is no longer what is waiting.
  const [unsynced, setUnsynced] = useState<{ layerId: string; position: number }[]>([]);
  const boardSync = sync.boards.find((b) => b.boardId === summary.boardId);
  // The line a proposal card shows after Apply depends on this keyboard (R2-01): kanata applies it, auto-sync flashes it, or Build and flash does.
  const afterApplyKeyboard: AfterApplyKeyboard = {
    board: { firmware: board.firmware, name: boardDisplayName(board.name) }, layoutId: summary.id, revisionId: revision.id, sync: boardSync,
    onApplyNow: () => void sync.syncNow(summary.id),
    onPutOn: () => setConfigDialog({ kind: "put-on", target: { id: summary.id, name: summary.name } }),
    onOpenStatus: openStatus,
    onReplaceForeign: () => sync.setReplaceAsk(summary.id),
  };
  const synced = boardSync !== undefined && boardSync.layoutId === summary.id && boardSync.state.kind === "in_sync";
  useEffect(() => {
    if (synced) setUnsynced([]);
  }, [synced]);
  useEffect(() => setUnsynced([]), [summary.id]);
  // The keys an apply just changed, pressed together (D-268); a proposal can change several on one layer.
  const [applied, setAppliedKeys] = useState<{ layerId: string; positions: number[] } | null>(null);
  const setApplied = (slot: { layerId: string; position: number } | null) => setAppliedKeys(slot === null ? null : { layerId: slot.layerId, positions: [slot.position] });
  const [undoing, setUndoing] = useState(false);
  // The chat drawer. Open, a click on a key adds it to the "Asking about" chips; closed, it opens the key's panel (D-099).
  // The chat stays open across a switch, with the thread that was on screen carried above this layout's own (D-317).
  const [sidebar, setSidebar] = useState<Sidebar | null>(() => chrome.arrival?.review === true ? "review" : chrome.arrival?.proposals === true ? "proposals" : chrome.arrival?.chatOpen === true ? "chat" : null);
  const chatOpen = sidebar === "chat";
  const setChatOpen = sidebarSetter("chat");
  const [chatActivity, setChatActivity] = useState<{ stop: () => void } | null>(null);
  const [carriedThread, setCarriedThread] = useState<CarriedThread | null>(() => chrome.arrival?.thread ?? null);
  const turnsNow = useRef<readonly Turn[]>([]);
  // Where the open conversation reads (D-310): the bar at the stage's foot, or the panel beside the board.
  const [chatPresentation, setChatPresentation] = useState<"bar" | "panel">("bar");
  // The keys in the chips, on one layer, and the proposal being previewed (hovered or pinned).
  const [chatSelection, setChatSelection] = useState<ChatSelection | null>(null);
  const [hoveredProposal, setHoveredProposal] = useState<ProposalCard | null>(null);
  const [pinnedProposal, setPinnedProposal] = useState<ProposalCard | null>(null);
  // The editor's last applied change, and whether the panel that repeats it on the chips' keys is open.
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
  const repeating = sidebar === "repeat";
  const setRepeating = sidebarSetter("repeat");
  // The keys of the decision being pointed at in the decisions list.
  const [decisionFocus, setDecisionFocus] = useState<Slot[] | null>(null);
  const [advanced, setAdvanced] = useState(() => readStored(ADVANCED_KEY) === "1");
  const [colourway, setColourway] = useColourway(board.id, board.display?.colourways);
  // Inspect shows what calm hides: kinds, what transparent keys pass through to, and combos (D-264).
  const [inspect, setInspect] = useState(() => readStored(INSPECT_KEY) === "1");
  // Combos drawn as lines, the combos list, and the combo being made or edited (16#combos-are-made-from-a-selection).
  const [showCombos, setShowCombos] = useState(() => readStored(SHOW_COMBOS_KEY) === "1");
  const combosOpen = sidebar === "combos";
  const setCombosOpen = sidebarSetter("combos");
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
  // A board change that hit a failure no screen planned for, opened from its toast's Restart keyloom (R8-03).
  const [unexpected, setUnexpected] = useState<(Omit<UnexpectedDialog, "title"> & { title?: string }) | null>(null);
  // Update layout that keyloom's check turned down, for the revision it was asked on (R9-09).
  const [upgradeRefusal, setUpgradeRefusal] = useState<{ revisionId: string; hidden: boolean } | null>(null);
  const [changing, setChanging] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const keyboard = useRef<KeyboardHandle>(null);
  const stageRef = useRef<HTMLElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  // How the board moves for the key card: its halves part when the card would cover a key, and it slides only if that can't fit (P2).
  const [boardLayout, setBoardLayout] = useState<BoardLayout>({ shift: 0, part: null, scale: 1 });
  // A key another key's card points at ("Also on Colemak"), lit on the board while pointed at.
  const [pointAt, setPointAt] = useState<Slot | null>(null);
  // With no card open the halves come back together, however the card was closed.
  useEffect(() => {
    if (editing === null && comboDraft === null) setBoardLayout((now) => (now.shift === 0 && now.part === null && now.scale === 1 ? now : { shift: 0, part: null, scale: 1 }));
  }, [editing, comboDraft]);
  const panel = useRef<KeyPanelHandle>(null);
  // History is a panel of its own; it stays chosen while a key or the chat is looked at, and comes back when they close.
  const historyOpen = sidebar === "history";
  const setHistoryOpen = sidebarSetter("history");
  // The library pane works the same way, and the keys on the board it points at (a hovered row's users). It shares the column with History, so one closes the other.
  const libraryOpen = sidebar === "library";
  const setLibraryOpen = sidebarSetter("library");
  const [libraryKeys, setLibraryKeys] = useState<readonly number[] | null>(null);
  // The settings page shares the column with History and the library. Its staged layer colours are drawn on the board before they are applied (D-190).
  const settingsOpen = sidebar === "settings";
  const setSettingsOpen = sidebarSetter("settings");
  // The typing lab (D-314): over the stage while choosing and listening, beside the board for the read-out.
  const labOpen = sidebar === "lab";
  const setLabOpen = sidebarSetter("lab");
  const lab = useLab(token, layoutRef, labOpen);
  const [labHeat, setLabHeat] = useState<"speed" | "errors">("speed");
  const [labLit, setLabLit] = useState<ReadonlySet<number>>(new Set());
  const [lightingDraft, setLightingDraft] = useState<LightingDraft>(new Map());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Configs (D-315): this board's, which one the keyboard runs, and whether the one on screen is it.
  const configs = useConfigs(token, summary.boardId, `${summary.id}:${summary.name}:${revision.id}`);
  const keyboardConfig = boardSync === undefined
    ? (configs.live.find((c) => c.onKeyboard) ?? null)
    : { id: boardSync.layoutId, name: boardSync.layoutName };
  const editingOther = keyboardConfig !== null && keyboardConfig.id !== summary.id;
  const [configDialog, setConfigDialog] = useState<
    { kind: "new"; start?: "version"; version?: string } | { kind: "rename" } | { kind: "put-on"; target: { id: string; name: string } } | { kind: "put-version"; milestone: Milestone } | { kind: "delete"; config: { id: string; name: string } } | null
  >(null);
  // History as versions; a finished sync records one, so the list follows the keyboard's last run as well as the head.
  const history = useVersions(token, layoutRef, `${revision.id}:${boardSync?.last?.id ?? ""}:${boardSync?.state.kind ?? ""}`, historyOpen);
  const [comparing, setComparing] = useState<Comparing | null>(null);
  useEffect(() => {
    if (!historyOpen) setComparing(null);
  }, [historyOpen]);
  // Phones: the panel is a bottom sheet and a split board shows one hand (18#phones).
  const narrow = useMediaQuery(NARROW);
  const chatPanel = !narrow && chatOpen && chatPresentation === "panel";
  // A key opened while the conversation is in the panel takes the panel's place; closing it brings the conversation back (D-310).
  const keyOverChat = chatPanel && editing !== null;
  const barFit = useBarFit(stageRef, !narrow && chatOpen && !chatPanel, `${board.id}:${layoutRef}`);
  const phone = useMediaQuery(PHONE);
  const [sheet, setSheet] = useState<SheetSize>("half");
  const [half, setHalf] = useState<Half>("left");
  const viewportHeight = useViewportHeight();
  // A one-piece board (a 60%, a laptop) stays whole on a phone, scrolling sideways when its keys would be too small to fit: its drawn
  // case can't be cut between the hands, and half of it isn't a board anyone has (D-351).
  const splitBoard = !isOnePiece(board, keys);
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
  // The lab's marks on the board: the keys just typed, the findings' keys (the open one's, else all), and a heat per key from its
  // finger's speed or errors (D-314).
  const labPanelShown = labOpen && lab.phase.kind === "readout" && !narrow;
  // A new keyboard (D-336): the card over the stage, then its board on the stage and its questions in the column beside it.
  const newBoard = useNewKeyboard(token, sync.newKeyboards, sync.setupBoards);
  const newBoardDrawn = (newBoard.step.kind === "confirm" || newBoard.step.kind === "review" || newBoard.step.kind === "put") && newBoard.preview?.board != null ? newBoard.preview.board : null;
  const newBoardShownHalf = newBoardHalf(phone, newBoardDrawn, undefined, half);
  const newBoardPanel = newBoard.step.kind === "confirm" || newBoard.step.kind === "review" || newBoard.step.kind === "put";
  const putSources = useMemo<PutSource[]>(() => {
    const target = newBoard.step.kind === "put" ? newBoard.step.boardId : null;
    const names = new Map(boardEntries(chrome.layouts, chrome.boardChoices).map((e) => [e.id, e.name]));
    const onKeyboard = new Set(sync.boards.map((b) => b.layoutId));
    return chrome.layouts
      // Archived and experiment configs are not a sensible thing to put on a new keyboard; the ones on a keyboard come first.
      .filter((l) => l.boardId !== target && (l.archivedAt ?? null) === null)
      .sort((a, b) => Number(onKeyboard.has(b.id)) - Number(onKeyboard.has(a.id)) || b.updatedAt - a.updatedAt)
      .map((l) => ({ id: l.id, name: l.name, boardName: names.get(l.boardId) ?? l.boardId, boardId: l.boardId, note: onKeyboard.has(l.id) ? "on it now" : null }));
  }, [chrome.layouts, chrome.boardChoices, sync.boards, newBoard.step]);
  // This config's proposals that no conversation shows, such as a put's (D-336); opened by itself when the put brought the page here.
  const proposalsOpen = sidebar === "proposals";
  const setProposalsOpen = sidebarSetter("proposals");
  const [waiting, setWaiting] = useState<ProposalCard[] | null>(null);
  // A read that failed is said, with Try again, never shown as "nothing is waiting" (R4-08); bumping `waitingRead` reads again.
  const [waitingFailed, setWaitingFailed] = useState(false);
  // The failed read's code: a read keyloom can't answer the same way again gets Restart keyloom, not Try again (R7-01).
  const [waitingCode, setWaitingCode] = useState<string | undefined>(undefined);
  const [waitingRead, setWaitingRead] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchOpenProposals(token, layoutRef, controller.signal).then((cards) => { setWaiting(cards); setWaitingFailed(false); }, (error: unknown) => {
      if (controller.signal.aborted) return;
      setWaiting([]);
      setWaitingFailed(true);
      setWaitingCode(error instanceof ApiError ? error.code : undefined);
    });
    return () => controller.abort();
  }, [token, layoutRef, revision.id, waitingRead]);
  // The board review (D-340): read without being asked, its marker by the config name, its marks on the caps and the strip.
  const boardReview = useReview(token, summary.id, revision.id, sync.lastReview);
  const reviewOpen = sidebar === "review";
  const setReviewOpen = sidebarSetter("review");
  const reviewShown = reviewOpen && !newBoardPanel && !labPanelShown;
  const reviewSuggestionIds = useMemo(
    () => new Set((boardReview.review?.items ?? []).flatMap((i) => (i.proposalId === null ? [] : [i.proposalId]))),
    [boardReview.review],
  );
  // The review's own suggestions are proposals too; the caption counts the others, so one change isn't announced twice.
  const waitingCount = waiting?.filter((p) => p.status === "proposed" && !reviewSuggestionIds.has(p.changeSetId)).length ?? 0;
  const proposalsShown = proposalsOpen && !newBoardPanel && !labPanelShown && !reviewShown;
  const reviewMarks = useMemo(() => {
    const unavailable = boardReview.refreshing || boardReview.stale || boardReview.review?.ai.status === "pending" || boardReview.review?.ai.status === "running";
    const items = (unavailable ? [] : boardReview.review?.items ?? []).filter((i) => i.dismissedAt === null);
    const on = (kind: "problem" | "hint") => new Set(items.filter((i) => i.kind === kind).flatMap((i) => i.keys.filter((k) => k.layerId === layer?.id).map((k) => k.position)));
    return { problems: on("problem"), hints: on("hint"), layers: new Set(items.filter((i) => i.kind === "problem").flatMap((i) => i.layers)) };
  }, [boardReview.review, boardReview.refreshing, boardReview.stale, layer?.id]);
  // The satisfaction beat (D-340): a review made after a change that cleared findings says so, once.
  const fixedToastFor = useRef<string | null>(null);
  useEffect(() => {
    const fixed = boardReview.justFixed;
    const id = boardReview.review?.id ?? null;
    if (fixed.length === 0 || id === null || fixedToastFor.current === id) return;
    fixedToastFor.current = id;
    const first = fixed[0] as (typeof fixed)[number];
    const plain = first.title.replace(/\{layer:([^{}:]+)\}/g, (_, l: string) => layerNameOf(l)).replace(/\{key:([^{}:]+):(\d+)\}/g, "the key");
    toasts.show({ kind: "success", message: "keyloom looked again", detail: fixed.length === 1 ? `Fixed: ${plain}` : `${fixed.length} things are fixed, ${plain} among them` });
    // layerNameOf follows the layout, which the review already waited for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardReview.justFixed, boardReview.review?.id]);
  // While listening, the top bar steps back too (D-314); it lives outside this component, so the root carries the state.
  useEffect(() => {
    if (labOpen && lab.phase.kind === "listening") document.documentElement.dataset.lab = "listening";
    else delete document.documentElement.dataset.lab;
    return () => {
      delete document.documentElement.dataset.lab;
    };
  }, [labOpen, lab.phase.kind]);
  const labBoard = useMemo(() => {
    const phase = lab.phase;
    if (phase.kind !== "readout") return { lit: labLit };
    const open = phase.readout.findings.find((f) => f.id === phase.open);
    const findings = new Set((open ? [open] : phase.readout.findings).flatMap((f) => f.positions));
    const rows = phase.readout.fingers;
    const value = (r: (typeof rows)[number]) => (labHeat === "speed" ? r.medianMs : r.keys === 0 ? 0 : r.errors / r.keys);
    const top = Math.max(...rows.map(value), 0.0001);
    const byFinger = new Map(rows.map((r) => [r.finger, value(r) / top]));
    const heat = new Map<number, number>();
    for (const [p, finger] of Object.entries(board.fingers)) {
      const h = byFinger.get(finger);
      if (h !== undefined && !finger.endsWith("thumb")) heat.set(Number(p), h);
    }
    return { lit: labLit, findings, heat };
  }, [lab.phase, labLit, labHeat, board.fingers]);
  const unsyncedHere = useMemo(() => new Set(unsynced.filter((slot) => slot.layerId === layer?.id).map((slot) => slot.position)), [unsynced, layer?.id]);

  // While a draft is complete the board shows it, so the key reads as it will once applied.
  const shown = useMemo(() => {
    const base = preview?.layout ?? layout;
    const open = (() => {
      if (editing === null || draft.binding === null) return base;
      // A change that brings a tap dance or a macro with it is drawn from the layout it makes.
      if (draft.after !== null) return draft.after;
      // The board shows both keys of the change: the edited one and every key a kept function was put on.
      return placements.reduce(
        (acc, placement) => withBinding(acc, placement.slot.layerId, placement.slot.position, placement.binding),
        withBinding(base, editing.layerId, editing.position, draft.binding),
      );
    })();
    // Kept drafts draw on their keys over that, so the board reads as it will once they are applied (D-317).
    let drawn = open;
    for (const entry of parked.values()) if (entry.binding !== null) drawn = withBinding(drawn, entry.slot.layerId, entry.slot.position, entry.binding);
    return drawn;
  }, [layout, preview, editing, draft.binding, draft.after, placements, parked]);
  // A kept draft is a change to the key as it was; once the key changes under it (an undo, the chat, a paste), it is dropped, and said.
  useEffect(() => {
    const { kept, dropped } = stillApplying(parked, layout);
    if (dropped.length === 0) return;
    setParked(kept);
    toasts.show({ kind: "info", message: dropped.length === 1 ? "A kept draft was dropped" : `${dropped.length} kept drafts were dropped`, detail: "Its key changed since, so the draft no longer applies." });
    // Only when the layout moves; parked changes are this effect's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
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
  // The layer's light, and the light of the layer each key reaches (D-263).
  const litLayers = useMemo(() => withLighting(view, lightingDraft).layers, [view, lightingDraft]);
  const light = useMemo(() => layerLight(litLayers, layerIndex, keys.length), [litLayers, layerIndex, keys.length]);
  const reach = useMemo(() => {
    const out = new Map<number, string | null>();
    (view.layers[layerIndex]?.bindings ?? []).forEach((binding, position) => {
      const target = reachedLayer(binding, view);
      const at = target === null ? -1 : litLayers.findIndex((candidate) => candidate.id === target);
      if (at >= 0) out.set(position, layerLight(litLayers, at, keys.length));
    });
    return out;
  }, [view, layerIndex, litLayers, keys.length]);
  // Every layer's light and LED colours, for the strip's lit miniatures.
  const layerLights = useMemo(() => litLayers.map((_, index) => layerLight(litLayers, index, keys.length)), [litLayers, keys.length]);
  const layerLeds = useMemo(
    () =>
      litLayers.map((candidate) =>
        board.lighting === undefined || candidate.lighting === undefined
          ? null
          : keys.map((_, position) => {
              const colour = colourAt(candidate, position);
              return isDark(colour) ? null : hsvToHex(colour);
            }),
      ),
    [litLayers, board.lighting, keys],
  );
  const thumbs = useMemo(() => new Set(Object.entries(board.fingers).flatMap(([p, finger]) => (finger.endsWith("thumb") ? [Number(p)] : []))), [board.fingers]);
  const rippleFrom = useMemo(() => reachKey(view, view.layers[layerIndex]?.id ?? "", thumbs), [view, layerIndex, thumbs]);
  // Compare with now (D-315): the keys on this layer that differ from the version, and what each printed then.
  const compareThen = useMemo(() => {
    if (comparing?.status !== "ready") return null;
    const here = comparing.compare.diff.keys.filter((k) => k.layerId === layer?.id);
    return here.length === 0 ? null : new Map(here.map((k) => [k.position, k.beforeLabel]));
  }, [comparing, layer]);
  const marks = useMemo(() => {
    const own = new Map(marksOn(preview, layer?.id ?? ""));
    // A kept draft is dashed amber: changed on screen, not applied (D-317). The open key's own draft keeps the solid mark.
    for (const position of draftsOn(parked, layer?.id ?? "")) if (!own.has(position)) own.set(position, "draft");
    if (compareThen !== null) {
      const withThen = new Map(own);
      for (const position of compareThen.keys()) withThen.set(position, "changed");
      return withThen;
    }
    if (placements.length === 0 && quick === null) return own;
    const withPlaced = new Map(own);
    for (const placement of placements) if (placement.slot.layerId === layer?.id) withPlaced.set(placement.slot.position, "home");
    quick?.forEach((_, i) => {
      const at = quickTargets[i];
      if (at !== undefined && at.layerId === layer?.id) withPlaced.set(at.position, "changed");
    });
    return withPlaced;
  }, [preview, layer, placements, quick, quickTargets, compareThen, parked]);
  const markedLayers = useMemo(() => otherMarkedLayers(preview, layer?.id ?? ""), [preview, layer]);
  const remembered = useMemo(() => rememberedOn(preview, decisionFocus, layer?.id ?? ""), [preview, decisionFocus, layer]);
  const reminders = preview !== null && proposal !== null ? proposal.validation.diff.reminders : [];
  const chatSelected = useMemo(
    () => (chatSelection !== null && chatSelection.layerId === layer?.id ? new Set(chatSelection.positions) : NONE),
    [chatSelection, layer],
  );

  const inspected = hovered ?? selected;

  function toggleInspect() {
    setInspect((on) => {
      writeStored(INSPECT_KEY, on ? "0" : "1");
      return !on;
    });
  }

  // A key pressed on the real keyboard lights on screen, so a key can be found by pressing it (23#journeys). Only plain typing keys:
  // digits switch layers and the rest are shortcuts.
  const [found, setFound] = useState<number | null>(null);
  useEffect(() => {
    if (found === null) return;
    const timer = window.setTimeout(() => setFound(null), 1400);
    return () => window.clearTimeout(timer);
  }, [found]);

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
      // A legend shortened for a cap ("⌘…") is spelled out in words for the combo's pill, which has the room (P1 review).
      const short = legend === null ? "…" : legend.hold === undefined ? legend.tap : `${legend.tap} ${legend.hold}`;
      // A macro's chip is what it presses, in the caps' glyphs ("⌘ C"), so a chip stays small enough to sit off the legends (D-311).
      const macro = output?.kind === "macro" ? layout.macros.find((m) => m.id === output.macroId) : undefined;
      const pressed = macro?.steps.flatMap((step) => (step.op === "tap" && step.code !== undefined ? [bindingLegend({ kind: "key", code: step.code, ...(step.mods === undefined ? {} : { mods: step.mods }) }, ctx).tap] : step.op === "text" ? [`“${step.text}”`] : []));
      const label = pressed !== undefined && pressed.length > 0 && pressed.length <= 3 ? pressed.join(" ") : output !== null && short.endsWith("…") ? bindingSummary(output, layout) : short;
      return {
        id, positions, label, editing,
        // Its keys by what they print, never their numbers (D-279).
        name: `${positions.map((position) => { const b = layer.bindings[position]; return b === undefined ? "a key" : bindingLegend(b, ctx).tap || "a blank key"; }).join(" and ")} together${output === null ? "" : `, send ${bindingSummary(output, layout)}`}`,
      };
    };
    // With the Combos sheet open, pointing at a row draws that one combo, as the Library lights its keys (P4 review).
    const shown = showCombos || inspect ? combosOn(layout, layer.id) : combosOpen && hoverCombo !== null ? combosOn(layout, layer.id).filter((combo) => combo.id === hoverCombo) : [];
    const lines = shown.filter((combo) => combo.id !== comboDraft?.id).map((combo) => lineFor(combo.id, combo.name, combo.positions, combo.output, false));
    if (comboDraft !== null && comboDraft.positions.length >= 2) lines.push(lineFor(comboDraft.id, comboDraft.name || "New combo", comboDraft.positions, comboDraft.output, true));
    return lines;
  }, [showCombos, inspect, layout, layer, comboDraft, combosOpen, hoverCombo]);
  // Pointing at a combo (its line, its label or its row) lights the keys it is made of.
  const comboLit = useMemo<ReadonlySet<number>>(() => {
    const positions = new Set<number>(comboDraft?.positions ?? []);
    const hovered = hoverCombo === null ? undefined : (hoverCombo === comboDraft?.id ? comboDraft : layout.combos.find((combo) => combo.id === hoverCombo));
    for (const position of hovered?.positions ?? []) positions.add(position);
    return positions;
  }, [comboDraft, hoverCombo, layout.combos]);

  // Each apply is a new object, so this counts applies even when the same key is applied twice in a row (D-268).
  const [pressSeq, setPressSeq] = useState(0);
  useEffect(() => {
    if (applied !== null) setPressSeq((count) => count + 1);
  }, [applied]);

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
  // Read when a toast's Try again runs, which can be long after the failure: a key opened since then blocks the step (PR #310 CodeRabbit).
  const undoBlockNow = useRef(undoBlock);
  undoBlockNow.current = undoBlock;
  const mode: PanelMode = chatOpen && !keyOverChat ? "chat" : editing !== null ? "key" : combosOpen ? "combo" : repeating ? "repeat" : historyOpen ? "history" : libraryOpen ? "library" : settingsOpen ? "settings" : "summary";
  const libraryHighlight = useMemo(() => {
    const keys = new Set(mode === "library" && libraryKeys !== null ? libraryKeys : []);
    if (pointAt !== null && pointAt.layerId === layer?.id) keys.add(pointAt.position);
    return keys.size === 0 ? NONE : keys;
  }, [mode, libraryKeys, pointAt, layer]);

  // Opening the chat puts the cursor in its box, so Cmd-K then typing is one gesture.
  useEffect(() => {
    if (!chatOpen) return;
    const frame = window.requestAnimationFrame(() => {
      // Desktop chat is in the command column; phones use #side-chat. Own both here.
      const input = workbenchRef.current?.querySelector<HTMLTextAreaElement>(".chat textarea");
      if (input?.checkVisibility()) input.focus({ preventScroll: true });
    });
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
  const change = useChange({ token, layoutRef, revisionId: revision.id, onChanged, onNotShown: showAppliedNotShown, onStale });

  // `onSuccess` is what the caller does once the change lands. It rides in the options, so the toast's Try again runs it too (PR #305 review).
  async function perform(ops: ChangeOp[], summary: string, options: { dropReason?: string; quiet?: boolean; onSuccess?: () => void } = {}): Promise<ChangeOutcome> {
    setChanging(true);
    const outcome = await change(ops, summary);
    setChanging(false);
    if (outcome.ok) {
      options.onSuccess?.();
      // A change that landed but couldn't be shown already has its toast, with Show the new layout (R6-03).
      if (outcome.shown) toasts.show({ kind: "success", message: "Applied", detail: [summary, outcome.warnings[0]].filter(Boolean).join(". ") });
    } else if (outcome.lost.length > 0 && options.dropReason !== undefined) {
      setPendingDrop({ ops, summary, lost: outcome.lost, reason: options.dropReason });
    } else if (options.quiet !== true && !outcome.stale) {
      // An answer that fails the same way every time, or an exception, needs Restart keyloom, which can't live in a toast (R8-03).
      const failure = outcome.failure;
      const way = failure === undefined ? null : wayOutFor(failure, true);
      const restart = failure === undefined || way === null
        ? {}
        : { action: { label: "Restart keyloom", run: () => setUnexpected({ failure, ...(way.retry ? { retry: () => void perform(ops, summary, options) } : {}) }) } };
      toasts.show({ kind: "error", message: outcome.message, detail: outcome.problems.slice(0, 2).join(" "), ...restart });
    }
    return outcome;
  }

  // The panel's draft would be lost under a change that reloads the layout, so the board's moves wait for it.
  function draftBlocks(): boolean {
    if (editing === null || !draft.dirty) return false;
    toasts.show({ kind: "info", message: "Apply or reset the key you are editing first" });
    return true;
  }

  // All sidebars share one slot. Their data stays mounted where needed; their visibility cannot stack.
  function sidebarSetter(target: Sidebar) {
    return (open: boolean) => {
      if (open) {
        if (editing !== null) closeEditor(false);
        setComboPicking(false);
        if (newBoardPanel) newBoard.close();
      }
      setSidebar((current) => sidebarAfterUpdate(current, target, open));
    };
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
            await perform(added.ops, `Added ${added.name}`, { onSuccess: () => { setLayerId(added.layerId); setRenamingId(added.layerId); } });
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
            await perform(copy.ops, `Duplicated ${layerNameOf(id)} as ${copy.name}`, { onSuccess: () => setLayerId(copy.layerId) });
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
            const outcome = await perform(deleteLayerOps(layout, id, dropOps(drops, `Deleted layer ${name}`)), `Deleted layer ${name}`, { quiet: true });
            if (outcome.ok && editing?.layerId === id) closeEditor(false);
            return outcome;
          },
          condition: (ops, summary) => perform(ops, summary, { quiet: true }),
          openKey: (slot) => {
            setLayerId(slot.layerId);
            openEditor(slot.position, slot.layerId);
          },
          openCombo: (id) => {
            // A combo being made or changed would be replaced without asking (#290 review): it is finished or closed first, and the
            // same combo shows the card with its edits. The dialog says why and shows that card, before it closes (R5-13). A key's
            // unapplied draft can't block here: it turns the layer menu off, so this dialog can't open while one is held.
            const action = openComboFromElsewhere(comboDraft, layout.combos, id);
            const showDraft = () => {
              if (editing !== null) closeEditor(false);
              setChatOpen(false);
              setCombosOpen(true);
            };
            if (action === "blocked" && comboDraft !== null) return { text: comboDraftWaits(comboDraft), action: { label: "Show the combo you're editing", run: showDraft } };
            if (action === "open") openCombo(id);
            else showDraft();
            return null;
          },
          removeTapDance: (id) => {
            const name = layout.tapDances.find((dance) => dance.id === id)?.name ?? id;
            return perform([{ op: "removeTapDance", tapDanceId: id }], `Removed the tap dance ${name}`, { quiet: true });
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

  // New combo from the empty combo list (R3-23): the card opens with no keys yet, and clicks on the board pick them.
  function newCombo() {
    if (draftBlocks()) return;
    if (editing !== null) closeEditor(false);
    setChatOpen(false);
    setSelectMode(false);
    setComboDraft({ id: newComboId(layout), isNew: true, name: "", positions: [], layerIds: "all", output: null, timeoutMs: undefined });
    setComboPicking(true);
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

  // Combos on the board: the lines and each output in a chip, remembered per browser (D-311). Clicking one opens its card.
  function toggleCombos() {
    const on = !showCombos;
    setShowCombos(on);
    writeStored(SHOW_COMBOS_KEY, on ? "1" : "0");
    if (!on) {
      setComboDraft(null);
      setComboPicking(false);
    }
  }

  function toggleHistory() {
    setLibraryOpen(false);
    setSettingsOpen(false);
    setCombosOpen(false);
    setHistoryOpen(!historyOpen);
  }

  function toggleLab() {
    if (labOpen) {
      setLabOpen(false);
      setPinnedProposal(null);
      return;
    }
    if (draftBlocks()) return;
    if (editing !== null) closeEditor(false);
    setChatOpen(false);
    setHistoryOpen(false);
    setLibraryOpen(false);
    setSettingsOpen(false);
    setCombosOpen(false);
    // Findings are on the first layer's keys, so the lab shows it.
    const first = layout.layers[0];
    if (first !== undefined) setLayerId(first.id);
    setLabOpen(true);
  }

  // A key typed in the lab lights on the board for a moment: the first-layer key that types it.
  function labType(ch: string) {
    const code = keyForChar(ch)?.name;
    const bindings = layout.layers[0]?.bindings ?? [];
    const at = bindings.findIndex((b) => (b.kind === "key" && b.code === code) || (b.kind === "holdTap" && b.tap.code === code));
    if (at < 0) return;
    setLabLit(new Set([at]));
    window.setTimeout(() => setLabLit((now) => (now.has(at) && now.size === 1 ? new Set() : now)), 220);
  }

  // The lab's Input Monitoring button (R3-09): the same System Settings opener as kanata's checklist (D-492).
  function openInputMonitoring() {
    const failed = (detail: string) => toasts.show({ kind: "error", message: "keyloom couldn't open System Settings", detail });
    sync.remapperSetup.openSettings("input_monitoring").then(
      (r) => { if (!r.ok) failed(r.reason); },
      (error: unknown) => failed(error instanceof Error ? error.message : "Try the button again."),
    );
  }

  async function labApply(card: ProposalCard) {
    const result = await applyChangeSet(token, card.changeSetId);
    setLabOpen(false);
    if (!(await onProposalApplied(card, result))) return;
    toasts.show({ kind: "success", message: "Applied", detail: `${card.title}. Type again in a few days to see if it stuck.` });
  }

  // The change is in the config but the board still shows the old layout: say so, and Show the new layout reads it again. A read that
  // fails again says so the same way, with the same button (R5-08, R5-09).
  function showAppliedNotShown(error: unknown) {
    setNotShownOn(revision.id);
    toasts.show({
      kind: "error",
      message: APPLIED_NOT_SHOWN.words,
      ...(error instanceof Error && error.message.trim() !== "" ? { detail: error.message } : {}),
      action: { label: "Show the new layout", run: () => void onChanged().catch(showAppliedNotShown) },
    });
  }

  function toggleLibrary() {
    setHistoryOpen(false);
    setSettingsOpen(false);
    setCombosOpen(false);
    setLibraryKeys(null);
    setLibraryOpen(!libraryOpen);
  }

  // Every combo, as a list: from the menu, for the ones on other layers.
  function toggleComboList() {
    if (combosOpen) {
      setCombosOpen(false);
      setComboDraft(null);
      return;
    }
    if (draftBlocks()) return;
    if (editing !== null) closeEditor(false);
    setHistoryOpen(false);
    setLibraryOpen(false);
    setSettingsOpen(false);
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
    // Paste stays pressable with nothing copied, so pressing it says what to do instead of nothing happening (R6-16).
    if (clipboard === null) {
      toasts.show({ kind: "info", message: "Nothing to paste yet", detail: "Copy a key first: open it and press Copy (⌘C)." });
      return;
    }
    if (targets.length === 0 || draftBlocks()) return;
    const ops = pasteOps(layout, clipboard.binding, targets);
    if (ops === null) {
      toasts.show({ kind: "info", message: "Already that", detail: "Every key already does this." });
      return;
    }
    const what = bindingSummary(clipboard.binding, layout);
    // The history line counts the keys that changed, not the ones that already had it.
    const changed = ops.flatMap((op) => (op.op === "setBinding" ? [op.at] : []));
    await perform(ops, pasteSummary(layout, clipboard.binding, changed), { dropReason: `Replaced by pasting ${what}`, onSuccess: () => setChatSelection(null) });
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
    await perform(ops, summaryText, { onSuccess: () => setApplied(to) });
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
    await perform(ops, copy ? copySummary(layout, a, b) : swapSummary(layout, a, b), { dropReason: `Replaced by a copy of ${what}`, onSuccess: () => setApplied(b) });
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
    await perform(ops, quickAssignSummary(layout, quickTargets, quick), {
      dropReason: "Replaced by typing the key",
      onSuccess: () => { setQuick(null); setChatSelection(null); },
    });
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

  // ---- kept drafts (D-317) ----
  // A resumed draft is for the card's first mount only; a later remount (after Apply) starts from the key as applied.
  useEffect(() => {
    if (editing?.resume !== undefined) setEditing((now) => (now === null || now.resume === undefined ? now : { layerId: now.layerId, position: now.position, focus: now.focus }));
  }, [editing?.resume]);

  /** Keeps the open card's unapplied draft on its key, dashed amber on the board, until it is applied or discarded. */
  function keepOpenDraft() {
    if (editing === null || !draft.dirty) return;
    const kept = panel.current?.snapshot() ?? null;
    const original = layout.layers.find((candidate) => candidate.id === editing.layerId)?.bindings[editing.position];
    if (kept === null || original === undefined) return;
    setParked((now) => park(now, { slot: { layerId: editing.layerId, position: editing.position }, panel: kept, binding: draft.binding, original }));
  }

  /** The kept draft for a key, taken off the board while its card is open, as Editing's `resume`. */
  function resumeFor(layerId: string, position: number): { resume?: Draft } {
    const entry = parked.get(slotKey({ layerId, position }));
    if (entry === undefined) return {};
    setParked((now) => unpark(now, entry.slot));
    return { resume: entry.panel };
  }

  function select(index: number | null) {
    // Place, swap and combo-key modes own clicks; moving focus must not choose anything.
    if (placing !== null || swapping !== null || comboPicking) return;
    if (chatOpen || editing === null || index === null) {
      setSelected(index);
      return;
    }
    // A draft is the person's work: moving to another key keeps it on its key, dashed amber, to come back to (D-317).
    setSelected(index);
    if (index !== editing.position) {
      keepOpenDraft();
      setDraft(CLEAN);
      setEditing({ layerId: editing.layerId, position: index, focus: false, ...resumeFor(editing.layerId, index) });
    }
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
    // Switching layer keeps the open key's draft on its key instead of refusing to move (D-317).
    setLayerId(id);
    if (editing !== null) {
      keepOpenDraft();
      setDraft(CLEAN);
      setEditing({ layerId: id, position: editing.position, focus: false, ...resumeFor(id, editing.position) });
    }
  }

  function openEditor(position: number, onLayer?: string) {
    if (layer === undefined) return;
    setSidebar(null);
    if (newBoardPanel) newBoard.close();
    setSelected(position);
    setBlocked(false);
    // A key opens over the combo being made; the combo is not kept.
    setComboDraft(null);
    setComboPicking(false);
    if (editing?.position === position && editing.layerId === (onLayer ?? layer.id)) return;
    keepOpenDraft();
    setDraft(CLEAN);
    setPlacing(null);
    setPlacements([]);
    setRepeating(false);
    setSwapping(null);
    setEditing({ layerId: onLayer ?? layer.id, position, focus: true, ...resumeFor(onLayer ?? layer.id, position) });
  }

  // `keepDraft` false drops the card's draft instead of parking it on the board: after a write, the draft is no longer unapplied.
  function closeEditor(refocus: boolean, keepDraft = true) {
    if (keepDraft) keepOpenDraft();
    const position = editing?.position ?? null;
    setBoardLayout({ shift: 0, part: null, scale: 1 });
    setPointAt(null);
    setEditing(null);
    setDraft(CLEAN);
    setPlacing(null);
    setPlacements([]);
    setBlocked(false);
    if (refocus && position !== null) keyboard.current?.focusKey(position);
  }

  function openChat() {
    // The open key's draft is kept on the board and sent with the next message, so asking about it is one step (D-317).
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
    // The key replaces the conversation; its request/history stay mounted, not layered underneath (D-410).
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
          // The same guard as the card's Copy button: with a draft open, the saved binding isn't what the card shows (R6-16).
          if (!draftBlocks()) copyKey(source);
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
        // A key over the conversation panel goes first, back to the conversation (D-310).
        else if (keyOverChat) closeEditor(true);
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
      // ⌥I, so a plain I is free to find the I key (P1 review). event.code, since ⌥I types a dead key on a Mac.
      if (event.code === "KeyI" && event.altKey && !event.metaKey && !event.ctrlKey && !typing(event.target)) {
        event.preventDefault();
        toggleInspect();
        return;
      }
      // ⌥S swaps the open key (D-317). Not a plain S: with a card open a plain letter types that key into the tap slot.
      if (event.code === "KeyS" && event.altKey && !event.metaKey && !event.ctrlKey && !typing(event.target) && editing !== null) {
        event.preventDefault();
        if (draft.dirty) toasts.show({ kind: "info", message: "Apply or discard this key's change first" });
        else setSwapping((current) => (current === null ? { layerId: editing.layerId, position: editing.position } : null));
        return;
      }
      // ⌥C, ⌥H and ⌥L, like ⌥I: a plain letter finds that key on the board, which pressing the real keyboard relies on (D-311).
      // event.code, since ⌥ and a letter type a dead key or a symbol on a Mac. Not while typing or with a key's card open.
      if (event.altKey && !event.metaKey && !event.ctrlKey && !typing(event.target) && editing === null && (event.code === "KeyC" || event.code === "KeyH" || event.code === "KeyL")) {
        event.preventDefault();
        if (event.code === "KeyC") toggleCombos();
        else if (event.code === "KeyH") toggleHistory();
        else toggleLibrary();
        return;
      }
      if (/^[a-z;',./[\]\\`-]$/i.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target) && editing === null && quick === null && !chatOpen) {
        const code = keyForChar(event.key)?.name;
        const bindings = view.layers[layerIndex]?.bindings ?? [];
        const at = bindings.findIndex((binding) => (binding.kind === "key" && binding.code === code && binding.mods === undefined) || (binding.kind === "holdTap" && binding.tap.code === code));
        if (at >= 0) setFound(at);
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

  // A proposal was applied on the server: show the new layout, on the layer where it changed. True once it is on screen. A layout that
  // couldn't be read afterwards is not an Apply failure, wherever the Apply came from (R5-08): the toast says it is applied and offers to
  // show it, and this resolves false. A caller that says so in place passes its own `notShown`.
  async function onProposalApplied(card: ProposalCard, result: ApplyResponse, notShown: (error: unknown) => void = showAppliedNotShown): Promise<boolean> {
    setHoveredProposal(null);
    setPinnedProposal(null);
    // The apply lands on the board, not in the bar: the bar closes and the changed caps press (P3 review).
    setChatOpen(false);
    try {
      await onChanged();
    } catch (error) {
      notShown(error);
      return false;
    }
    const changed = [...card.validation.diff.changed, ...card.validation.diff.retuned];
    const here = changed.find((slot) => slot.layerId === layout.layers[headIndex]?.id) ?? changed[0];
    if (here !== undefined) {
      setLayerId(here.layerId);
      setAppliedKeys({ layerId: here.layerId, positions: changed.filter((slot) => slot.layerId === here.layerId).map((slot) => slot.position) });
    }
    setUnsynced((current) => [...current, ...changed.filter((slot) => !current.some((c) => c.layerId === slot.layerId && c.position === slot.position))]);
    // The bar has closed, so the toast says what happens next on this keyboard, with its one button (R2-01).
    const next = afterApply(afterApplyKeyboard.board, boardSync, summary.id, result.revisionId);
    const run = afterApplyRun(next.action, afterApplyKeyboard, () => onOpenRelease());
    toasts.show({ kind: "success", message: "Applied", detail: `${withStop(card.title)} ${next.toast}`, ...(next.action === null || run === null ? {} : { action: { label: next.action.label, run } }) });
    return true;
  }

  // The panel stays on the key after an apply, so the next slot can be filled straight away (16#the-key-panel).
  async function onApplied(summaryText: string, change: { before: Binding; after: Binding }) {
    if (editing === null) return;
    const { layerId: appliedLayer, position } = editing;
    setLastChange({ layerId: appliedLayer, position, ...change });
    // The draft is written either way, so it is cleared either way; only the toast depends on the read (R6-03).
    const shown = await readAfterApply(onChanged, showAppliedNotShown);
    if (!shown) {
      closeUnshownCard();
      return;
    }
    setApplied({ layerId: appliedLayer, position });
    setDraft(CLEAN);
    setPlacements([]);
    setPlacing(null);
    if (shown) toasts.show({ kind: "success", message: "Applied", detail: summaryText });
  }

  async function onRepeated(summaryText: string, firstPosition: number) {
    const shown = await readAfterApply(onChanged, showAppliedNotShown);
    if (chatSelection !== null) {
      setLayerId(chatSelection.layerId);
      setApplied({ layerId: chatSelection.layerId, position: firstPosition });
    }
    if (shown) toasts.show({ kind: "success", message: "Applied", detail: summaryText });
    setRepeating(false);
  }

  // The layout moved on (another tab, the CLI): nothing was written, so say so and show the latest. The toast says the latest version
  // is showing only once it is; a read that fails says so, with a button that reads it again (R6-03).
  function onStale() {
    closeEditor(true);
    setRepeating(false);
    showLatest(STALE_EDIT);
  }

  function showLatest(words: { words: string; shown: string }) {
    const notShown = (error: unknown) =>
      toasts.show({
        kind: "error",
        message: words.words,
        detail: [LATEST_NOT_SHOWN, error instanceof Error ? error.message.trim() : ""].filter(Boolean).join(" "),
        action: { label: "Show the latest version", run: () => showLatest(words) },
      });
    void readAfterApply(onChanged, notShown).then((shown) => {
      if (shown) toasts.show({ kind: "error", message: words.words, detail: words.shown });
    });
  }

  const chatDrafts = useMemo(() => draftsForChat(parked), [parked]);
  // The config names a reply's `{config:…}` marker can draw (D-468): the list the page already switches between.
  const configNames = useMemo(() => new Map(chrome.layouts.map((candidate) => [candidate.id, candidate.name])), [chrome.layouts]);

  /**
   * Opens another board or config, carrying the layer by name and the chat (D-317). A conversation belongs to one layout, so the thread
   * travels as what was on screen: this layout's turns, after any it had carried in itself, so a run of switches keeps the whole thread.
   */
  function switchLayout(id: string, extra: Partial<Arrival> = {}) {
    const handoff = turnsNow.current.flatMap((turn) => turn.kind === "assistant" && turn.presentation?.handoff?.layoutId === id ? [turn.presentation.handoff] : []).at(-1);
    const carry: Arrival = { layerName: layer?.name ?? null, chatOpen, thread: threadToCarry(), ...(handoff === undefined ? {} : { conversationId: handoff.conversationId }), ...extra };
    if (chrome.onCarry !== undefined) chrome.onCarry(id, carry);
    else chrome.onSelect(id);
    // A config made since the page loaded isn't in the page's list yet, and selecting an unknown one leaves the page on its skeleton.
    if (!chrome.layouts.some((candidate) => candidate.id === id)) chrome.onReload?.(id);
  }

  // A board opens on the config its keyboard runs (D-315), else its first.
  function openBoard(boardId: string) {
    const running = sync.boards.find((candidate) => candidate.boardId === boardId)?.layoutId;
    const target = chrome.layouts.find((candidate) => candidate.id === running) ?? chrome.layouts.find((candidate) => candidate.boardId === boardId);
    if (target !== undefined && target.id !== summary.id) switchLayout(target.id);
  }

  /** The thread as it stands, with the config it was about, so the next page can show it and its config cards can go back. */
  function threadToCarry(own: readonly Turn[] = turnsNow.current): CarriedThread | null {
    const turns = [...withoutRepeats(carriedThread?.turns ?? [], own), ...own];
    if (turns.length === 0) return null;
    // With nothing said on this page yet, the thread is still about the config it came from.
    const inherited = carriedThread !== null && own.length === 0;
    return {
      fromName: inherited ? carriedThread.fromName : `${summary.name} on your ${boardDisplayName(board.name)}`,
      turns,
      ...(inherited ? (carriedThread.from === undefined ? {} : { from: carriedThread.from }) : { from: { id: summary.id, name: summary.name } }),
    };
  }

  // A config the agent made opens by itself when BK watched the reply finish and is not in the middle of anything here (D-450). It
  // opens with the chat carried (D-317) and its proposals one click away (D-336); a reply loaded from history, found again after a
  // reload or carried in from another page never gets here, because the chat only announces replies it sent.
  const openedForAgent = useRef(new Set<string>());
  const busyHere = editing !== null || draft.dirty || comboDraft !== null || comboPicking || placing !== null || swapping !== null || quick !== null
    || pendingDrop !== null || parked.size > 0 || changing || renamingId !== null || configDialog !== null || lightingDraft.size > 0 || newBoardPanel;
  function onReplyCompleted(presentation: ChatPresentation, turns: readonly Turn[]) {
    const id = autoOpenTarget(presentation, { currentId: layoutRef, opened: openedForAgent.current, busy: busyHere });
    if (id === null) return;
    openedForAgent.current.add(id);
    const carry: Arrival = { layerName: layer?.name ?? null, chatOpen: true, thread: threadToCarry(turns), ...(presentation.handoff === undefined ? {} : { conversationId: presentation.handoff.conversationId }) };
    if (chrome.onCarry !== undefined) chrome.onCarry(id, carry);
    // The list of configs behind the page doesn't have it yet; reloading also selects it.
    chrome.onReload?.(id);
  }
  const refreshMadeConfigs = useMadeConfigRefresh(configs);

  /** After "Make": open the new config with its proposals beside the board (D-336). */
  function openMadeConfig(configId: string) {
    const carry: Arrival = { layerName: null, chatOpen: false, thread: null, proposals: true,
      ...(newBoard.step.kind === "setup" || (newBoard.step.kind === "put" && newBoard.step.origin === "known") ? { review: true } : {}) };
    if (chrome.onCarry !== undefined) chrome.onCarry(configId, carry);
    chrome.onReload?.(configId);
  }

  /** The new-keyboard steps' Import: the import screen at that board's card when the board is known (R7-13), or at every card. */
  function importForBoard(boardId: string | null) {
    if (editing !== null) closeEditor(false);
    setSidebar(null);
    chrome.onImport(boardId);
  }

  // ⌘K commands (D-315): the typing lab and the config commands, offered above "Ask keyloom" when the text names them.
  // `find` keeps its identity while the configs don't change, so the bar's highlighted row survives a re-render.
  const findCommands = useCallback(
    (text: string) => matchCommands(text, { configs: configs.live, currentId: summary.id, boardName: boardDisplayName(board.name) }).filter((c) => c.kind !== "lab" || board.firmware !== "kanata"),
    [configs.live, summary.id, board.name, board.firmware],
  );
  const chatCommands = {
    find: findCommands,
    run: (command: Command) => {
      setChatOpen(false);
      if (command.kind === "lab") {
        if (!labOpen) toggleLab();
      } else if (command.kind === "new-config") setConfigDialog({ kind: "new" });
      else if (command.kind === "switch") switchLayout(command.id);
      else setConfigDialog({ kind: "put-on", target: { id: command.id, name: command.name } });
    },
  };

  // ---- configs and versions (D-315) ----
  // Opening another config remounts this page and drops its toasts, so a toast raised just before is left for the next page (D-316).
  const toastAcross = (toast: Parameters<typeof toasts.show>[0], moving: boolean) => {
    if (!moving || !leaveToast(toast)) toasts.show(toast);
  };
  useEffect(() => {
    const left = takeToast();
    if (left !== null) toasts.show(left);
    // Once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A failed action's toast keeps its code, so a failure no screen planned for gets Restart keyloom (R9-05).
  const failedToast = (message: string, error: unknown, retry?: () => void) => toasts.show(failedToastInput(message, error, setUnexpected, retry));

  async function archiveThis() {
    try {
      await archiveConfig(token, summary.id);
      // An archived config is hidden, so the page moves to the one the keyboard runs.
      const moving = keyboardConfig !== null && keyboardConfig.id !== summary.id;
      toastAcross({ kind: "info", message: `Archived ${summary.name}`, detail: "It's under Archived in the config menu, with its history." }, moving);
      configs.reload();
      if (moving && keyboardConfig !== null) switchLayout(keyboardConfig.id);
    } catch (error) {
      failedToast("Couldn't archive it", error, () => void archiveThis());
    }
  }

  async function restoreArchived(id: string) {
    try {
      const restored = await restoreConfig(token, id);
      toastAcross({ kind: "info", message: `Restored ${restored.name}` }, restored.id !== summary.id);
      configs.reload();
      chrome.onReload?.(restored.id);
    } catch (error) {
      failedToast("Couldn't restore it", error, () => void restoreArchived(id));
    }
  }

  async function compareWith(milestone: Milestone) {
    setComparing({ milestone, status: "loading" });
    try {
      const compare = await compareVersion(token, layoutRef, milestone.version.id);
      setComparing((now) => (now?.milestone.version.id === milestone.version.id ? { milestone, status: "ready", compare } : now));
    } catch (error) {
      setComparing({ milestone, status: "error", ...compareFailure(error) });
    }
  }

  // Putting a config on the keyboard: it becomes the board's config and syncs once (the route's own checks, D-303).
  async function putOn(target: { id: string }) {
    await useConfig(token, target.id);
    configs.reload();
  }

  /**
   * Putting an old version on the keyboard (D-315). The engine syncs a config's head, so this goes back to the version first (a new
   * revision, D-170, which also keeps auto-sync from putting the newer head back), then syncs: the config's own sync when it is the
   * keyboard's, else the put-on. One confirm covers both.
   */
  async function putVersionOn(milestone: Milestone) {
    if (milestone.version.revisionId !== revision.id) {
      try {
        await restoreVersion(token, layoutRef, milestone.version.id);
      } catch (error) {
        // The head already holds the version's document (an earlier go-back): nothing to restore, so only the sync remains.
        if (!(error instanceof ApiError && error.status === 400 && /nothing to go back to/.test(error.message))) throw error;
      }
      await onChanged();
    }
    if (editingOther) await useConfig(token, summary.id);
    else await syncConfig(token, summary.id);
    setComparing(null);
    configs.reload();
    history.reload();
  }

  // One step back or forward (the head's undo), or, with `target`, back to any earlier revision as one new revision (D-170).
  /** Resolves true when the step back went through, so Compare closes only then and a failure keeps it open beside the toast (R3-23). */
  async function undo(target?: { id: string; summary: string }, after?: () => void): Promise<boolean> {
    setUndoing(true);
    setUnsynced([]);
    const undone = target?.summary ?? revision.summary;
    const restored = target === undefined && revision.origin === "undo";
    try {
      await undoChange(token, layoutRef, { revisionId: revision.id, ...(target === undefined ? {} : { to: target.id }) });
      // The step is written; a failed read says so with Show the new layout, never "Couldn't undo" (R6-03).
      // What the caller does once the step has landed, such as closing Compare; a retry from the toast runs it too (PR #310 CodeRabbit).
      after?.();
      if (!(await readAfterApply(onChanged, showAppliedNotShown))) return true;
      toasts.show(
        target === undefined
          ? { kind: "info", message: restored ? "Change restored" : "Undone", detail: undone.replace(/^(Undo|Redo): /, "") }
          : { kind: "info", message: "Went back", detail: undone },
      );
      return true;
    } catch (error) {
      const stale = error instanceof ApiError && error.status === 409 && error.code !== "validation_failed";
      if (stale) showLatest(STALE_UNDO);
      else failedToast(target === undefined ? "Couldn't undo" : "Couldn't go back", error, () => {
        if (undoBlockNow.current !== null) toasts.show({ kind: "info", message: undoBlockNow.current });
        else void undo(target, after);
      });
      return false;
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
    if (!(await readIfChanged(out.changed, onChanged, showAppliedNotShown))) return;
    toasts.show({ kind: out.changed ? "success" : "info", message: out.changed ? "Updated" : "Nothing to update", detail: out.message });
  }
  // A refused update and a hidden offer hold for this version of the layout only: a change may let the update pass (R9-09).
  const upgradeRefused = upgradeRefusal?.revisionId === revision.id;
  const offer = detail.upgrade === null || detail.upgrade === undefined || (upgradeRefused && upgradeRefusal.hidden) ? null : (
    <UpgradeOffer
      offer={detail.upgrade}
      onUpgrade={upgradeNow}
      token={token}
      refused={upgradeRefused}
      onRefused={() => setUpgradeRefusal({ revisionId: revision.id, hidden: false })}
      onHide={() => setUpgradeRefusal({ revisionId: revision.id, hidden: true })}
    />
  );

  async function onTuned(summaryText: string) {
    if (await readAfterApply(onChanged, showAppliedNotShown)) toasts.show({ kind: "success", message: "Applied", detail: summaryText });
    else closeUnshownCard();
  }

  // A key written but not read back: the card is keyed by revision, so it would stay on the old one, keeping the written draft with
  // Apply on, and Swap, Copy and Paste would act on the old binding. It closes instead, and the not-shown toast's Show the new layout
  // reads the layout again. A card opened on the old layout before then can only write against the old revision, which the server
  // refuses as stale (PR #297 CodeRabbit).
  function closeUnshownCard() {
    closeEditor(true, false);
  }

  // The sheet's height is also the room the board keeps below it, so a key opened under it can be scrolled up (18#phones).
  const workbenchStyle = { "--sheet-h": `${sheetHeight(sheet, viewportHeight)}px` } as CSSProperties;
  const chips = chatSelection?.positions.length ?? 0;
  // The chat: the command bar at the stage's foot on a wide screen (23#chrome-recedes, P3), the bottom sheet on a narrow one. It stays
  // mounted while closed, so a reply that is streaming survives closing the bar.
  // A send captures this screen's generation. User navigation/editing invalidates that send's
  // navigation permission, even if the user later returns. Agent-owned opens renew only their own lease.
  const viewSignature = JSON.stringify([sidebar, busyHere, editing, comboDraft, lab.phase.kind, layerId, revision.id]);
  const viewGeneration = useRef({ signature: viewSignature, n: 0 });
  useLayoutEffect(() => {
    if (viewGeneration.current.signature !== viewSignature) viewGeneration.current = { signature: viewSignature, n: viewGeneration.current.n + 1 };
  }, [viewSignature]);
  const [viewRequest, setViewRequest] = useState<{ target: Sidebar; signal: AbortSignal; already: boolean; resolve: (result: ViewResult) => void } | null>(null);
  const viewState = useRef<{ blocked: "draft" | "recording" | null; sidebar: Sidebar | null; open: (view: AgentView) => void }>({ blocked: null, sidebar, open: () => {} });
  useLayoutEffect(() => { viewState.current = {
    blocked: lab.phase.kind === "listening" || lab.phase.kind === "reading" ? "recording" : busyHere ? "draft" : null,
    sidebar,
    open: (destination) => {
      if (destination === "lab") { if (!labOpen) toggleLab(); }
      else if (destination === "history") setHistoryOpen(true);
      else if (destination === "settings") setSettingsOpen(true);
      else setChatOpen(true);
    },
  }; });
  // "in Settings" and "ask the chat" in copy deeper down open those places (R1-23).
  const placeOpener = useRef<(place: Place) => void>(() => {});
  placeOpener.current = (place) => (place === "settings" ? setSettingsOpen(true) : setChatOpen(true));
  useEffect(() => onOpenPlace((place) => placeOpener.current(place)), []);
  const beginViewRequest = (): OpenRequestedView => {
    let expected = viewGeneration.current.n;
    return async (destination, signal) => {
      if (signal.aborted) return { version: 1, status: "unavailable", reason: "cancelled" };
      if (viewState.current.blocked) return { version: 1, status: "unavailable", reason: viewState.current.blocked };
      if (viewGeneration.current.n !== expected) return { version: 1, status: "unavailable", reason: "moved" };
      const target = destination === "decisions" ? "chat" : destination;
      const result = await new Promise<ViewResult>((resolve) => {
        const abort = () => resolve({ version: 1, status: "unavailable", reason: "cancelled" });
        signal.addEventListener("abort", abort, { once: true });
        setViewRequest({ target, signal, already: viewState.current.sidebar === target, resolve: (value) => { signal.removeEventListener("abort", abort); resolve(value); } });
        viewState.current.open(destination);
      });
      expected = viewGeneration.current.n;
      return result;
    };
  };
  useLayoutEffect(() => {
    if (!viewRequest) return;
    const reason = viewRequest.signal.aborted ? "cancelled" : viewState.current.blocked ?? (sidebar !== viewRequest.target ? "moved" : null);
    viewRequest.resolve(reason ? { version: 1, status: "unavailable", reason } : { version: 1, status: viewRequest.already ? "already-open" : "opened" });
    setViewRequest(null);
  }, [viewRequest, sidebar]);
  useEffect(() => () => viewRequest?.resolve({ version: 1, status: "unavailable", reason: "cancelled" }), [viewRequest]);

  if (layer === undefined) return null;
  function repairState(): "current" | "checking" | "stale" {
    if (repairDraft === null || revision.id !== repairDraft.headRevisionId) return "stale";
    // A question about a build stays good to send whatever the review says; its log is in it.
    if ("buildId" in repairDraft) return "current";
    if ("source" in repairDraft) {
      const source = repairDraft.source;
      return source.conversationId !== undefined || (source.kind === "proposal" && waiting?.some((proposal) => proposal.changeSetId === source.proposalId && proposal.status === "proposed") === true) ? "current" : "stale";
    }
    return findingRepairState(repairDraft, boardReview);
  }
  const repair = repairState();
  const chatContent = (
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
                beginViewRequest={beginViewRequest}
                variant="bar"
                sheet={narrow}
                onClose={() => setChatOpen(false)}
                collapsed={!narrow && barFit.collapsed}
                onPresentation={setChatPresentation}
                token={token}
                layoutRef={layoutRef}
                configName={summary.name}
                onActivity={setChatActivity}
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
                onApplied={async (card, result) => { await onProposalApplied(card, result); }}
                onOpenRelease={onOpenRelease}
                commands={chatCommands}
                drafts={chatDrafts}
                initialConversation={chrome.arrival?.conversationId}
                continueCopy={chrome.arrival?.continueCopy}
                repairDraft={repairDraft}
                repairCurrent={repair === "current"}
                repairChecking={repair === "checking"}
                onFreshReview={() => { setReviewOpen(true); void boardReview.run(true); }}
                onPlanRecovery={planRecovery}
                onRepairDraftChange={(id, request) => repairDraft?.id === id && onRepairDraft(id, { ...repairDraft, request })}
                onRepairSentStateChange={(id, sent) => repairDraft?.id === id && onRepairDraft(id, { ...repairDraft, sent })}
                onRepairSent={(id) => repairDraft?.id === id && onRepairDraft(id, null)}
                onContinueCopy={(handoff) => {
                  chrome.onCarry?.(handoff.layoutId, { layerName: null, chatOpen: true, thread: threadToCarry(), conversationId: handoff.conversationId, continueCopy: true });
                  chrome.onReload?.(handoff.layoutId);
                }}
                carried={carriedThread}
                onClearCarried={() => setCarriedThread(null)}
                onTurns={(turns) => {
                  turnsNow.current = turns;
                  refreshMadeConfigs(turns);
                }}
                onReplyCompleted={onReplyCompleted}
                onOpenConfig={switchLayout}
                onReviewProposals={() => { setReviewOpen(false); setProposalsOpen(true); }}
                onShowLayer={chooseLayer}
                onFoundKey={setFound}
                configNames={configNames}
              />
            </>
  );
  // The combo being made or edited, as a card: beside its keys on a wide screen, the bottom sheet on a narrow one.
  const comboCard = comboDraft === null ? null : (
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
                  const shown = await readAfterApply(onChanged, showAppliedNotShown);
                  setComboDraft(null);
                  setComboPicking(false);
                  if (shown) toasts.show({ kind: "success", message: "Applied", detail: summaryText });
                }}
                onStale={onStale}
              />
  );
  // One key card: floating beside its key on a wide screen, the bottom sheet on a narrow one (23#the-key-card).
  const keyCard = (
            editing === null ? null : (
              <KeyPanel
                board={board}
                key={`${revision.id}:${editing.layerId}:${editing.position}`}
                resume={editing.resume}
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
                onShowLatest={() => {
                  // The read remounts the card on the newer revision without its draft, so the card closes and parks the draft on its
                  // key, where opening the key resumes it (PR #306 review).
                  const kept = draft.dirty;
                  closeEditor(true);
                  showLatest(kept ? STALE_CHECK : STALE_UNDO);
                }}
                onShowLayer={(id) => {
                  if (!draft.dirty) setLayerId(id);
                }}
                keycap={board.display?.keycaps?.[String(editing.position)]}
                led={editing.layerId === layer.id ? ledColors?.get(editing.position) : undefined}
                reach={editing.layerId === layer.id ? reach.get(editing.position) : undefined}
                onPointAt={setPointAt}
                actionsNote={keyMovesNote(draft.dirty ? KEY_MOVES_BLOCKED : null)}
                notice={detail.upgrade?.tapDances !== true || !/^TD\(/.test(editedNativeSource(layout, editing)) ? null : offer}
                actions={
                  <>
                  <KeyMoves
                    swapping={swapping !== null}
                    onSwap={() => setSwapping((current) => (current === null ? { layerId: editing.layerId, position: editing.position } : null))}
                    onCopy={() => copyKey({ layerId: editing.layerId, position: editing.position })}
                    copied={clipboard === null ? null : bindingSummary(clipboard.binding, layout)}
                    pasteTargets={Math.max(1, chatSelection?.positions.length ?? 0)}
                    onPaste={() => void paste()}
                    blockedReason={draft.dirty ? KEY_MOVES_BLOCKED : null}
                  />
                  {board.lighting === undefined ? null : (
                    <KeyColour
                      layer={layout.layers.find((candidate) => candidate.id === editing.layerId) ?? layer}
                      position={editing.position}
                      busy={changing}
                      onPick={(colour) => {
                        const target = layout.layers.find((candidate) => candidate.id === editing.layerId);
                        if (target === undefined) return;
                        const lighting: LayerLighting = withKeyColour(target.lighting, editing.position, colour);
                        void perform([{ op: "setLayerLighting", layerId: target.id, lighting }], `${keyOn(layout, { layerId: target.id, position: editing.position })}: ${colour === null ? "follows the layer colour" : "own colour"}`);
                      }}
                    />
                  )}
                  </>
                }
              />
            )
  );

  return (
    <AfterApplyContext.Provider value={afterApplyKeyboard}>
    <div className="workspace">
      <TopBar
        onHome={chrome.onHome}
        onManageKeyboards={chrome.onManageKeyboards}
        onAddKeyboard={chrome.onAddKeyboard}
        boards={{
          entries: boardEntries(chrome.layouts, chrome.boardChoices).map((entry) => ({ ...entry, tone: boardLight(sync.boards.find((candidate) => candidate.boardId === entry.id)) })),
          active: summary.boardId,
          onSelect: openBoard,
        }}
        boardsAfter={newBoard.step.kind !== "idle" || (newBoard.waiting.length === 0 && newBoard.setupWaiting.length === 0) ? null : newBoard.waiting.length > 0 ? (
          // A keyboard keyloom hasn't met stays one click away after "Not now" (D-336).
          <button type="button" className="nb-chip" onClick={() => newBoard.reopen(newBoard.waiting[0] as (typeof newBoard.waiting)[number])}>
            <i aria-hidden="true" /><span>New keyboard</span>
          </button>
        ) : (
          // A board keyloom knows but that has no config yet stays one click away too, or it is invisible (D-336).
          <button type="button" className="nb-chip" onClick={() => newBoard.reopenSetup(newBoard.setupWaiting[0] as (typeof newBoard.setupWaiting)[number])}>
            <i aria-hidden="true" /><span>{newBoard.setupWaiting[0]?.knownBoard?.name ?? "Set up"}</span>
          </button>
        )}
        sync={
          editingOther && keyboardConfig !== null ? (
            <>
              <EditingStatus name={summary.name} onKeyboard={keyboardConfig.name} boardName={boardDisplayName(board.name)} onPutOn={() => setConfigDialog({ kind: "put-on", target: { id: summary.id, name: summary.name } })} />
              {/* SyncStatus isn't here to host Replace it, which a refused put-on of this config asks for. */}
              <ReplaceForeignHost sync={sync} boardId={summary.boardId} />
            </>
          ) : (
            <SyncStatus sync={sync} layoutId={summary.id} layoutName={summary.name} boardId={summary.boardId} onOpenRelease={(buildId) => onOpenRelease(undefined, buildId)} onPutOn={(target) => setConfigDialog({ kind: "put-on", target })} />
          )
        }
        ask={{ open: chatOpen, onToggle: toggleChat }}
        undo={{
          canUndo: revision.origin !== "undo" && revision.undoable,
          canRedo: revision.origin === "undo" && revision.undoable,
          busy: undoing,
          blockedReason: undoBlock,
          summary: revision.summary,
          onUndo: () => void undo(),
        }}
        menu={{
          // Combos, Inspect, History and Library are one click away beside the strip (D-311); the menu keeps the rare things, and
          // the list of every combo.
          combos: { open: combosOpen, onToggle: toggleComboList },
          // On a phone the strip has no room for the view controls; there they stay in the menu.
          history: { open: historyOpen, onToggle: toggleHistory },
          library: { open: libraryOpen, onToggle: toggleLibrary },
          inspect: { on: inspect, onToggle: toggleInspect },
          showCombos: { on: showCombos, onToggle: toggleCombos },
          // The MacBook keyboard's remapper has no key stream, so the lab isn't offered for it (R1-28).
          ...(board.firmware === "kanata" ? {} : { lab: { open: labOpen, onToggle: () => toggleLab() } }),
          settings: {
            open: settingsOpen,
            onToggle: () => {
              setHistoryOpen(false);
              setLibraryOpen(false);
              setSettingsOpen(!settingsOpen);
            },
          },
          advanced: {
            on: advanced,
            onToggle: () => {
              setAdvanced(!advanced);
              writeStored(ADVANCED_KEY, advanced ? "0" : "1");
            },
          },
          select: { on: selectMode, onToggle: () => setSelectMode(!selectMode) },
          onShortcuts: () => setShortcutsOpen(true),
          ...(chrome.release === undefined ? {} : { release: chrome.release }),
        }}
      />
      <div ref={workbenchRef} className="workbench" data-newboard={newBoardDrawn !== null || undefined} data-lab={labOpen ? lab.phase.kind : undefined} data-side={labPanelShown || (newBoardPanel && !narrow) || (proposalsShown && !narrow) || (reviewShown && !narrow) ? "chat" : chatPanel && !keyOverChat ? "chat" : keyOverChat ? "open" : mode === "summary" || (!narrow && (mode === "key" || mode === "chat")) ? "closed" : "open"} data-sheet={narrow && mode !== "summary" ? sheet : undefined} data-over-chat={keyOverChat || undefined} style={workbenchStyle}>
        <section
          ref={stageRef}
          className="stage"
          aria-label="Layout"
          data-placing={placing !== null}
          data-card={!narrow && editing !== null}
          data-bar={!narrow && chatOpen && !chatPanel ? (barFit.collapsed ? "line" : "open") : undefined}
          style={{ "--board-lift": `${barFit.lift}px`, "--bar-room": `${barFit.room}px` } as CSSProperties}
        >
          <Caption
            layoutMenu={
              <ConfigMenu
                live={configs.live}
                archived={configs.archived}
                selectedId={summary.id}
                selectedName={summary.name}
                boardName={boardDisplayName(board.name)}
                onSelect={switchLayout}
                onNew={() => setConfigDialog({ kind: "new" })}
                onRename={() => setConfigDialog({ kind: "rename" })}
                onArchive={() => void archiveThis()}
                onRestore={(id) => void restoreArchived(id)}
                onDelete={(config) => setConfigDialog({ kind: "delete", config: { id: config.id, name: config.name } })}
                onImport={chrome.onImport}
              />
            }
            marker={<ReviewMarker review={boardReview} open={reviewShown} onToggle={() => {
              setProposalsOpen(false);
              setReviewOpen(!reviewOpen);
            }} />}
            layerId={layer.id}
            layerName={layer.name}
            light={light}
            reach={reachWords(view, layerIndex, board.fingers, (position) => describeKey(view, 0, position)?.legend.tap ?? "")}
            notice={offer ?? (proposalsOpen ? null : waitingFailed && unexpectedWayOut(waitingCode, true)?.retry === false ? (
              <span className="nb-waiting-failed" role="alert">Couldn&apos;t read proposals. <RestartKeyloom token={token} /></span>
            ) : waitingFailed ? (
              // A read that failed is not "nothing waiting": the slot says so and reads again (R5-11).
              <button type="button" className="sheet-action nb-waiting" onClick={() => { setWaiting(null); setWaitingRead((read) => read + 1); }}>
                Couldn&apos;t read proposals · Try again
              </button>
            ) : waitingCount === 0 ? null : (
              <button type="button" className="sheet-action nb-waiting" onClick={() => { setReviewOpen(false); setProposalsOpen(true); }}>
                {waitingCount === 1 ? "1 proposal waiting" : `${waitingCount} proposals waiting`} · Show
              </button>
            ))}
            aside={shownHalf === null ? null : <HalfSwitcher value={half} onChange={setHalf} hands={board.hands} />}
          />
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
          {newBoardDrawn !== null ? (
            <NewBoardKeyboard
              board={newBoardDrawn}
              mode={newBoard.step.kind === "put" ? "put" : newBoard.step.kind === "review" ? "review" : "confirm"}
              homeRow={newBoard.step.kind === "confirm" ? (newBoard.step.homeRow ?? newBoard.preview?.guessedHomeRow ?? null) : newBoard.step.kind === "review" ? newBoard.step.homeRow : null}
              mapped={newBoard.putPreview}
              placed={new Set(newBoard.step.kind === "put" && newBoard.putPreview !== null
                ? newBoard.putPreview.placements.flatMap((p) => p.blocked === undefined && p.candidates[0] !== undefined ? [newBoard.step.kind === "put" ? (newBoard.step.choices[String(p.source)] ?? p.candidates[0].target) : p.candidates[0].target] : [])
                : [])}
              onPickRow={newBoard.setHomeRow}
              half={newBoardShownHalf}
              onSwipe={newBoardShownHalf === null ? undefined : (direction) => setHalf(direction === "left" ? "right" : "left")}
            />
          ) : (
          <Keyboard
            handle={keyboard}
            colourway={tonesOf(colourway, board.display?.colourways)}
            keys={keys}
            keycaps={board.display?.keycaps}
            hands={board.hands}
            descriptions={descriptions}
            fingers={board.fingers}
            layerName={layer.name}
            selected={selected}
            current={mode === "key" && editingHere ? (editing?.position ?? null) : null}
            partners={partners}
            comboKeys={comboKeys}
            pendingIndex={editingHere && draft.binding !== null ? editing.position : null}
            {...(applied !== null && applied.layerId === layer.id ? { appliedKeys: new Set(applied.positions) } : {})}
            unsynced={unsyncedHere}
            pressSeq={pressSeq}
            shiftPx={!narrow && editing !== null && !keyOverChat ? boardLayout.shift : 0}
            part={!narrow && editing !== null && !keyOverChat ? boardLayout.part : null}
            scale={!narrow && editing !== null && !keyOverChat ? boardLayout.scale : 1}
            chatSelected={chatSelected}
            highlighted={libraryHighlight}
            marks={marks}
            remembered={remembered}
            legendOverrides={legendOverrides}
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
            comboLabels={showCombos}
            dragEnabled={placing === null && swapping === null && !comboPicking && quick === null && !chatOpen && !changing}
            onDropKey={(from, to, copy) => void dropKey(from, to, copy)}
            display={board.display}
            layerKey={layer.id}
            light={light}
            reach={reach}
            rippleFrom={rippleFrom}
            inspect={inspect}
            {...(labOpen ? { lab: labBoard } : {})}
            {...(compareThen === null ? {} : { then: compareThen })}
            review={reviewMarks}
            found={found}
            previewing={preview !== null}
          />
          )}
          <NewKeyboardCard flow={{ ...newBoard, confirmCandidate: () => {
            if (editing !== null) closeEditor(false);
            setSidebar(null);
            newBoard.confirmCandidate();
          } }} />
          <SetupCard flow={newBoard} boards={chrome.boardChoices} hasConfigs={putSources.length > 0} onImport={importForBoard} onMade={openMadeConfig} />
          {/* A phone shows one half of the new board too, with its own Left and Right, since the caption that holds them steps aside. */}
          {newBoardDrawn !== null && newBoardShownHalf !== null ? (
            <div className="nb-half"><HalfSwitcher value={half} onChange={setHalf} hands={newBoardDrawn.hands} /></div>
          ) : null}
          {/* A phone has no column: the new keyboard's questions are a sheet at the stage's foot, as the lab's read-out is (D-336). */}
          {narrow && newBoardPanel ? (
            <div className="lab-sheet nb-sheet">
              <NewBoardPanel flow={newBoard} sources={putSources} onMade={openMadeConfig} onImport={importForBoard} />
            </div>
          ) : null}
          {labOpen ? <LabStage lab={lab} boardName={boardDisplayName(board.name)} phone={narrow} onClose={() => toggleLab()} onType={labType} fixes={{ onSync: () => void sync.syncNow(summary.id), onOpenRelease: () => onOpenRelease(), onOpenInputMonitoring: openInputMonitoring }} /> : null}
          {/* A narrow screen has no column beside the board, so a past session's read-out is a sheet at the stage's foot (D-314). */}
          {labOpen && narrow && lab.phase.kind === "readout" ? (
            <div className="lab-sheet">
              <LabPanel lab={lab} heat={labHeat} onHeat={setLabHeat} onTry={(card) => setPinnedProposal(card)} onApply={labApply} onClose={() => toggleLab()} />
            </div>
          ) : null}
          {/* Kept in the layout while the bar is open, only unseen, so the board keeps the unit it rests at (P3 review). */}
          <div className="stage-floor" data-under-bar={!narrow && chatOpen && !chatPanel}>
            {/* Toasts rise from the top of the floor, so they never sit over the strip or the hint. */}
            <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} />
            <p className="stage-hint">Press a key on your {boardDisplayName(board.name)} to find it here</p>
            {/* The strip and the view controls share one row, so the strip is centred where it fits and moves aside where it doesn't. */}
            <div className="stage-floor-row">
            <LayerTabs
              layout={layout}
              selectedId={layer.id}
              onSelect={chooseLayer}
              marked={markedLayers}
              reviewed={reviewMarks.layers}
              {...(layerActions === undefined ? {} : { actions: layerActions })}
              renamingId={renamingId}
              onRenaming={setRenamingId}
              keys={keys}
              lights={layerLights}
              leds={layerLeds}
            />
            <ViewControls
              combos={{ on: showCombos, onToggle: toggleCombos }}
              inspect={{ on: inspect, onToggle: toggleInspect }}
              history={{ on: historyOpen, onToggle: toggleHistory }}
              library={{ on: libraryOpen, onToggle: toggleLibrary }}
            />
            </div>
          </div>
          <div className="stage-notes">
            {/* The toast closes by itself; this stays until a read of the layout works (R7-06). */}
            {notShownLine(notShownOn, revision.id) ? (
              <p className="place-banner not-shown" role="status">
                <RefreshCw size={16} aria-hidden="true" />
                <span>{NOT_SHOWN_LINE.words}</span>
                <button type="button" className="button" onClick={() => void onChanged().catch(showAppliedNotShown)}>{NOT_SHOWN_LINE.button}</button>
              </p>
            ) : null}
            {/* On a wide screen the bar itself says what is previewed; the banner is for the narrow sheet. */}
            {preview !== null && proposal !== null && narrow ? (
              <PreviewBanner
                title={proposal.title}
                layerName={layerName(layout, preview.layerId)}
                onStop={pinnedProposal !== null && hoveredProposal === null ? () => setPinnedProposal(null) : undefined}
              />
            ) : null}
            {swapping === null || layer === undefined ? null : (
              <p className="place-banner" role="status">
                <MousePointerClick size={16} aria-hidden="true" />
                <span>Click the key to swap with {keyIn(layout, swapping)}. You can change layer first. Escape cancels.</span>
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
          {/* A combo's card opens in the side panel, like the list it comes from (D-311). */}
          {!narrow && editing !== null && keyCard !== null && !keyOverChat ? (
            <FloatingCard stage={stageRef} position={editing.position} placeKey={`${editing.layerId}:${editing.position}:${layer.id}`} layout={boardLayout} onLayout={setBoardLayout}>
              {keyCard}
            </FloatingCard>
          ) : null}
        </section>
        <SidePanel
          mode={keyOverChat ? "key" : !narrow && (mode === "key" || mode === "chat") ? "summary" : mode}
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
                colourway={colourway}
                onColourway={setColourway}
                boardName={boardDisplayName(board.name)}
                onClose={() => setSettingsOpen(false)}
                onApplied={async (summaryText) => {
                  const shown = await readAfterApply(onChanged, showAppliedNotShown);
                  setLightingDraft(new Map());
                  if (shown) toasts.show({ kind: "success", message: "Applied", detail: summaryText });
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
              comparing !== null ? (
                <VersionCompare
                  token={token}
                  comparing={comparing}
                  layout={layout}
                  boardName={boardDisplayName(board.name)}
                  layerId={layer.id}
                  layerName={layerNameOf}
                  onBack={() => {
                    // A version that is gone may still be in the list History read earlier, so Back reads it again (PR #310 review).
                    setComparing(null);
                    history.reload();
                  }}
                  onRetry={() => void compareWith(comparing.milestone)}
                  onClose={() => setHistoryOpen(false)}
                  onShowLayer={(id) => setLayerId(id)}
                  onGoBack={() => void undo({ id: comparing.milestone.version.revisionId, summary: versionTitle(comparing.milestone.version) }, () => setComparing(null))}
                  onPutOn={() => setConfigDialog({ kind: "put-version", milestone: comparing.milestone })}
                  onNewConfig={() => setConfigDialog({ kind: "new", start: "version", version: comparing.milestone.version.id })}
                  blockedReason={undoBlock}
                />
              ) : (
                <HistoryPanel
                  token={token}
                  layout={layout}
                  versions={history.versions}
                  configName={summary.name}
                  boardName={boardDisplayName(board.name)}
                  onKeyboard={!editingOther}
                  onClose={() => setHistoryOpen(false)}
                  onReload={history.reload}
                  onGoBack={async (target) => void (await undo(target))}
                  onCompare={(milestone) => void compareWith(milestone)}
                  onPutOn={(milestone) => setConfigDialog({ kind: "put-version", milestone })}
                  onNewConfig={(milestone) => setConfigDialog({ kind: "new", start: "version", version: milestone.version.id })}
                  onName={async (milestone, name) => {
                    await nameVersion(token, layoutRef, milestone.version.id, name);
                    history.reload();
                  }}
                  blockedReason={undoBlock}
                />
              )
            ) : null
          }
          combo={
            comboDraft !== null ? comboCard : combosOpen ? (
              <ComboList layout={layout} onOpen={(combo) => openCombo(combo.id)} onHover={setHoverCombo} onClose={() => { setCombosOpen(false); setHoverCombo(null); }} onNew={newCombo} />
            ) : null
          }
          summary={null}
          key_={
            narrow || keyOverChat ? keyCard : null
          }
          chat={narrow ? chatContent : null}
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
        {/* One chat, mounted once: the bar over the stage's foot, or the panel beside the board for a conversation (D-310). A key opened
            from the panel takes its place and the conversation waits, still mounted. */}
        {newBoardPanel && !narrow ? (
          <div className="nb-column">
            <NewBoardPanel flow={newBoard} sources={putSources} onMade={openMadeConfig} onImport={importForBoard} />
          </div>
        ) : reviewShown ? (
          <div className={narrow ? "lab-sheet br-sheet" : "nb-column"}>
            <ReviewPanel
              token={token}
              review={boardReview}
              layout={layout}
              board={board}
              rows={board.rows}
              boardName={boardDisplayName(board.name)}
              configName={summary.name}
              proposals={waiting}
              pinnedId={pinnedProposal?.changeSetId ?? null}
              onPin={pinProposal}
              proposalsFailed={waitingFailed}
              // Nothing to apply until the read answers, so an Apply whose outcome was unknown can't be repeated early (#288 review).
              onReadProposals={() => { setWaiting(null); setWaitingRead((read) => read + 1); }}
              onApply={async (card) => {
                const result = await applyChangeSet(token, card.changeSetId);
                setWaitingRead((read) => read + 1);
                // The Apply landed; a layout that couldn't be read afterwards is not "nothing was applied". The panel says so beside it.
                // The panel recovers in place; the editor's line also marks the old revision once the panel closes (R7-06, PR #303 CodeRabbit).
                if (!(await onProposalApplied(card, result, () => setNotShownOn(revision.id)))) return { showAgain: onChanged };
              }}
              onShowLayer={(id) => setLayerId(id)}
                 onPlanRepair={(item) => {
                 if (repairDraft) { setRepairNotice("Finish or dismiss the existing repair request first. It has been kept."); return; }
                const words = (text: string) => reviewTextWords(text, layout, board, geometry);
                const id = crypto.randomUUID();
                onRepairDraft(id, {
                  id,
                  reviewId: boardReview.review?.id ?? "",
                  headRevisionId: boardReview.review?.revisionId ?? "",
                  findingId: item.id,
                  request: formatFindingRepairRequest({ title: words(item.title), body: words(item.body), scope: [...item.layers.map((layerId) => layerName(layout, layerId)), ...item.keys.map((key) => words(`{key:${key.layerId}:${key.position}}`))] }),
                  sent: false,
                }, true);
                setReviewOpen(false);
                setChatOpen(true);
              }}
              onClose={() => setReviewOpen(false)}
            />
          </div>
        ) : proposalsShown ? (
          // A phone has no column: the proposals are a sheet at the foot, as the lab's read-out is.
          <div className={narrow ? "lab-sheet nb-sheet" : "nb-column"}>
            <OpenProposals
              proposals={waiting}
              readFailed={waitingFailed}
              onReadAgain={() => { setWaiting(null); setWaitingRead((read) => read + 1); }}
              layout={layout}
              board={board}
              configName={summary.name}
              firstFlash={board.firmware !== "kanata" && (boardSync === undefined || boardSync.state.kind === "not_connected" || boardSync.last === null)}
              pinnedId={pinnedProposal?.changeSetId ?? null}
              onPin={pinProposal}
              onPreview={setHoveredProposal}
              onApply={async (card) => {
                const result = await applyChangeSet(token, card.changeSetId);
                setWaitingRead((read) => read + 1);
                // The Apply landed; a layout that couldn't be read afterwards is not "Apply failed" on the card (R5-08).
                await onProposalApplied(card, result);
              }}
              onClose={() => setProposalsOpen(false)}
              onPlanRecovery={(proposal, reasons) => planRecovery({ kind: "proposal", proposalId: proposal.changeSetId }, proposalContext(proposal, reasons, []))}
              onOpenRelease={() => onOpenRelease()}
              token={token}
            />
          </div>
        ) : null}
        {labPanelShown ? (
          <div className="lab-column">
            <LabPanel lab={lab} heat={labHeat} onHeat={setLabHeat} onTry={(card) => setPinnedProposal(card)} onApply={labApply} onClose={() => toggleLab()} />
          </div>
        ) : null}
        {narrow ? null : (
          <div
            className="command-bar"
            hidden={!chatOpen || keyOverChat}
            data-open={chatOpen}
            data-presentation={chatPresentation}
            style={{ "--bar-room": `${barFit.room}px` } as CSSProperties}
          >
            {chatContent}
          </div>
        )}
      </div>
      {repairNotice === null ? null : <p role="status">{repairNotice}</p>}
      <Shortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {chatActivity === null || (chatOpen && !keyOverChat) ? null : (
        <div className="chat-background-work" aria-label="Active agent request">
          <button type="button" className="button" onClick={openChat}>Show agent work</button>
          <ChatStopButton onStop={chatActivity.stop} />
        </div>
      )}
      {configDialog?.kind === "new" ? (
        <NewConfigDialog
          token={token}
          source={{ id: summary.id, name: summary.name }}
          boardId={summary.boardId}
          boardName={boardDisplayName(board.name)}
          {...(configDialog.start === undefined ? {} : { start: configDialog.start })}
          {...(configDialog.version === undefined ? {} : { version: configDialog.version })}
          onCreate={async (request) => {
            const made = await createConfig(token, request);
            toastAcross({ kind: "info", message: `Made ${made.name}`, detail: `It isn't on your ${boardDisplayName(board.name)} until you put it on.` }, true);
            chrome.onReload?.(made.id);
            return made;
          }}
          onImport={chrome.onImport}
          onClose={() => setConfigDialog(null)}
        />
      ) : configDialog?.kind === "delete" ? (
        <DeleteConfigDialog
          token={token}
          name={configDialog.config.name}
          onDelete={async () => {
            await deleteConfig(token, configDialog.config.id, configDialog.config.name);
            toasts.show({ kind: "info", message: `Deleted ${configDialog.config.name}` });
            configs.reload();
            chrome.onReload?.();
          }}
          onClose={() => setConfigDialog(null)}
        />
      ) : configDialog?.kind === "rename" ? (
        <RenameDialog
          token={token}
          current={summary.name}
          onRename={async (name) => {
            await renameConfig(token, summary.id, name);
            configs.reload();
            chrome.onReload?.();
          }}
          onClose={() => setConfigDialog(null)}
        />
      ) : configDialog?.kind === "put-on" ? (
        <ConfirmDialog
          token={token}
          title={`Put ${configDialog.target.name} on your ${boardDisplayName(board.name)}?`}
          lines={[
            // kanata has nothing to build: keyloom writes the config and kanata reloads it.
            board.firmware === "kanata"
              ? `keyloom loads ${configDialog.target.name} into kanata, the same as Apply. From then on ${configDialog.target.name} is the config your MacBook keyboard types.`
              : `keyloom builds ${configDialog.target.name} and puts it on the keyboard, the same press-and-sync as Apply. From then on ${configDialog.target.name} is the config that syncs.`,
            ...(keyboardConfig === null || keyboardConfig.id === configDialog.target.id ? [] : [`${keyboardConfig.name} comes off the keyboard. It stays here with its history, and you can put it back the same way.`]),
          ]}
          confirmLabel="Put it on"
          onConfirm={() => putOn(configDialog.target)}
          problemFor={putOnProblem(configDialog.target)}
          onClose={() => setConfigDialog(null)}
        />
      ) : configDialog?.kind === "put-version" ? (
        <ConfirmDialog
          token={token}
          title={`Put ${versionTitle(configDialog.milestone.version)} on your ${boardDisplayName(board.name)}?`}
          lines={[
            configDialog.milestone.version.revisionId === revision.id
              ? board.firmware === "kanata" ? `keyloom loads ${summary.name} as it is now, which is this version, into kanata.` : `keyloom builds ${summary.name} as it is now, which is this version, and puts it on the keyboard.`
              : board.firmware === "kanata"
                ? `keyloom goes back to this version as a new change in ${summary.name}, so auto-apply keeps it there, then loads it into kanata. The newer changes stay in History.`
                : `keyloom goes back to this version as a new change in ${summary.name}, so auto-sync keeps it there, then builds it and puts it on the keyboard. The newer changes stay in History.`,
            ...(editingOther && keyboardConfig !== null ? [`${summary.name} becomes the config on your ${boardDisplayName(board.name)}; ${keyboardConfig.name} comes off it but stays here.`] : []),
          ]}
          confirmLabel="Put it on"
          onConfirm={() => putVersionOn(configDialog.milestone)}
          problemFor={putOnProblem(summary)}
          onClose={() => setConfigDialog(null)}
        />
      ) : null}
      {unexpected === null ? null : (
        <RestartDialog token={token} title={unexpected.title ?? "keyloom couldn't make that change"} failure={unexpected.failure} {...(unexpected.retry === undefined ? {} : { onRetry: unexpected.retry })} onClose={() => setUnexpected(null)} />
      )}
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
    </AfterApplyContext.Provider>
  );
}

// A proposal title is a phrase; the toast puts a sentence after it.
const withStop = (text: string): string => (/[.!?]$/.test(text.trim()) ? text : `${text}.`);
