// The drawn board's colours (D-395, D-319). By default the case and the caps follow the theme (D-262); BK can pin each on its own to
// the colour of the board on his desk, per board, in this browser like the theme itself. Pinned, a part keeps its colour in either
// theme; the stage and the chrome still follow it.
import { useCallback, useState } from "react";
import type { CapColour, CaseColour, Colourways } from "../../boards/schema.ts";
import { readStored, writeStored } from "../shell/storage.ts";

const CASE_KEY = (boardId: string) => `keyloom.case.${boardId}`;
const CAPS_KEY = (boardId: string) => `keyloom.caps.${boardId}`;
// D-395 kept one choice for both; it is read once into the two and then left alone.
const LEGACY_KEY = (boardId: string) => `keyloom.colourway.${boardId}`;

export type Pinned = { case: string | null; caps: string | null };
export type Tones = { case: CaseColour["tone"] | null; caps: CapColour["tone"] | null };

/** The pinned case and caps by id, null where a part follows the theme. An id the board no longer lists follows the theme. */
export function readPinned(boardId: string, colourways: Colourways | undefined): Pinned {
  if (colourways === undefined) return { case: null, caps: null };
  const known = <T extends { id: string }>(list: readonly T[], id: string | null) => (list.some((x) => x.id === id) ? id : null);
  const caseId = readStored(CASE_KEY(boardId));
  const capsId = readStored(CAPS_KEY(boardId));
  if (caseId !== null || capsId !== null) return { case: known(colourways.cases, caseId), caps: known(colourways.caps, capsId) };
  return fromLegacy(readStored(LEGACY_KEY(boardId)), colourways);
}

/** D-395's single choice as the two: its case, and the caps of the same name or else the caps that case is sold with. */
export function fromLegacy(id: string | null, colourways: Colourways): Pinned {
  const kase = colourways.cases.find((c) => c.id === id);
  if (kase === undefined) return { case: null, caps: null };
  return { case: kase.id, caps: colourways.caps.some((c) => c.id === kase.id) ? kase.id : kase.stockCaps };
}

/** The tones the board is drawn in for a pin, null where a part follows the theme. */
export function tonesOf(pinned: Pinned, colourways: Colourways | undefined): Tones {
  return {
    case: colourways?.cases.find((c) => c.id === pinned.case)?.tone ?? null,
    caps: colourways?.caps.find((c) => c.id === pinned.caps)?.tone ?? null,
  };
}

export function useColourway(boardId: string, colourways: Colourways | undefined): [Pinned, (part: "case" | "caps", id: string | null) => void] {
  const [state, setState] = useState<{ boardId: string; pinned: Pinned }>(() => ({ boardId, pinned: readPinned(boardId, colourways) }));
  // Another board's choice is not this one's: read again when the board changes.
  const pinned = state.boardId === boardId ? state.pinned : readPinned(boardId, colourways);
  const set = useCallback((part: "case" | "caps", id: string | null) => {
    setState((previous) => {
      const base = previous.boardId === boardId ? previous.pinned : readPinned(boardId, colourways);
      const next = { ...base, [part]: id };
      // Both parts are written, so a migrated choice is kept as two and the old key is never read again.
      writeStored(CASE_KEY(boardId), next.case ?? "");
      writeStored(CAPS_KEY(boardId), next.caps ?? "");
      return { boardId, pinned: next };
    });
  }, [boardId, colourways]);
  return [pinned, set];
}

/**
 * What the board's element carries for colourway.css: a part's tone only when it differs from the room's, since a part that matches
 * the room is drawn by the theme's own tokens. Marks around the caps follow the case they sit on.
 */
export function colourwayAttributes(
  tones: Tones | null,
  room: "light" | "dark",
): { "data-case-room"?: CaseColour["tone"]; "data-caps-room"?: CapColour["tone"]; "data-room"?: "light" | "dark" } {
  if (tones === null) return {};
  const kase = tones.case ?? room;
  const caps = tones.caps ?? room;
  return {
    ...(kase === room ? {} : { "data-case-room": kase }),
    ...(caps === room ? {} : { "data-caps-room": caps }),
    // A grey case is out of both rooms, so its shadow on the stage depends on which room it is in.
    ...(kase === "grey" ? { "data-room": room } : {}),
  };
}
