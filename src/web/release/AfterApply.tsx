import { Hammer, Play, Upload } from "lucide-react";
import { createContext, useContext } from "react";
import type { BoardSync } from "../../api/http.ts";
import { afterApply } from "./flash-words.ts";

/**
 * What the layout page knows about its keyboard, for the line a proposal card shows after Apply (R2-01). The page provides it, so the
 * chat between them doesn't carry the keyboard's state through every level.
 */
export type AfterApplyKeyboard = {
  board: { firmware: string; name: string };
  layoutId: string;
  sync: BoardSync | undefined;
  onApplyNow: () => void;
  onPutOn: () => void;
};

export const AfterApplyContext = createContext<AfterApplyKeyboard | null>(null);

const ICONS = { apply_now: Play, put_on: Upload, open_release: Hammer } as const;

/** The sentence and its one button. Without a page around it, a board that is built offers Build and flash, as before. */
export function AfterApplyNote({ board, onOpenRelease }: { board: { firmware: string; name: string }; onOpenRelease: () => void }) {
  const keyboard = useContext(AfterApplyContext);
  const line = afterApply(keyboard?.board ?? board, keyboard?.sync, keyboard?.layoutId ?? "");
  const run = line.action === null ? null : line.action.id === "apply_now" ? keyboard?.onApplyNow : line.action.id === "put_on" ? keyboard?.onPutOn : onOpenRelease;
  const Icon = line.action === null ? null : ICONS[line.action.id];
  return (
    <>
      <p>
        <strong>{line.lead}</strong> {line.text}
      </p>
      {line.action === null || run === undefined || run === null || Icon === null ? null : (
        <button type="button" className="button" onClick={run}>
          <Icon size={14} aria-hidden="true" />
          {line.action.label}
        </button>
      )}
    </>
  );
}
