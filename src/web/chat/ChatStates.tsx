import { KeyRound, MessageSquareText, RefreshCw, Send, TriangleAlert, X } from "lucide-react";
import type { ChatProviderStatus } from "../../api/http.ts";
import { ModelSetup } from "./ModelSetup.tsx";
import { anyReady } from "./setup-words.ts";
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

/**
 * Shown before anything is typed when no provider has a credential, and again if a send is refused for the same reason. Setting
 * one up here works at once (D-496); `onRetry` sends the refused message again, and is offered only once a model is ready.
 */
export function MissingKey({ setup, onRetry }: { setup: Setup; onRetry?: (() => void) | undefined }) {
  const ready = setup.status !== null && anyReady(setup.status);
  return (
    <div className="chat-problem chat-missing-key" role="alert">
      <span className="state-icon" aria-hidden="true">
        <KeyRound size={22} />
      </span>
      <h3>Chat needs a model</h3>
      <p>Paste an API key, or sign in with Codex. Chat can use it straight away.</p>
      <ModelSetup {...setup} />
      {onRetry === undefined || !ready ? null : (
        <button type="button" className="button button-primary" onClick={onRetry}>
          <Send size={14} aria-hidden="true" />
          Send your message
        </button>
      )}
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
export function ProblemNotice({ problem, setup, onRetry, onDismiss }: { problem: Problem; setup: Setup; onRetry?: (() => void) | undefined; onDismiss: () => void }) {
  if (problem.kind === "missing_key") return <MissingKey setup={setup} onRetry={onRetry} />;
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
