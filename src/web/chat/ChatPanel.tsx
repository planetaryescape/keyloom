import { History as HistoryIcon, ScrollText, SquarePen } from "lucide-react";
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
import { EmptyChat, ProblemNotice, ProviderLine } from "./ChatStates.tsx";
import { keyLabel, layerName } from "./proposal-facts.ts";
import { AssistantMessage, UserMessage } from "./Turns.tsx";
import { useChat } from "./useChat.ts";
import { useProviderStatus } from "./useProviderStatus.ts";
import "./chat.css";

interface Props {
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

export function ChatPanel({ token, layoutRef, layout, board, revisionId, onHighlightDecision, selection, onRemoveKey, onClearSelection, onRestoreSelection, pinnedId, onPreview, onPin, onApplied, onOpenRelease }: Props) {
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
  const retryDraft = draft.trim() === "" ? undefined : () => send(draft);

  return (
    <section className="chat" aria-label="Chat with keyloom">
      <header className="chat-head">
        <div className="chat-title">
          <h2>Chat</h2>
          <ProviderLine status={provider.status} pinned={transcript.pinned} />
        </div>
        <div className="chat-head-actions">
          <button type="button" className="button" aria-pressed={view === "decisions"} onClick={() => setView(view === "decisions" ? "chat" : "decisions")}>
            <ScrollText size={14} aria-hidden="true" />
            Decisions
          </button>
          <button type="button" className="button" aria-pressed={view === "history"} onClick={() => (view === "history" ? setView("chat") : showHistory())}>
            <HistoryIcon size={14} aria-hidden="true" />
            History
          </button>
          <button
            type="button"
            className="button"
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
        </div>
      </header>

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
            {empty && chat.problem === null ? (
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
            onClearSelection={onClearSelection}
            inputRef={input}
          />
        </>
      )}
    </section>
  );
}
