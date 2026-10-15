// The ZMK-specific view of a board revision. The recipe fields are declared and validated in
// src/boards/recipes.ts; this narrows a revision to the ZMK recipes.
import type { BoardDefinition, BoardRevision } from "../../boards/schema.ts";
import type { Uf2DrivesFlash, ZmkMoergoTemplateBuild, ZmkWestDockerBuild } from "../../boards/recipes.ts";

export type ZmkBoardRevision = {
  id: string;
  source: BoardRevision["source"];
  build: ZmkMoergoTemplateBuild | ZmkWestDockerBuild;
  flash: Uf2DrivesFlash;
};

export class ZmkBoardConfigError extends Error {
  override name = "ZmkBoardConfigError";
}

/** The revision `revisionId` of `board` (the first when omitted), checked to be a ZMK build flashed to UF2 drives. */
export function zmkRevision(board: BoardDefinition, revisionId?: string): ZmkBoardRevision {
  const rev = revisionId === undefined ? board.revisions[0] : board.revisions.find((r) => r.id === revisionId);
  if (!rev) throw new ZmkBoardConfigError(`${board.id} has no revision "${revisionId}" (it has ${board.revisions.map((r) => r.id).join(", ")})`);
  if (rev.build.kind === "qmk-docker") throw new ZmkBoardConfigError(`${board.id} ${rev.id} build: a ZMK board builds with zmk-moergo-template or zmk-west-docker, not ${rev.build.kind}`);
  if (rev.flash.kind !== "uf2-drives") throw new ZmkBoardConfigError(`${board.id} ${rev.id} flash: a ZMK board flashes with uf2-drives, not ${rev.flash.kind}`);
  return { id: rev.id, source: rev.source, build: rev.build, flash: rev.flash };
}
