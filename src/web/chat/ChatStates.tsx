import { Check, Copy, KeyRound, MessageSquareText, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import type { ChatProviderStatus } from "../../api/http.ts";
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

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    // Clipboard access can be refused; the command stays selectable either way.
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  }
  return (
    <div className="command">
      <code>{command}</code>
      <button type="button" className="button" onClick={copy} aria-label={`Copy ${command}`}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Shown before anything is typed when no provider has a credential, and again if a send is refused for the same reason. */
export function MissingKey({ providers, onRetry, retryLabel = "Try again" }: { providers: ChatProviderStatus["providers"]; onRetry?: (() => void) | undefined; retryLabel?: string }) {
  return (
    <div className="chat-problem chat-missing-key" role="alert">
      <span className="state-icon" aria-hidden="true">
        <KeyRound size={22} />
      </span>
      <h3>Chat needs a model</h3>
      <p>Pick one. A Codex sign-in is picked up when you check again. An API key is read only when keyloom starts, so start <code>keyloom serve</code> again with it set.</p>
      <ul className="provider-options" aria-label="Ways to set up a model">
        {providers.map((p) => (
          <li key={p.id}>
            <strong>{p.label}</strong>
            <span className="muted">{p.setup}</span>
            <CopyCommand command={p.command} />
          </li>
        ))}
      </ul>
      <p className="muted">keyloom never stores your key. Reload this page once keyloom is running again.</p>
      {onRetry === undefined ? null : (
        <button type="button" className="button" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          {retryLabel}
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
export function ProblemNotice({ problem, providers, onRetry, onDismiss }: { problem: Problem; providers: ChatProviderStatus["providers"]; onRetry?: (() => void) | undefined; onDismiss: () => void }) {
  if (problem.kind === "missing_key") return <MissingKey providers={providers} onRetry={onRetry} />;
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
