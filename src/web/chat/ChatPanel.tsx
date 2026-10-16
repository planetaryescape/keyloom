import { MessagesSquare, ScrollText, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyResponse, ChatSelection, ProposalCard } from "../../api/http.ts";
import type { Slot } from "../../layout/change.ts";
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Layout } from "../../layout/schema.ts";
import { applyChangeSet } from "../api-write.ts";
import { DecisionsView } from "../decisions/DecisionsView.tsx";
import { OutcomeQuestions } from "../decisions/OutcomeQuestions.tsx";
import { useDecisions, useOutcomeQuestions } from "../decisions/useDecisions.ts";
import { Composer, type SelectedKeys } from "./Composer.tsx";
import { ConversationList } from "./ConversationList.tsx";
import { EmptyChat, MissingKey, ProblemNotice } from "./ChatStates.tsx";
import { ProviderPicker } from "./ProviderPicker.tsx";
import { chooseProvider } from "./api-chat.ts";

const PROVIDER_NAMES = { anthropic: "Anthropic", openrouter: "OpenRouter", codex: "Codex" } as const;
import { keyLabel, layerName } from "./proposal-facts.ts";
import { AssistantMessage, UserMessage } from "./Turns.tsx";
import { useChat } from "./useChat.ts";
import { useProviderStatus } from "./useProviderStatus.ts";
import "./chat.css";
import "./command-bar.css";

interface Props {
  /** "bar" is the command bar at the stage's foot (P3); "panel" the bottom sheet on a narrow screen. */
  variant?: "bar" | "panel";
  /** Closes the bar (Esc does too). */
  onClose?: () => void;
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
}

const ASK_AGAIN = "The layout changed after you proposed that, so it no longer applies. Please propose it again against the current layout.";
// Within this distance of the end, new text keeps the log pinned to the bottom; scrolled further up, it stays put.
const STICK_PX = 48;

export function ChatPanel({ variant = "panel", onClose, token, layoutRef, layout, board, revisionId, onHighlightDecision, selection, onRemoveKey, onOpenKey, onClearSelection, onRestoreSelection, pinnedId, onPreview, onPin, onApplied, onOpenRelease }: Props) {
  const chat = useChat(token, layoutRef);
  const provider = useProviderStatus(token);
  const { transcript, streaming } = chat;
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"chat" | "history" | "decisions">("chat");
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
    });
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
      element.scrollTop += firstCard.getBoundingClientRect().top - element.getBoundingClientRect().top - 8;
      stick.current = false;
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [transcript.turns, chat.problem, view]);

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

  return (
    <section className="chat" data-variant={variant} aria-label="Ask keyloom">
      {variant === "bar" ? (
        <header className="bar-head">
          <h2>Ask keyloom</h2>
          <ProviderPicker token={token} status={provider.status} pinned={transcript.pinned} onChanged={provider.replace} />
          <span className="bar-head-gap" />
          <button
            type="button"
            className="bar-link"
            disabled={empty && !streaming}
            onClick={() => {
              chat.newConversation();
              setView("chat");
              setDraft("");
              input.current?.focus();
            }}
          >
            New
          </button>
          <button type="button" className="bar-link" aria-pressed={view === "history"} onClick={() => (view === "history" ? setView("chat") : showHistory())}>
            Conversations
          </button>
          <button type="button" className="bar-link" aria-pressed={view === "decisions"} onClick={() => setView(view === "decisions" ? "chat" : "decisions")}>
            Decisions
          </button>
          <button type="button" className="bar-close" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </header>
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
      ) : (
        <>
          <p className="sr-only" role="status">{streaming ? "keyloom is replying" : ""}</p>
          <OutcomeQuestions questions={outcomes.questions} onAnswer={outcomes.answer} />
          <div
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
            ) : empty && chat.problem === null ? (
              <EmptyChat
                onPick={(prompt) => {
                  setDraft(prompt);
                  input.current?.focus();
                }}
              />
            ) : (
              transcript.turns.map((turn) =>
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
              )
            )}
            {chat.problem === null ? null : <ProblemNotice problem={chat.problem} providers={provider.status?.providers ?? []} onRetry={retryDraft} onDismiss={chat.dismissProblem} />}
          </div>
          <Composer
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
          />
        </>
      )}
    </section>
  );
}
