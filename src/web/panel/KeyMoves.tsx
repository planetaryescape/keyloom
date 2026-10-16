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

// Swap, Copy and Paste for the open key (16#moving-and-copying-keys), as icons in the key card's header. Each one is a change of its
// own, applied at once, so they are off while the key has a draft; the reason is in the tooltip and the accessible name.
export function KeyMoves({ swapping, onSwap, onCopy, copied, pasteTargets, onPaste, blockedReason }: Props) {
  const pasteWords = copied === null ? "Paste: copy a key first" : `Paste ${copied} on ${pasteTargets === 1 ? "this key" : `${pasteTargets} keys`} (⌘V)`;
  return (
    <div className="card-moves" role="group" aria-label="Move or copy this key">
      <button type="button" className="card-icon" aria-pressed={swapping} aria-label={blockedReason ?? "Swap: then click the key to swap with, on any layer"} title={blockedReason ?? "Swap: then click the key to swap with, on any layer (⌥S)"} disabled={blockedReason !== null} onClick={onSwap}>
        <ArrowLeftRight size={15} aria-hidden="true" />
      </button>
      <button type="button" className="card-icon" aria-label={blockedReason ?? "Copy this key"} title={blockedReason ?? "Copy this key (⌘C)"} disabled={blockedReason !== null} onClick={onCopy}>
        <Copy size={15} aria-hidden="true" />
      </button>
      <button type="button" className="card-icon" aria-label={blockedReason ?? pasteWords} title={blockedReason ?? pasteWords} disabled={blockedReason !== null || copied === null} onClick={onPaste}>
        <ClipboardPaste size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
