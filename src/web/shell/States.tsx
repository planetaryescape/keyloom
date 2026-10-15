import { Check, Copy, Keyboard, RefreshCw, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

export const IMPORT_COMMAND = "keyloom import --board zsa/moonlander <oryx.zip>";

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="loading" role="status">
      {children}
    </p>
  );
}

export function EmptyState({ onRetry }: { onRetry: () => void }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    // Clipboard access can be refused (no permission, insecure context); the command stays
    // selectable on screen either way, so a failure needs no message.
    navigator.clipboard
      .writeText(IMPORT_COMMAND)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  }

  return (
    <section className="state" aria-labelledby="empty-title">
      <span className="state-icon" aria-hidden="true">
        <Keyboard size={22} />
      </span>
      <h2 id="empty-title">No layouts yet</h2>
      <p>Import your Oryx export and every layer of your layout shows up here.</p>
      <div className="command">
        <code>{IMPORT_COMMAND}</code>
        <button type="button" className="button" onClick={copy} aria-label="Copy the import command">
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p>Run it in a terminal, then check again.</p>
      <button type="button" className="button" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" />
        Check again
      </button>
    </section>
  );
}

export function ErrorState({
  title,
  children,
  onRetry,
}: {
  title: string;
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <section className="state state-error" role="alert">
      <span className="state-icon" aria-hidden="true">
        <TriangleAlert size={22} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {onRetry === undefined ? null : (
        <button type="button" className="button" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </button>
      )}
    </section>
  );
}
