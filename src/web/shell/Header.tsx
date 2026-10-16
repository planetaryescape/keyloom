import type { BoardChoice, LayoutSummary } from "../../api/http.ts";
import { TopBar, type BoardEntry } from "./TopBar.tsx";

/** "zsa/moonlander" is "Moonlander"; the vendor is in the layout summary, and a menu group needs only the board. */
export function boardTitle(boardId: string): string {
  const name = boardId.split("/").at(-1) ?? boardId;
  return name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
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
  // A board keyloom derived (local/) that has the name of one it already has reads "Corne (new)", so the two can be told apart (D-336).
  const entries = [...seen.values()];
  return entries.map((e) => (e.id.startsWith("local/") && entries.some((o) => o.id !== e.id && o.name === e.name) ? { ...e, name: `${e.name} (new)` } : e));
}
