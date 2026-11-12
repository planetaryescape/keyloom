import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

/** What a refused copy says (R5-17): the command is selected, so the keyboard's own copy finishes the job. */
export const copyFailedWords = (mac: boolean): string => `keyloom couldn't copy it. The command is selected: press ${mac ? "⌘C" : "Ctrl+C"} to copy it.`;

/** A command to run in a terminal, with a Copy button. Only for the terminal case: the app runs what it can itself. */
export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const code = useRef<HTMLElement>(null);
  function copy() {
    // Clipboard access can be refused (an insecure origin, a denied permission); then the text is selected for the person to copy.
    const failed = () => {
      if (code.current !== null) window.getSelection()?.selectAllChildren(code.current);
      setState("failed");
    };
    if (navigator.clipboard === undefined) {
      failed();
      return;
    }
    navigator.clipboard.writeText(command).then(() => {
      setState("copied");
      window.setTimeout(() => setState((now) => (now === "copied" ? "idle" : now)), 1600);
    }, failed);
  }
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  return (
    <>
    <span className="command">
      <code ref={code}>{command}</code>
      <button type="button" className="button" onClick={copy} aria-label={`Copy ${command}`}>
        {state === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {state === "copied" ? "Copied" : "Copy"}
      </button>
    </span>
    {state === "failed" ? <span className="command-failed" role="alert">{copyFailedWords(mac)}</span> : null}
    </>
  );
}
