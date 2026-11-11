import { Hammer, Play, Replace, Settings2, Upload } from "lucide-react";
import { createContext, useContext } from "react";
import type { BoardSync } from "../../api/http.ts";
import { type AfterApply, afterApply } from "./flash-words.ts";

/**
 * What the layout page knows about its keyboard, for the line a proposal card shows after Apply (R2-01). The page provides it, so the
 * chat between them doesn't carry the keyboard's state through every level.
 */
export type AfterApplyKeyboard = {
  board: { firmware: string; name: string };
  layoutId: string;
  /** The revision the page shows now, so the line can tell a sync view that already has this change from one that doesn't yet. */
  revisionId: string;
  sync: BoardSync | undefined;
  onApplyNow: () => void;
  onPutOn: () => void;
  /** Opens the keyboard's status popover, with kanata's setup checklist (R3-03). */
  onOpenStatus: () => void;
  /** Opens the confirm that replaces a kanata config keyloom didn't write (R3-03). */
  onReplaceForeign: () => void;
};

export const AfterApplyContext = createContext<AfterApplyKeyboard | null>(null);

const ICONS = { apply_now: Play, put_on: Upload, open_release: Hammer, open_status: Settings2, replace_foreign: Replace } as const;

/** What the line's button does, for the card and the Applied toast alike. Without a page around it only Build and flash can run. */
export function afterApplyRun(action: AfterApply["action"], keyboard: AfterApplyKeyboard | null, onOpenRelease: () => void): (() => void) | null {
  switch (action?.id) {
    case undefined: return null;
    case "apply_now": return keyboard?.onApplyNow ?? null;
    case "put_on": return keyboard?.onPutOn ?? null;
    case "open_status": return keyboard?.onOpenStatus ?? null;
    case "replace_foreign": return keyboard?.onReplaceForeign ?? null;
    case "open_release": return onOpenRelease;
  }
}

/** The sentence and its one button. Without a page around it, a board that is built offers Build and flash, as before. */
export function AfterApplyNote({ board, onOpenRelease }: { board: { firmware: string; name: string }; onOpenRelease: () => void }) {
  const keyboard = useContext(AfterApplyContext);
  const line = afterApply(keyboard?.board ?? board, keyboard?.sync, keyboard?.layoutId ?? "", keyboard?.revisionId);
  const run = afterApplyRun(line.action, keyboard, onOpenRelease);
  const Icon = line.action === null ? null : ICONS[line.action.id];
  return (
    <>
      <p>
        <strong>{line.lead}</strong> {line.text}
      </p>
      {line.action === null || run === null || Icon === null ? null : (
        <button type="button" className="button" onClick={() => run()}>
          <Icon size={14} aria-hidden="true" />
          {line.action.label}
        </button>
      )}
    </>
  );
}
