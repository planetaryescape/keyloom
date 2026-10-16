import { X } from "lucide-react";
import { useState } from "react";
import { readStored, writeStored } from "./storage.ts";

const KEY = "keyloom.tip.dismissed";

// The one hint, shown until it is dismissed (18#states). It replaces the instruction row and card.
export function FirstRunTip() {
  const [dismissed, setDismissed] = useState(() => readStored(KEY) === "1");
  if (dismissed) return null;
  return (
    <div className="tip" role="note">
      <p>Click a key to change it, or press one on your keyboard to find it. <kbd>⌘K</kbd> asks keyloom.</p>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss the tip"
        onClick={() => {
          setDismissed(true);
          writeStored(KEY, "1");
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
