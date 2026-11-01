import { Activity, ArrowRightLeft, Cpu, Ellipsis, Keyboard, MessageSquare, MessagesSquare, Plus, ScrollText, SquarePen } from "lucide-react";
import { Menu } from "../shell/Menu.tsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ApplyResponse, ChatPresentation, ChatSelection, ProposalCard } from "../../api/http.ts";
import type { Slot } from "../../layout/change.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { applyChangeSet } from "../api-write.ts";
import { DecisionsView } from "../decisions/DecisionsView.tsx";
import { OutcomeQuestions } from "../decisions/OutcomeQuestions.tsx";
import { useDecisions, useOutcomeQuestions } from "../decisions/useDecisions.ts";
import type { Command } from "./commands.ts";
import { ChatStopButton, Composer, type SelectedKeys } from "./Composer.tsx";
import { AgentMotionToggle } from "./AgentWorking.tsx";
import { ConversationList } from "./ConversationList.tsx";
import { EmptyChat, MissingKey, ProblemNotice } from "./ChatStates.tsx";
import { ProviderPicker } from "./ProviderPicker.tsx";
import { chooseProvider } from "./api-chat.ts";

const PROVIDER_NAMES = { anthropic: "Anthropic", openrouter: "OpenRouter", codex: "Codex" } as const;
import { keyLabel, layerName } from "./proposal-facts.ts";
import { ProposalCard as ProposalCardView } from "./ProposalCard.tsx";
import { AssistantMessage, UserMessage } from "./Turns.tsx";
import { madeConfigs } from "../configs/agent-made-configs.ts";
import { useConfigCards } from "../configs/useConfigCards.ts";
import type { ConfigCards } from "./ConfigCards.tsx";
import { useChat, type ChatDrafts, type OpenRequestedView } from "./useChat.ts";
import type { ViewResult } from "../../api/open-view.ts";
import { CarriedThreadView, type CarriedThread } from "./CarriedThread.tsx";
import { referableProposals, referenceView, type ReferenceContext } from "./reference-view.ts";
import type { Reference } from "../../layout/references.ts";
import { openProposalsOnBoard, questionOpen, withoutRepeats, type Turn } from "./transcript.ts";
import { createOneShot, sendOnce, type OneShot } from "./one-shot.ts";
import { REVIEW_FIX_REQUEST } from "../../api/review.ts";
import { useProviderStatus } from "./useProviderStatus.ts";
import { activeProviderReady } from "./provider-ready.ts";
import "./chat.css";
import "./command-bar.css";

interface Props {
  beginViewRequest?: () => OpenRequestedView;
  /** "bar" is the command bar at the stage's foot (P3); "panel" the bottom sheet on a narrow screen. */
  variant?: "bar" | "panel";
  /** Closes the bar (Esc does too). */
  onClose?: () => void;
  /** A short window: the bar folds to one line, the option and Apply, or the input (bar-fit.ts). */
  collapsed?: boolean;
  /**
   * Told where the conversation should be read (D-310): "bar" for a quick ask and its short answer, or the folded line; "panel" once a
   * reply runs past a line or two, so it reads top to bottom at full height beside the board.
   */
  onPresentation?: (presentation: "bar" | "panel") => void;
  /** On a phone the chat is the bottom sheet: the conversation panel's design, always (P5). */
  sheet?: boolean;
  token: string;
  layoutRef: string;
  /** Human-facing config name when supplied by the shell; old callers retain the config reference. */
  configName?: string;
  /** Keep a reachable Stop in the shell when this still-mounted conversation is hidden. */
  onActivity?: (activity: { stop: () => void } | null) => void;
  layout: Layout;
  board: BoardDefinition;
  /** The head the page shows; a new one means a change was applied and the decisions may have changed. */
  revisionId: string;
  /** Lights the keys of the decision being pointed at in the decisions view. */
  onHighlightDecision: (slots: Slot[] | null) => void;
  /** The keys the person clicked on the board, sent with the next message (D-012). */
  selection: ChatSelection | null;
  onRemoveKey: (position: number) => void;
  /** Opens a chip's key in the key panel. */
  onOpenKey?: (position: number) => void;
  onClearSelection: () => void;
  /** Puts a selection back after a message was refused, so pointing at keys isn't lost with it. */
  onRestoreSelection: (selection: ChatSelection) => void;
  pinnedId: string | null;
  onPreview: (proposal: ProposalCard | null) => void;
  onPin: (proposal: ProposalCard) => void;
  /** Called once the server has applied a proposal, to refresh the board; resolves when it has. */
  onApplied: (proposal: ProposalCard, result: ApplyResponse) => Promise<void>;
  onOpenRelease: () => void;
  /** The thread on screen before a board or config switch (D-317), shown read-only above this layout's own. */
  initialConversation?: string | undefined;
  continueCopy?: boolean | undefined;
  /** A fresh id when the shell asks the chat to start one run that fixes what the board review found (D-461). */
  fixRequest?: string | undefined;
  onContinueCopy?: (handoff: NonNullable<ChatPresentation["handoff"]>) => void;
  carried?: CarriedThread | null;
  /** Explicit New discards the read-only thread carried from another board, not its saved history. */
  onClearCarried?: () => void;
  /** Told of every change to the thread, so a switch can carry it (D-317). */
  onTurns?: (turns: readonly Turn[]) => void;
  /** A reply this chat sent and watched complete (never one replayed from history, a reload or another config's thread), with the thread as it now reads. */
  onReplyCompleted?: (presentation: ChatPresentation, turns: readonly Turn[]) => void;
  /** Opens a config from its card in a reply, carrying this thread along (D-317). */
  onOpenConfig?: (id: string) => void;
  /** Shows the proposals waiting on this config, from a config card's "Review". */
  onReviewProposals?: () => void;
  /** Shows a layer a reply named (D-468), keeping an open key's draft as the layer strip does. */
  onShowLayer?: (layerId: string) => void;
  /** Pulses one key a reply named (D-468), so it can be found on the board. */
  onFoundKey?: (position: number) => void;
  /** The names of the configs this page can open, so a reply's `{config:…}` marker draws the name it already knows. */
  configNames?: ReadonlyMap<string, string>;
  /** Key changes kept on the board and not applied (D-317); sent with each message so the agent knows them. */
  drafts?: ChatDrafts;
  /** ⌘K commands (D-315): what the typed text can just do, offered above "Ask keyloom". */
  commands?: { find: (text: string) => Command[]; run: (command: Command) => void };
}

const ASK_AGAIN = "The layout changed after you proposed that, so it no longer applies. Please propose it again against the current layout.";
// A page that hands in no config names still reads a marker as words: the id it carries.
const NO_NAMES: ReadonlyMap<string, string> = new Map();
// Within this distance of the end, new text keeps the log pinned to the bottom; scrolled further up, it stays put.
const STICK_PX = 48;

export function ChatPanel({ beginViewRequest, variant = "panel", onClose, collapsed = false, onPresentation, sheet = false, token, layoutRef, configName, onActivity, layout, board, revisionId, onHighlightDecision, selection, onRemoveKey, onOpenKey, onClearSelection, onRestoreSelection, pinnedId, onPreview, onPin, onApplied, onOpenRelease, commands, drafts = [], initialConversation, continueCopy, fixRequest, onContinueCopy, carried: carriedIn = null, onClearCarried, onTurns, onReplyCompleted, onOpenConfig, onReviewProposals, onShowLayer, onFoundKey, configNames }: Props) {
  const beginView = useRef<() => OpenRequestedView>(() => async () => ({ version: 1, status: "unavailable", reason: "unsupported" }));
  const chat = useChat(token, layoutRef, onContinueCopy, initialConversation, beginViewRequest === undefined ? undefined : () => beginView.current());
  const arrived = useRef(false);
  useEffect(() => {
    if (initialConversation === undefined || arrived.current) return;
    arrived.current = true;
    void chat.open(initialConversation).then((error) => {
      if (error === null && continueCopy) void chat.send("Continue adapting the copied setup.", null);
    });
  }, [initialConversation, continueCopy, chat.open, chat.send]);
  // Fix issues (D-461): one new conversation on this config with the fixed request, once per id. A question open in the old conversation
  // is left alone on the server; nothing here answers it or closes it.
  const fixGuard = useRef<OneShot | null>(null);
  fixGuard.current ??= createOneShot();
  const fixOnce = fixGuard.current;
  useEffect(() => {
    sendOnce(fixOnce, fixRequest, () => {
      chat.newConversation();
      void chat.send(REVIEW_FIX_REQUEST, null);
    });
  }, [fixRequest, fixOnce, chat.newConversation, chat.send]);
  const provider = useProviderStatus(token);
  const { transcript, streaming } = chat;
  // Coming back to the config a thread was about, its own conversation is found again here: show each reply once.
  const carried = useMemo(() => {
    if (carriedIn === null) return null;
    const turns = withoutRepeats(carriedIn.turns, transcript.turns);
    return turns.length === 0 ? null : { ...carriedIn, turns };
  }, [carriedIn, transcript.turns]);
  useEffect(() => {
    onActivity?.(streaming ? { stop: chat.stop } : null);
    return () => onActivity?.(null);
  }, [streaming, chat.stop, onActivity]);
  // The config cards under replies that made configs; their data is read once for the whole thread.
  const madeIds = useMemo(
    () => [...(carried?.turns ?? []), ...transcript.turns].flatMap((turn) => (turn.kind === "assistant" ? madeConfigs(turn.presentation).map((made) => made.id) : [])),
    [carried, transcript.turns],
  );
  const cardData = useConfigCards(token, madeIds, `${layoutRef}:${revisionId}`);
  const configCards: ConfigCards | undefined = onOpenConfig === undefined ? undefined : { data: cardData, currentId: layoutRef, origin: carried?.from ?? null, onOpen: onOpenConfig, onReview: onReviewProposals ?? (() => {}) };
  // What a reply's own markers can go to (D-468): the configs this page can open, and the proposals of the thread on screen, each
  // through the seam the cards already use. A carried thread's layers, keys and proposals belong to another config, so only a config
  // it names stays live there — unless the thread is about this very config again, when everything it named still exists on the page.
  const carriedForeign = carried === null || carried.from === undefined || carried.from.id !== layoutRef;
  const proposals = useMemo(
    () => referableProposals(transcript.turns, carriedForeign ? null : carried?.turns ?? null),
    [transcript.turns, carried, carriedForeign],
  );
  const referenceContext = useMemo<ReferenceContext>(
    () => ({
      layout, currentId: layoutRef, configNames: configNames ?? NO_NAMES, proposals,
      actions: {
        ...(onOpenConfig === undefined ? {} : { onOpenConfig }),
        onPin,
        ...(onShowLayer === undefined ? {} : { onShowLayer }),
        ...(onFoundKey === undefined ? {} : { onFoundKey }),
      },
    }),
    [layout, layoutRef, configNames, proposals, onOpenConfig, onPin, onShowLayer, onFoundKey],
  );
  const drawReference = useCallback((reference: Reference) => referenceView(reference, referenceContext), [referenceContext]);
  const drawCarriedReference = useCallback(
    (reference: Reference) => referenceView(reference, carriedForeign ? { ...referenceContext, foreign: true } : referenceContext),
    [referenceContext, carriedForeign],
  );
  const [draft, setDraft] = useState("");
  const [motionPaused, setMotionPaused] = useState(false);
  // The command rows for what's typed. Enter runs the highlighted one; a short text highlights the first command, a longer one (a
  // question that happens to say "test") highlights "Ask keyloom", so a real question is never swallowed by a command.
  const findCommands = commands?.find;
  const commandRows = useMemo(() => (findCommands === undefined || selection !== null ? [] : findCommands(draft)), [findCommands, draft, selection]);
  const shortText = draft.trim().split(/\s+/).length <= 6;
  const [commandAt, setCommandAt] = useState(0);
  useEffect(() => setCommandAt(shortText ? 0 : commandRows.length), [commandRows, shortText]);
  const runCommand = (command: Command) => {
    setDraft("");
    commands?.run(command);
  };
  const onCommandKey = (key: string): boolean => {
    if (commandRows.length === 0) return false;
    if (key === "ArrowDown") setCommandAt((i) => Math.min(commandRows.length, i + 1));
    else if (key === "ArrowUp") setCommandAt((i) => Math.max(0, i - 1));
    else {
      const chosen = commandRows[commandAt];
      if (chosen === undefined) return false;
      runCommand(chosen);
    }
    return true;
  };
  const [view, setView] = useState<"chat" | "history" | "decisions">("chat");
  const [decisionRequest, setDecisionRequest] = useState<{ signal: AbortSignal; resolve: (result: ViewResult) => void; already: boolean } | null>(null);
  const viewNow = useRef(view);
  const viewEpoch = useRef(0);
  const draftNow = useRef(draft);
  useLayoutEffect(() => {
    if (viewNow.current !== view) viewEpoch.current++;
    viewNow.current = view;
    draftNow.current = draft;
  }, [view, draft]);
  const composerEpoch = useRef(0);
  useLayoutEffect(() => { beginView.current = () => {
    const shell = beginViewRequest?.();
    let expected = viewEpoch.current;
    const composerAtSend = composerEpoch.current;
    return async (destination, signal) => {
      if (signal.aborted) return { version: 1, status: "unavailable", reason: "cancelled" };
      if (draftNow.current.trim() !== "" || drafts.length > 0 || composerEpoch.current !== composerAtSend) return { version: 1, status: "unavailable", reason: "draft" };
      if (viewEpoch.current !== expected) return { version: 1, status: "unavailable", reason: "moved" };
      const opened = await shell?.(destination, signal) ?? { version: 1, status: "unavailable", reason: "unsupported" };
      if (opened.status === "unavailable" || destination !== "decisions") return opened;
      if (signal.aborted) return { version: 1, status: "unavailable", reason: "cancelled" };
      const result = await new Promise<ViewResult>((resolve) => {
        const abort = () => resolve({ version: 1, status: "unavailable", reason: "cancelled" });
        signal.addEventListener("abort", abort, { once: true });
        setDecisionRequest({ signal, already: opened.status === "already-open" && viewNow.current === "decisions", resolve: (value) => { signal.removeEventListener("abort", abort); resolve(value); } });
        setView("decisions");
      });
      expected = viewEpoch.current;
      return result;
    };
  }; });
  useLayoutEffect(() => {
    if (!decisionRequest) return;
    decisionRequest.resolve(decisionRequest.signal.aborted ? { version: 1, status: "unavailable", reason: "cancelled" } : view === "decisions" ? { version: 1, status: decisionRequest.already ? "already-open" : "opened" } : { version: 1, status: "unavailable", reason: "moved" });
    setDecisionRequest(null);
  }, [decisionRequest, view]);
  useEffect(() => () => decisionRequest?.resolve({ version: 1, status: "unavailable", reason: "cancelled" }), [decisionRequest]);
  const [modelOpen, setModelOpen] = useState(false);
  // Bumped when the chat moves between the bar and the panel: the log has a new height, so where it rests is worked out again.
  const [placed, setPlaced] = useState(0);
  const decisions = useDecisions(token, layoutRef, revisionId, view === "decisions");
  const outcomes = useOutcomeQuestions(token, layoutRef);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Where the log was last scrolled to put a card in view. Text that arrives after the card (a closing line) pushes the card down, and while
  // the person has not moved the log since, it is put back (D-452: the proposal and its Apply are what the reply is for).
  const placedAt = useRef<number | null>(null);
  const wasStreaming = useRef(false);

  const chips = useMemo<SelectedKeys | null>(
    () =>
      selection === null
        ? null
        : {
            layerName: layerName(layout, selection.layerId),
            keys: selection.positions.map((position) => ({ position, label: keyLabel(layout, { layerId: selection.layerId, position }) })),
          },
    [layout, selection],
  );

  function send(text: string) {
    const message = text.trim();
    if (message === "" || streaming) return;
    stick.current = true;
    setDraft("");
    onClearSelection();
    // A refusal before the reply starts puts the words back, so nothing the person typed is lost.
    void chat.send(message, selection, (restored) => {
      setDraft((current) => (current === "" ? restored : current));
      if (selection !== null) onRestoreSelection(selection);
    }, drafts);
    input.current?.focus();
  }

  // Follows the reply as it streams unless the person has scrolled up to read. Once the newest reply
  // has proposals or an open question, it stops at the first card instead, so the options are read from the top.
  useEffect(() => {
    const element = log.current;
    if (element === null) return;
    const ours = placedAt.current !== null && Math.abs(element.scrollTop - placedAt.current) < 2;
    if (!stick.current && !ours) return;
    const active = document.activeElement;
    if (active !== null && active.closest(".agent-work-disclosure") !== null && element.contains(active)) return;
    const replies = element.querySelectorAll<HTMLElement>(".msg-assistant");
    const reply = replies[replies.length - 1];
    const attention = reply?.querySelector<HTMLElement>(".ask-card:not(.ask-card-done), .chat-problem-inline") ?? undefined;
    const firstCard = attention ?? reply?.querySelector<HTMLElement>(".proposal-group");
    if (firstCard) {
      const view = element.getBoundingClientRect();
      const at = (el: HTMLElement) => element.scrollTop + el.getBoundingClientRect().top - view.top - 8;
      const cardTop = at(firstCard);
      if (variant === "bar") {
        // The bar reads as comp d: the person's own message, then the reply with its option. When both don't fit, the option and its
        // Apply win: it scrolls down until the card's foot is in view, but never past the card's top.
        const asked = [...element.querySelectorAll<HTMLElement>(".msg-user")].at(-1);
        const cardBottom = cardTop + firstCard.getBoundingClientRect().height + 16;
        const start = asked === undefined ? cardTop : at(asked);
        element.scrollTop = Math.min(cardTop, Math.max(start, cardBottom - element.clientHeight));
        placedAt.current = element.scrollTop;
      } else {
        // The final answer leads a successful turn; a question or failure still takes priority. When the answer and its proposal don't both
        // fit, the proposal and its Apply win, as in the bar (D-452: the card is what a short reply is for).
        const cardBottom = cardTop + firstCard.getBoundingClientRect().height + 16;
        element.scrollTop = attention !== undefined || reply === undefined ? cardTop : Math.min(cardTop, Math.max(at(reply), cardBottom - element.clientHeight));
        placedAt.current = element.scrollTop;
      }
      stick.current = false;
      return;
    }
    // In the bar, the person's own message stays above the reply when both fit (comp d); otherwise the newest words win.
    const asked = variant === "bar" ? [...element.querySelectorAll<HTMLElement>(".msg-user")].at(-1) : undefined;
    if (asked !== undefined) {
      const top = element.scrollTop + asked.getBoundingClientRect().top - element.getBoundingClientRect().top - 8;
      if (element.scrollHeight - top <= element.clientHeight) {
        element.scrollTop = top;
        return;
      }
    }
    element.scrollTop = element.scrollHeight;
  }, [transcript.turns, chat.problem, view, placed]);

  // Whether the log scrolls: then the sticky foot sits over the reply, and what passes under it fades (command-bar.css).
  useEffect(() => {
    const element = log.current;
    if (element === null) return;
    const mark = () => {
      element.dataset.overflow = String(element.scrollHeight > element.clientHeight + 1);
    };
    mark();
    const observer = new ResizeObserver(mark);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [transcript.turns, view]);

  // The Stop button leaves the page when the reply ends; hand focus back to the box instead of dropping it.
  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      const active = document.activeElement;
      if (active === null || active === document.body) input.current?.focus();
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  // In the bar, a reply with options shows the first one on the board at once; the tabs switch between them (comp d).
  const newest = transcript.turns.at(-1);
  const activeOperation = newest?.kind === "assistant" ? newest.presentation?.operations.findLast((operation) => operation.status === "running") : undefined;
  const announcement = streaming ? activeOperation?.label ?? "keyloom is replying" : newest?.kind === "assistant" && questionOpen(newest) ? "keyloom needs your answer" : "";
  const newestOpen = openProposalsOnBoard(transcript.turns);
  const revised = useMemo(() => new Set(transcript.turns.flatMap((turn) => (turn.kind === "assistant" ? turn.proposals.flatMap((proposal) => (proposal.supersedes ? [proposal.supersedes] : [])) : []))), [transcript.turns]);
  const newestKey = newestOpen.map((proposal) => proposal.changeSetId).join(",");
  useEffect(() => {
    if (variant !== "bar" || newestOpen.length === 0) return;
    if (newestOpen.some((proposal) => proposal.changeSetId === pinnedId)) return;
    const first = newestOpen[0];
    if (first !== undefined) onPin(first);
    // Only when a new set of options arrives; the person's own choice of tab is not overridden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, newestKey]);

  const apply = useCallback(
    async (proposal: ProposalCard) => {
      const result = await applyChangeSet(token, proposal.changeSetId);
      chat.markApplied(proposal.changeSetId);
      // The apply is done; a failed refresh must not read as a failed apply.
      await onApplied(proposal, result).catch(() => {});
    },
    [token, chat.markApplied, onApplied],
  );

  function showHistory() {
    setView("history");
    void chat.loadHistory();
  }

  // The keys of a decision are only lit while its list is open.
  useEffect(() => {
    if (view !== "decisions") onHighlightDecision(null);
  }, [view, onHighlightDecision]);

  const empty = transcript.turns.length === 0;
  // After the render that holds the finished reply, so what the parent carries along is the whole reply, not the one before its last words.
  const liveCompleted = chat.liveCompleted;
  useEffect(() => {
    if (liveCompleted !== null) onReplyCompleted?.(liveCompleted.presentation, transcript.turns);
    // Once per finished reply; the callback and the turns are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCompleted]);
  useEffect(() => {
    onTurns?.(transcript.turns);
    // The callback is the parent's setter through a ref; only the turns matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript.turns]);
  // A new conversation can't start without a credential for the provider it would use, so say so before anything is typed.
  // A conversation already going keeps working on its own provider.
  const status = provider.status;
  const activeReady = activeProviderReady(status);
  const needsModel = status !== null && transcript.pinned === null && !activeReady;
  const retryDraft = draft.trim() === "" ? undefined : () => send(draft);
  // A conversation keeps its provider, so switching after an account failure starts a new one with the failed message back in the box.
  const usedProvider = transcript.pinned?.provider ?? status?.active?.provider;
  const readyOthers = (status?.providers ?? []).filter((p) => p.ready && p.id !== usedProvider).map((p) => ({ id: p.id, name: PROVIDER_NAMES[p.id] }));
  const switchProvider = (id: string) => {
    const lastAsked = transcript.turns.findLast((turn) => turn.kind === "user");
    void chooseProvider(token, { provider: id as keyof typeof PROVIDER_NAMES }).then((next) => {
      provider.replace(next);
      chat.newConversation();
      setView("chat");
      setDraft(lastAsked?.kind === "user" ? lastAsked.text : "");
      input.current?.focus();
    }, () => {});
  };

  const newConversation = () => {
    if (streaming) return;
    chat.newConversation();
    onClearCarried?.();
    setView("chat");
    input.current?.focus();
  };
  // New, Conversations, Decisions and the model, folded into one ⋯ (P3 review): the bar's chrome stays quiet.
  const barMenu =
    variant !== "bar" ? null : (
      <Menu trigger={<Ellipsis size={16} aria-hidden="true" />} label="More" align="end" triggerClassName="bar-more">
        {(close) => (
          <>
            <button type="button" role="menuitem" className="menu-item" disabled={streaming} onClick={() => { close(); newConversation(); }}>
              <SquarePen size={14} aria-hidden="true" />
              <span className="menu-item-label">New conversation</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); showHistory(); }}>
              <MessagesSquare size={14} aria-hidden="true" />
              <span className="menu-item-label">Conversations</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); setView("decisions"); }}>
              <ScrollText size={14} aria-hidden="true" />
              <span className="menu-item-label">Decisions</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); setModelOpen(true); }}>
              <Cpu size={14} aria-hidden="true" />
              <span className="menu-item-label">Model…</span>
            </button>
          </>
        )}
      </Menu>
    );
  const escape = () => onClose?.();
  const newestFailed = newest?.kind === "assistant" && newest.failure !== null;
  // Anything that needs reading or a choice opens the bar over the board even in a short window; the folded line is for the common
  // case, an option to apply or a message to type.
  const lineProposal = newestOpen.find((proposal) => proposal.changeSetId === pinnedId) ?? newestOpen[0];
  // ⌘K opens in the side column from the first keystroke (D-318): a bar at the stage's foot covered the layer strip and made a
  // conversation scroll in a few lines while the sides stood empty (BK, 2026-10-16). The phone keeps its bottom sheet.
  const presentation: "bar" | "panel" = sheet || variant === "bar" ? "panel" : "bar";
  // The folded line existed only to keep the foot bar off a short board; the side column doesn't cover the board, so it never folds.
  const folded = presentation === "bar" && collapsed && view === "chat" && !needsModel && chat.problem === null && !newestFailed && !streaming && (lineProposal !== undefined || empty);
  useEffect(() => {
    if (variant === "bar" && !sheet) onPresentation?.(presentation);
    // The panel is laid out after this render; rest the log once it has its height.
    const frame = window.requestAnimationFrame(() => {
      stick.current = true;
      setPlaced((count) => count + 1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [variant, presentation, onPresentation]);

  return (
    <section className="chat" data-streaming={streaming} data-variant={variant} data-presentation={variant === "bar" ? presentation : undefined} data-folded={folded} data-overlap={variant === "bar" && collapsed && !folded && presentation === "bar"} aria-label="Ask keyloom">
      {variant === "bar" ? (
        // The model surfaces only from the menu or when it fails (P3 review); its picker opens above the bar.
        <ProviderPicker token={token} status={provider.status} pinned={transcript.pinned} onChanged={provider.replace} menuOpened={{ open: modelOpen, onClose: () => setModelOpen(false) }} />
      ) : null}
      <header className="chat-head" hidden={variant === "bar"}>
        <h2>Chat</h2>
        <button
          type="button"
          className="button chat-new"
          disabled={streaming}
          onClick={newConversation}
        >
          <SquarePen size={14} aria-hidden="true" />
          New
        </button>
        <div className="chat-head-actions">
          <button type="button" className="button" aria-pressed={view === "decisions"} onClick={() => setView(view === "decisions" ? "chat" : "decisions")}>
            <ScrollText size={14} aria-hidden="true" />
            Decisions
          </button>
          <button type="button" className="button" aria-pressed={view === "history"} onClick={() => (view === "history" ? setView("chat") : showHistory())}>
            <MessagesSquare size={14} aria-hidden="true" />
            Conversations
          </button>
        </div>
      </header>

      {view === "chat" && variant !== "bar" ? <ProviderPicker token={token} status={provider.status} pinned={transcript.pinned} onChanged={provider.replace} /> : null}
      {view !== "chat" ? null : <div className="chat-context"><p>Editing {board.name} · {configName ?? layoutRef}</p>{streaming ? <AgentMotionToggle paused={motionPaused} onChange={setMotionPaused} /> : null}</div>}

      {view === "decisions" ? (
        <DecisionsView
          state={decisions.state}
          layout={layout}
          onBack={() => setView("chat")}
          onReload={decisions.reload}
          onHighlight={onHighlightDecision}
          onEdit={decisions.edit}
          onRetire={decisions.retire}
          onOpenConversation={async (id) => {
            const error = await chat.open(id);
            if (error === null) setView("chat");
            return error;
          }}
        />
      ) : view === "history" ? (
        <ConversationList
          history={chat.history}
          currentId={transcript.conversationId}
          onBack={() => setView("chat")}
          onReload={() => void chat.loadHistory()}
          onOpen={async (id) => {
            const error = await chat.open(id);
            if (error === null) setView("chat");
            return error;
          }}
        />
      ) : folded && lineProposal !== undefined ? (
        <div className="bar-line">
          <ProposalCardView
            proposal={lineProposal}
            layout={layout}
            board={board}
            pinned={lineProposal.changeSetId === pinnedId}
            onPreview={onPreview}
            onPin={onPin}
            onApply={apply}
            onAskAgain={() => send(ASK_AGAIN)}
            onOpenRelease={onOpenRelease}
            compact
            line
          />
          {barMenu}
          <button type="button" className="bar-esc" onClick={escape} aria-label="Close (Esc)">esc</button>
        </div>
      ) : (
        <>
          <p className="sr-only" role="status">{announcement}</p>
          {folded ? null : <OutcomeQuestions questions={outcomes.questions} onAnswer={outcomes.answer} />}
          <div
            hidden={folded}
            ref={log}
            className="chat-log"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={streaming}
            aria-label="Conversation"
            tabIndex={0}
            onScroll={(event) => {
              const el = event.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
              if (placedAt.current !== null && Math.abs(el.scrollTop - placedAt.current) >= 2) placedAt.current = null;
            }}
          >
            {needsModel && chat.problem === null && variant === "bar" && status.providers.some((candidate) => candidate.ready) ? (
              // In the bar, a provider that is ready is one click away; setting up the chosen one is the fallback (comp d2).
              <div className="bar-needs-model">
                <p>
                  <b>{PROVIDER_NAMES[status.active?.provider ?? "anthropic"]} isn&apos;t set up.</b> Use one that is ready, or set it up and restart keyloom.
                </p>
                <div className="bar-ready">
                  {status.providers
                    .filter((candidate) => candidate.ready)
                    .map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        className="bar-ready-choice"
                        onClick={() => void chooseProvider(token, { provider: candidate.id }).then(provider.replace, () => {})}
                      >
                        Use {PROVIDER_NAMES[candidate.id]}
                        <span>{candidate.defaultModel}</span>
                      </button>
                    ))}
                </div>
              </div>
            ) : needsModel && chat.problem === null ? (
              <MissingKey providers={status.providers} onRetry={provider.reload} retryLabel="Check again" />
            ) : empty && chat.problem === null && carried === null ? (
              <EmptyChat
                onPick={(prompt) => {
                  setDraft(prompt);
                  input.current?.focus();
                }}
              />
            ) : (
              <>
              {carried === null ? null : <CarriedThreadView thread={carried} boardName={board.name.replace(/ keyboard \(ANSI\)$/, "")} {...(configCards === undefined ? {} : { configCards })} reference={drawCarriedReference} />}
              {transcript.turns.map((turn) =>
                turn.kind === "user" ? (
                  <UserMessage
                    key={turn.id}
                    turn={turn}
                    layout={layout}
                    onSelectKeys={onRestoreSelection}
                  />
                ) : (
                  <AssistantMessage
                    key={turn.id}
                    turn={turn}
                    layout={layout}
                    board={board}
                    pinnedId={pinnedId}
                    onPreview={onPreview}
                    onPin={onPin}
                    onApply={apply}
                    onRemovePriority={chat.removePriority}
                    onAskAgain={() => send(ASK_AGAIN)}
                    onOpenRelease={onOpenRelease}
                    onRetry={() => void chat.retry()}
                    onAnswer={(toolUseId, text) => void chat.answer(toolUseId, text)}
                    busy={streaming}
                    switchTo={readyOthers}
                    onSwitch={switchProvider}
                    compact={variant === "bar"}
                    motionPaused={motionPaused}
                    revised={revised}
                    reference={drawReference}
                    {...(configCards === undefined ? {} : { configCards })}
                  />
                ),
              )}
              </>
            )}
            {chat.problem === null ? null : <ProblemNotice problem={chat.problem} providers={provider.status?.providers ?? []} onRetry={retryDraft} onDismiss={chat.dismissProblem} />}
          </div>
          {commandRows.length === 0 ? null : (
            <ul className="bar-commands" role="listbox" aria-label="Commands">
              {commandRows.map((command, i) => (
                <li key={`${command.kind}:${"id" in command ? command.id : ""}`} role="option" aria-selected={commandAt === i}>
                  <button type="button" className="bar-command" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setCommandAt(i)} onClick={() => runCommand(command)}>
                    <CommandIcon kind={command.kind} />
                    <span className="bar-command-label">{command.label}</span>
                    <span className="bar-command-detail">{command.detail}</span>
                    {commandAt === i ? <kbd className="bar-command-key">↵</kbd> : null}
                  </button>
                </li>
              ))}
              <li role="option" aria-selected={commandAt === commandRows.length}>
                <button type="button" className="bar-command" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setCommandAt(commandRows.length)} onClick={() => send(draft)}>
                  <MessageSquare size={14} aria-hidden="true" />
                  <span className="bar-command-label">Ask keyloom</span>
                  <span className="bar-command-detail">“{draft.trim()}”</span>
                  {commandAt === commandRows.length ? <kbd className="bar-command-key">↵</kbd> : null}
                </button>
              </li>
            </ul>
          )}
          {drafts.length === 0 ? null : (
            // Said, so BK knows what the agent is told besides his words (D-317).
            <p className="composer-drafts">
              {drafts.length === 1 ? "Your draft on " : "Your drafts on "}
              {drafts.map((d) => keyLabel(layout, { layerId: d.layerId, position: d.position })).join(", ")} {drafts.length === 1 ? "goes" : "go"} with your message, not applied yet.
            </p>
          )}
          <Composer
            onCommandKey={onCommandKey}
            value={draft}
            onChange={(text) => { composerEpoch.current++; setDraft(text); }}
            onSend={() => send(draft)}
            onStop={chat.stop}
            streaming={streaming}
            selection={chips}
            onRemoveKey={onRemoveKey}
            {...(onOpenKey === undefined ? {} : { onOpenKey })}
            onClearSelection={onClearSelection}
            inputRef={input}
            blockedReason={needsModel ? (variant === "bar" ? null : "Set up a model above before sending a message.") : null}
            {...(variant === "bar" ? { quiet: { onEscape: escape, menu: barMenu, placeholder: empty ? "Describe what isn't working" : "Reply, or ask for something else" } } : {})}
          />
        </>
      )}
      {view === "chat" || !streaming ? null : <div className="chat-stop-footer"><span>Working on {board.name}</span><ChatStopButton onStop={chat.stop} /></div>}
    </section>
  );
}

function CommandIcon({ kind }: { kind: Command["kind"] }) {
  const Icon = kind === "lab" ? Activity : kind === "new-config" ? Plus : kind === "switch" ? ArrowRightLeft : Keyboard;
  return <Icon size={14} aria-hidden="true" />;
}
