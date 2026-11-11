import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** A command to run in a terminal, with a Copy button. Only for the terminal case: the app runs what it can itself. */
export function CopyCommand({ command }: { command: string }) {
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
    <span className="command">
      <code>{command}</code>
      <button type="button" className="button" onClick={copy} aria-label={`Copy ${command}`}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
