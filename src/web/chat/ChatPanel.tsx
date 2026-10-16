import { Activity, ArrowRightLeft, Cpu, Ellipsis, Keyboard, MessageSquare, MessagesSquare, Plus, ScrollText, SquarePen } from "lucide-react";
import { Menu } from "../shell/Menu.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyResponse, ChatSelection, ProposalCard } from "../../api/http.ts";
import type { Slot } from "../../layout/change.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { applyChangeSet } from "../api-write.ts";
import { DecisionsView } from "../decisions/DecisionsView.tsx";
import { OutcomeQuestions } from "../decisions/OutcomeQuestions.tsx";
import { useDecisions, useOutcomeQuestions } from "../decisions/useDecisions.ts";
import type { Command } from "./commands.ts";
import { Composer, type SelectedKeys } from "./Composer.tsx";
import { ConversationList } from "./ConversationList.tsx";
import { EmptyChat, MissingKey, ProblemNotice } from "./ChatStates.tsx";
import { ProviderPicker } from "./ProviderPicker.tsx";
import { chooseProvider } from "./api-chat.ts";

const PROVIDER_NAMES = { anthropic: "Anthropic", openrouter: "OpenRouter", codex: "Codex" } as const;
import { keyLabel, layerName } from "./proposal-facts.ts";
import { ProposalCard as ProposalCardView } from "./ProposalCard.tsx";
import { AssistantMessage, UserMessage } from "./Turns.tsx";
import { useChat, type ChatDrafts } from "./useChat.ts";
import { CarriedThreadView, type CarriedThread } from "./CarriedThread.tsx";
import type { Turn } from "./transcript.ts";
import { useProviderStatus } from "./useProviderStatus.ts";
import "./chat.css";
import "./command-bar.css";

interface Props {
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
  carried?: CarriedThread | null;
  /** Told of every change to the thread, so a switch can carry it (D-317). */
  onTurns?: (turns: readonly Turn[]) => void;
  /** Key changes kept on the board and not applied (D-317); sent with each message so the agent knows them. */
  drafts?: ChatDrafts;
  /** ⌘K commands (D-315): what the typed text can just do, offered above "Ask keyloom". */
  commands?: { find: (text: string) => Command[]; run: (command: Command) => void };
}

const ASK_AGAIN = "The layout changed after you proposed that, so it no longer applies. Please propose it again against the current layout.";
// Within this distance of the end, new text keeps the log pinned to the bottom; scrolled further up, it stays put.
const STICK_PX = 48;

export function ChatPanel({ variant = "panel", onClose, collapsed = false, onPresentation, sheet = false, token, layoutRef, layout, board, revisionId, onHighlightDecision, selection, onRemoveKey, onOpenKey, onClearSelection, onRestoreSelection, pinnedId, onPreview, onPin, onApplied, onOpenRelease, commands, drafts = [], carried = null, onTurns }: Props) {
  const chat = useChat(token, layoutRef);
  const provider = useProviderStatus(token);
  const { transcript, streaming } = chat;
  const [draft, setDraft] = useState("");
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
  const [modelOpen, setModelOpen] = useState(false);
  // Bumped when the chat moves between the bar and the panel: the log has a new height, so where it rests is worked out again.
  const [placed, setPlaced] = useState(0);
  const decisions = useDecisions(token, layoutRef, revisionId, view === "decisions");
  const outcomes = useOutcomeQuestions(token, layoutRef);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
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
  // has proposals, it stops at the first card instead, so the options are read from the top.
  useEffect(() => {
    const element = log.current;
    if (element === null || !stick.current) return;
    const replies = element.querySelectorAll<HTMLElement>(".msg-assistant");
    const firstCard = replies[replies.length - 1]?.querySelector<HTMLElement>(".proposal-group");
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
      } else {
        element.scrollTop = cardTop;
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
  const newestOpen = newest?.kind === "assistant" && newest.phase === "done" ? newest.proposals.filter((proposal) => proposal.status === "proposed") : [];
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
  useEffect(() => {
    onTurns?.(transcript.turns);
    // The callback is the parent's setter through a ref; only the turns matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript.turns]);
  // A new conversation can't start without a credential for the provider it would use, so say so before anything is typed.
  // A conversation already going keeps working on its own provider.
  const status = provider.status;
  const activeReady = status?.active != null && status.providers.some((p) => p.id === status.active?.provider && p.ready);
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
    chat.newConversation();
    setView("chat");
    setDraft("");
    input.current?.focus();
  };
  // New, Conversations, Decisions and the model, folded into one ⋯ (P3 review): the bar's chrome stays quiet.
  const barMenu =
    variant !== "bar" ? null : (
      <Menu trigger={<Ellipsis size={16} aria-hidden="true" />} label="More" align="end" triggerClassName="bar-more">
        {(close) => (
          <>
            <button type="button" role="menuitem" className="menu-item" disabled={empty && !streaming} onClick={() => { close(); newConversation(); }}>
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
    <section className="chat" data-variant={variant} data-presentation={variant === "bar" ? presentation : undefined} data-folded={folded} data-overlap={variant === "bar" && collapsed && !folded && presentation === "bar"} aria-label="Ask keyloom">
      {variant === "bar" ? (
        // The model surfaces only from the menu or when it fails (P3 review); its picker opens above the bar.
        <ProviderPicker token={token} status={provider.status} pinned={transcript.pinned} onChanged={provider.replace} menuOpened={{ open: modelOpen, onClose: () => setModelOpen(false) }} />
      ) : null}
      <header className="chat-head" hidden={variant === "bar"}>
        <h2>Chat</h2>
        <button
          type="button"
          className="button chat-new"
          disabled={empty && !streaming}
          onClick={() => {
            chat.newConversation();
            setView("chat");
            setDraft("");
            input.current?.focus();
          }}
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
          <p className="sr-only" role="status">{streaming ? "keyloom is replying" : ""}</p>
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
              {carried === null ? null : <CarriedThreadView thread={carried} boardName={board.name.replace(/ keyboard \(ANSI\)$/, "")} />}
              {transcript.turns.map((turn) =>
                turn.kind === "user" ? (
                  <UserMessage key={turn.id} turn={turn} layout={layout} />
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
                    switchTo={readyOthers}
                    onSwitch={switchProvider}
                    compact={variant === "bar"}
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
            onChange={setDraft}
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
    </section>
  );
}

function CommandIcon({ kind }: { kind: Command["kind"] }) {
  const Icon = kind === "lab" ? Activity : kind === "new-config" ? Plus : kind === "switch" ? ArrowRightLeft : Keyboard;
  return <Icon size={14} aria-hidden="true" />;
}
