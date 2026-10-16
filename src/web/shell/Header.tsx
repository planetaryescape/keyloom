import { ChevronDown, Check, FileUp } from "lucide-react";
import type { BoardChoice, LayoutSummary } from "../../api/http.ts";
import { Menu } from "./Menu.tsx";
import { TopBar, type BoardEntry } from "./TopBar.tsx";

/** "zsa/moonlander" is "Moonlander"; the vendor is in the layout summary, and a menu group needs only the board. */
export function boardTitle(boardId: string): string {
  const name = boardId.split("/").at(-1) ?? boardId;
  return name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

interface LayoutMenuProps {
  layouts: readonly LayoutSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
  onImport: () => void;
}

// Layouts grouped by the board they are for, in the order the boards first appear.
export function LayoutMenu({ layouts, selectedId, onSelect, onImport }: LayoutMenuProps) {
  const selected = layouts.find((layout) => layout.id === selectedId);
  const groups = new Map<string, LayoutSummary[]>();
  for (const layout of layouts) groups.set(layout.boardId, [...(groups.get(layout.boardId) ?? []), layout]);
  return (
    <Menu
      label="Choose a layout"
      triggerClassName="layout-trigger"
      trigger={
        <>
          <span className="layout-trigger-name">{selected?.name ?? "Layout"}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <>
          {[...groups].map(([boardId, group]) => (
            <div key={boardId} role="group" aria-label={boardTitle(boardId)} className="menu-group">
              <p className="menu-heading" aria-hidden="true">{boardTitle(boardId)}</p>
              {group.map((layout) => (
                <button
                  key={layout.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={layout.id === selectedId}
                  className="menu-item"
                  onClick={() => {
                    onSelect(layout.id);
                    close();
                  }}
                >
                  <span className="menu-item-label">{layout.name}</span>
                  {layout.id === selectedId ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ))}
          <div className="menu-separator" role="separator" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); onImport(); }}>
            <FileUp size={14} aria-hidden="true" />
            <span className="menu-item-label">Import a layout…</span>
          </button>
        </>
      )}
    </Menu>
  );
}

export interface HeaderProps {
  layouts?: readonly LayoutSummary[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onImport?: () => void;
  /** The boards' shapes, so the switcher draws silhouettes here as the layout page does (P4 review). */
  boardChoices?: readonly BoardChoice[];
}

// The top bar for pages that aren't a layout (loading, import, an error, board dev): the name, the boards the person has, and the theme.
// A layout page draws its own, with the sync line, undo and the menu (Viewer.tsx).
export function Header({ layouts, selectedId, onSelect, boardChoices = [] }: HeaderProps) {
  const boards = boardEntries(layouts ?? [], boardChoices);
  const active = layouts?.find((layout) => layout.id === selectedId)?.boardId ?? null;
  return (
    <TopBar
      {...(boards.length === 0 || onSelect === undefined
        ? {}
        : { boards: { entries: boards, active, onSelect: (boardId: string) => { const first = layouts?.find((layout) => layout.boardId === boardId); if (first !== undefined) onSelect(first.id); } } })}
    />
  );
}

/** A board's name as the chrome says it: "your MacBook", not "your MacBook keyboard (ANSI)". */
export const boardDisplayName = (name: string): string => name.replace(/ keyboard \(ANSI\)$/, "");

/** One switcher entry per board the person has a layout for, in the order their layouts are listed. */
export function boardEntries(layouts: readonly LayoutSummary[], choices: readonly BoardChoice[] = []): BoardEntry[] {
  const seen = new Map<string, BoardEntry>();
  for (const layout of layouts) {
    if (seen.has(layout.boardId)) continue;
    const board = choices.find((choice) => choice.id === layout.boardId);
    seen.set(layout.boardId, { id: layout.boardId, name: board === undefined ? boardTitle(layout.boardId) : boardDisplayName(board.name), ...(board === undefined ? {} : { board }) });
  }
  return [...seen.values()];
}
