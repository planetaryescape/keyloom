// The drawn board's colourway (D-395). By default it follows the theme (D-262); BK can pin it to the colourway of the board on his
// desk, per board, in this browser like the theme itself. Pinned, the case and caps keep their colours in either theme; the stage
// and the chrome still follow it.
import { useCallback, useState } from "react";
import type { Colourway } from "../../boards/schema.ts";
import { readStored, writeStored } from "../shell/storage.ts";

const KEY = (boardId: string) => `keyloom.colourway.${boardId}`;

/** The pinned colourway's id, or null to follow the theme. An id the board no longer lists follows the theme. */
export function readColourway(boardId: string, colourways: readonly Colourway[] | undefined): Colourway | null {
  const id = readStored(KEY(boardId));
  return colourways?.find((c) => c.id === id) ?? null;
}

export function useColourway(boardId: string, colourways: readonly Colourway[] | undefined): [Colourway | null, (id: string | null) => void] {
  const [pinned, setPinned] = useState<{ boardId: string; id: string | null }>(() => ({ boardId, id: readColourway(boardId, colourways)?.id ?? null }));
  // Another board's choice is not this one's: read again when the board changes.
  const id = pinned.boardId === boardId ? pinned.id : (readColourway(boardId, colourways)?.id ?? null);
  const set = useCallback((next: string | null) => {
    setPinned({ boardId, id: next });
    writeStored(KEY(boardId), next ?? "");
  }, [boardId]);
  return [colourways?.find((c) => c.id === id) ?? null, set];
}

/**
 * What the board's element carries for colourway.css: a part's tone only when it differs from the room's, since a part that matches
 * the room is drawn by the theme's own tokens. Marks around the caps follow the case they sit on.
 */
export function colourwayAttributes(
  colourway: Pick<Colourway, "case" | "caps"> | null,
  room: "light" | "dark",
): { "data-case-room"?: Colourway["case"]; "data-caps-room"?: Colourway["caps"]; "data-room"?: "light" | "dark" } {
  if (colourway === null) return {};
  return {
    ...(colourway.case === room ? {} : { "data-case-room": colourway.case }),
    ...(colourway.caps === room ? {} : { "data-caps-room": colourway.caps }),
    // A grey case is out of both rooms, so its shadow on the stage depends on which room it is in.
    ...(colourway.case === "grey" ? { "data-room": room } : {}),
  };
}
