import { ArrowLeftRight, ClipboardPaste, Copy } from "lucide-react";

interface Props {
  /** Waiting for the key to swap with. */
  swapping: boolean;
  onSwap: () => void;
  onCopy: () => void;
  /** What is on the clipboard in words ("Esc"), or null when nothing is. */
  copied: string | null;
  /** How many keys a paste would reach: the selected keys, or this one. */
  pasteTargets: number;
  onPaste: () => void;
  /** Why these can't be used right now (a draft is open), or null. */
  blockedReason: string | null;
}

// Swap, Copy and Paste for the open key (16#moving-and-copying-keys). They sit apart from the slots:
// each one is a change of its own, applied at once, so they are off while the key has a draft.
export function KeyMoves({ swapping, onSwap, onCopy, copied, pasteTargets, onPaste, blockedReason }: Props) {
  return (
    <div className="panel-moves" role="group" aria-label="Move or copy this key">
      <button type="button" className="button" aria-pressed={swapping} disabled={blockedReason !== null} title={blockedReason ?? "Then click the key to swap with, on any layer"} onClick={onSwap}>
        <ArrowLeftRight size={14} aria-hidden="true" />
        Swap
      </button>
      <button type="button" className="button" disabled={blockedReason !== null} title={blockedReason ?? "Copy this key (⌘C)"} onClick={onCopy}>
        <Copy size={14} aria-hidden="true" />
        Copy
      </button>
      <button
        type="button"
        className="button"
        disabled={blockedReason !== null || copied === null}
        title={blockedReason ?? (copied === null ? "Copy a key first" : `Put ${copied} on ${pasteTargets === 1 ? "this key" : `${pasteTargets} keys`} (⌘V)`)}
        onClick={onPaste}
      >
        <ClipboardPaste size={14} aria-hidden="true" />
        {pasteTargets > 1 ? `Paste on ${pasteTargets}` : "Paste"}
      </button>
    </div>
  );
}
