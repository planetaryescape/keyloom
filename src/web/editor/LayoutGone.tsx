import { LayoutGrid } from "lucide-react";
import { createContext, useContext } from "react";
import { LAYOUT_GONE } from "../release/flash-words.ts";
import { RestartKeyloom } from "../shell/RestartKeyloom.tsx";

/**
 * The page's way to the layouts keyloom still has: App's Show your other layouts, which reads the list again on the wall. The layout page
 * provides it, so a pane that finds its layout deleted elsewhere (the check box, Repeat) offers it without the panes passing it down (R10-09).
 */
export const OtherLayoutsContext = createContext<(() => void) | null>(null);

/** Where the page can show the other layouts, its button is the way on, so the sentence doesn't send the person to a restart. */
export const LAYOUT_GONE_HERE = "keyloom no longer has this layout. It may have been deleted in another window, so this change can't be saved.";

/** The sentence for a layout deleted elsewhere: the restart's words only where a restart is the one way on (R10-09). Pure. */
export const layoutGoneWords = (canShowOthers: boolean): string => (canShowOthers ? LAYOUT_GONE_HERE : LAYOUT_GONE);

export function useLayoutGoneWords(): string {
  return layoutGoneWords(useContext(OtherLayoutsContext) !== null);
}

/**
 * The buttons under a layout deleted in another window (R10-09): Show your other layouts first, which needs no restart and works under
 * `keyloom serve` in a terminal too, then Restart keyloom. Outside a layout page, Restart keyloom alone.
 */
export function LayoutGoneWayOut({ token }: { token: string }) {
  const showOthers = useContext(OtherLayoutsContext);
  if (showOthers === null) return <RestartKeyloom token={token} primary />;
  return (
    <>
      <button type="button" className="button button-primary" onClick={showOthers}><LayoutGrid size={14} aria-hidden="true" />Show your other layouts</button>
      <RestartKeyloom token={token} />
    </>
  );
}
