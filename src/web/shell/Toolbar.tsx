import { CircleHelp, History, Library, LoaderCircle, Redo2, SlidersHorizontal, Spline, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { RevisionInfo } from "../../api/http.ts";

interface Props {
  tabs: ReactNode;
  revision: RevisionInfo;
  busy: boolean;
  /** Why undo and redo are unavailable right now, said under the toolbar as well as in the buttons' tooltips. */
  blockedReason: string | null;
  onUndo: () => void;
  historyOpen: boolean;
  onHistory: () => void;
  /** Combos are drawn as lines between their keys, and listed beside the board. */
  combosShown: boolean;
  onCombos: () => void;
  /** The library pane (macros, tap dances and timing profiles) is showing. */
  libraryOpen: boolean;
  onLibrary: () => void;
  /** The settings page (firmware options and layer colours) is showing. */
  settingsOpen: boolean;
  onSettings: () => void;
  onShortcuts: () => void;
  advanced: boolean;
  onAdvanced: (value: boolean) => void;
}

const WHY_ID = "toolbar-why";

// An undo is itself a revision, so undoing it puts the change back: with the head an undo, the
// Undo button is off and Redo is on, and the other way round otherwise. Both call the same route.
export function Toolbar({ tabs, revision, busy, blockedReason, onUndo, historyOpen, onHistory, combosShown, onCombos, libraryOpen, onLibrary, settingsOpen, onSettings, onShortcuts, advanced, onAdvanced }: Props) {
  const canRedo = revision.origin === "undo" && revision.undoable;
  const canUndo = revision.origin !== "undo" && revision.undoable;
  const icon = (Icon: typeof Undo2) => (busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />);
  const reason = (action: string) => blockedReason ?? action;
  return (
    <div className="toolbar">
      <div className="toolbar-tabs">{tabs}</div>
      <div className="toolbar-actions">
        <div className="toolbar-undo">
          <button
            type="button"
            className="icon-button"
            aria-label="Undo"
            aria-describedby={blockedReason === null ? undefined : WHY_ID}
            disabled={!canUndo || busy || blockedReason !== null}
            title={canUndo ? reason(`Undo: ${revision.summary} (⌘Z)`) : "Nothing to undo"}
            onClick={onUndo}
          >
            {icon(Undo2)}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Redo"
            aria-describedby={blockedReason === null ? undefined : WHY_ID}
            disabled={!canRedo || busy || blockedReason !== null}
            title={canRedo ? reason("Put the undone change back (⇧⌘Z)") : "Nothing to redo"}
            onClick={onUndo}
          >
            {icon(Redo2)}
          </button>
          {blockedReason === null ? null : <p id={WHY_ID} className="toolbar-why" role="status">{blockedReason}</p>}
        </div>
        <button type="button" className="toggle-button toggle-icon" aria-pressed={historyOpen} aria-label="History" onClick={onHistory} title="Every revision of this layout, with undo to any of them and flash">
          <History size={14} aria-hidden="true" />
          <span>History</span>
        </button>
        <button type="button" className="toggle-button toggle-icon" aria-pressed={combosShown} onClick={onCombos} title="Draw a line between the keys of each combo, with what it sends, and list them">
          <Spline size={14} aria-hidden="true" />
          <span>Show combos</span>
        </button>
        <button type="button" className="toggle-button toggle-icon" aria-pressed={libraryOpen} aria-label="Library" onClick={onLibrary} title="Macros, tap dances and timing profiles, and where each is used">
          <Library size={14} aria-hidden="true" />
          <span>Library</span>
        </button>
        <button type="button" className="toggle-button toggle-icon" aria-pressed={settingsOpen} aria-label="Settings" onClick={onSettings} title="Caps Word, combo and tapping term, the colour of each layer, and your keyboard's colour">
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span>Settings</span>
        </button>
        <button type="button" className="toggle-button" aria-pressed={advanced} onClick={() => onAdvanced(!advanced)} title="Show firmware names such as KC_A on keys and in the panel">
          Advanced view
        </button>
        <button type="button" className="icon-button toolbar-help" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={onShortcuts}>
          <CircleHelp size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
