import { ArrowRightLeft, KeyRound, MessageSquareText, RefreshCw, Send, TriangleAlert, X } from "lucide-react";
import type { ChatProviderStatus } from "../../api/http.ts";
import { ModelSetup } from "./ModelSetup.tsx";
import { retryOffer } from "./provider-ready.ts";
import { PROVIDER_NAMES, setupLead } from "./setup-words.ts";
import type { Problem } from "./useChat.ts";

export const EXAMPLE_PROMPTS = [
  "I can't press Option–Option because Option is on my S key",
  "Backspace is a long reach for my right thumb",
  "I want Escape somewhere I can hit without moving my hand",
] as const;

export function EmptyChat({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="chat-empty">
      <span className="state-icon" aria-hidden="true">
        <MessageSquareText size={22} />
      </span>
      <h3>Tell keyloom what's getting in your way</h3>
      <p>
        Describe the problem in your own words. keyloom may ask a question or two, then offer a few options you can see on the keyboard
        before anything changes. Click keys on the board to point at them.
      </p>
      <ul className="prompt-list" aria-label="Example messages">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button type="button" className="prompt" onClick={() => onPick(prompt)}>{prompt}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Setup = { token: string; status: ChatProviderStatus | null; onChanged: (status: ChatProviderStatus) => void; onReload: () => void };
type ProviderId = ChatProviderStatus["providers"][number]["id"];
/** The refused message: the provider its conversation is pinned to, and how to send it again or move it to a ready provider. */
type Retry = { pinned: ProviderId | null; onRetry?: (() => void) | undefined; onSwitch?: ((id: ProviderId) => void) | undefined };

/**
 * Shown before anything is typed when no provider has a credential, and again if a send is refused for the same reason. Setting
 * one up here works at once (D-496). Sending again is offered only once the provider that would answer is ready; until then a
 * ready provider can take the message in a new conversation.
 */
export function MissingKey({ setup, retry }: { setup: Setup; retry?: Retry | undefined }) {
  const offer = retry === undefined ? { kind: "none" as const } : retryOffer(setup.status, retry.pinned);
  return (
    <div className="chat-problem chat-missing-key" role="alert">
      <span className="state-icon" aria-hidden="true">
        <KeyRound size={22} />
      </span>
      <h3>Chat needs a model</h3>
      <p>{setupLead(setup.status)}</p>
      <ModelSetup {...setup} />
      {offer.kind === "send" && retry?.onRetry !== undefined ? (
        <button type="button" className="button button-primary" onClick={retry.onRetry}>
          <Send size={14} aria-hidden="true" />
          Send your message
        </button>
      ) : null}
      {offer.kind === "switch" && retry?.onSwitch !== undefined ? (
        <div className="setup-actions">
          {offer.to.map((id) => (
            <button key={id} type="button" className="button" onClick={() => retry.onSwitch?.(id)}>
              <ArrowRightLeft size={14} aria-hidden="true" />
              Use {PROVIDER_NAMES[id]} in a new conversation
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TITLES: Record<Exclude<Problem["kind"], "missing_key">, string> = {
  busy: "keyloom is still answering",
  rate_limit: "The model is busy",
  unreachable: "Can't reach keyloom",
  other: "That message didn't go through",
};

// A refusal before the reply started. Your message is back in the box, so Try again is one click.
export function ProblemNotice({ problem, setup, retry, onDismiss }: { problem: Problem; setup: Setup; retry: Retry; onDismiss: () => void }) {
  if (problem.kind === "missing_key") return <MissingKey setup={setup} retry={retry} />;
  const onRetry = retry.onRetry;
  return (
    <div className="chat-problem" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="chat-problem-body">
        <strong>{TITLES[problem.kind]}</strong>
        <p>{problem.message}</p>
        <div className="chat-problem-actions">
          {onRetry === undefined ? null : (
            <button type="button" className="button" onClick={onRetry}>
              <RefreshCw size={14} aria-hidden="true" />
              Try again
            </button>
          )}
        </div>
      </div>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Choosing a provider was refused or never arrived (R4-18). The conversation and its provider are as they were; Try again asks once more. */
export function SwitchFailed({ to, message, onRetry, onDismiss }: { to: ProviderId; message: string; onRetry: () => void; onDismiss: () => void }) {
  // The switch was pressed higher up the conversation, so the answer is brought into view where it is said.
  return (
    <div className="chat-problem" role="alert" ref={(element) => element?.scrollIntoView({ block: "nearest" })}>
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="chat-problem-body">
        <strong>keyloom couldn&apos;t switch to {PROVIDER_NAMES[to]}</strong>
        <p>{message} Your conversation and its model are unchanged.</p>
        <div className="chat-problem-actions">
          <button type="button" className="button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            Try again
          </button>
        </div>
      </div>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

