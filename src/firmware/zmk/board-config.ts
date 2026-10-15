// The ZMK-specific parts of a board revision's `build` and `flash` blocks. board.json types them as
// passthrough objects (04), so the fields this module needs are parsed here, where they are used.
import { z } from "zod";
import type { BoardDefinition, BoardRevision } from "../../boards/schema.ts";

const ZmkBuildSchema = z.object({
  kind: z.literal("zmk-moergo-template"),
  /** MoErgo's config template; its Dockerfile route is what keyloom builds with (D-036). */
  template: z.object({ repo: z.string().url(), sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  /** The file in the firmware tree that holds the `zmk,physical-layout`; geometry.json is generated from it. */
  physicalLayout: z.string().min(1),
});

const Uf2FlashSchema = z.object({
  kind: z.literal("uf2-drives"),
  /** In the order to flash: MoErgo says the right half first (D-038). */
  steps: z.array(z.object({ volume: z.string().min(1), label: z.string().min(1), enter: z.string().min(1) })).min(1),
});

export type ZmkBoardRevision = {
  id: string;
  source: BoardRevision["source"];
  build: z.infer<typeof ZmkBuildSchema>;
  flash: z.infer<typeof Uf2FlashSchema>;
};

export class ZmkBoardConfigError extends Error {
  override name = "ZmkBoardConfigError";
}

/** The revision `revisionId` of `board` (the first when omitted), checked to be a MoErgo-template build flashed to UF2 drives. */
export function zmkRevision(board: BoardDefinition, revisionId?: string): ZmkBoardRevision {
  const rev = revisionId === undefined ? board.revisions[0] : board.revisions.find((r) => r.id === revisionId);
  if (!rev) throw new ZmkBoardConfigError(`${board.id} has no revision "${revisionId}" (it has ${board.revisions.map((r) => r.id).join(", ")})`);
  const build = ZmkBuildSchema.safeParse(rev.build);
  if (!build.success) throw new ZmkBoardConfigError(`${board.id} ${rev.id} build: ${build.error.message}`);
  const flash = Uf2FlashSchema.safeParse(rev.flash);
  if (!flash.success) throw new ZmkBoardConfigError(`${board.id} ${rev.id} flash: ${flash.error.message}`);
  return { id: rev.id, source: rev.source, build: build.data, flash: flash.data };
}
