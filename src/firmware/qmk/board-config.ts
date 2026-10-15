// The QMK-specific view of a board revision. The recipe fields are declared and validated in
// src/boards/recipes.ts; this narrows a revision to the QMK recipes.
import type { BoardDefinition, BoardRevision } from "../../boards/schema.ts";
import type { FlashRecipe, KanataReload, QmkDockerBuild } from "../../boards/recipes.ts";

export type QmkBoardRevision = {
  id: string;
  qmkTarget: string;
  source: BoardRevision["source"];
  build: QmkDockerBuild;
  /** Zapp for ZSA boards, UF2 drives for RP2040 boards, `manual` for anything else (04). */
  flash: Exclude<FlashRecipe, KanataReload>;
  /** The USB product ID the running firmware reports (`0x1969`), when the board declares one. */
  usbProductId: string | null;
};

export class BoardConfigError extends Error {
  override name = "BoardConfigError";
}

/** The revision `revisionId` of `board` (the first when omitted), checked to be a QMK-in-Docker one. */
export function qmkRevision(board: BoardDefinition, revisionId?: string): QmkBoardRevision {
  const rev = revisionId === undefined ? board.revisions[0] : board.revisions.find((r) => r.id === revisionId);
  if (!rev) {
    throw new BoardConfigError(`${board.id} has no revision "${revisionId}" (it has ${board.revisions.map((r) => r.id).join(", ")})`);
  }
  if (!rev.qmkTarget) throw new BoardConfigError(`${board.id} ${rev.id} has no qmkTarget`);
  if (rev.build.kind !== "qmk-docker") throw new BoardConfigError(`${board.id} ${rev.id} build: a QMK board builds with qmk-docker, not ${rev.build.kind}`);
  if (rev.flash.kind === "kanata-reload") throw new BoardConfigError(`${board.id} ${rev.id} flash: a QMK board can't be applied with kanata-reload`);
  return { id: rev.id, qmkTarget: rev.qmkTarget, source: rev.source, build: rev.build, flash: rev.flash, usbProductId: rev.detect?.usbProductId.toLowerCase() ?? null };
}
