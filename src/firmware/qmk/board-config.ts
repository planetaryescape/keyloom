// The QMK-specific parts of a board revision's `build` and `flash` blocks. board.json types them as
// passthrough objects (04), so the fields this module needs are parsed here, where they are used.
import { z } from "zod";
import type { BoardDefinition, BoardRevision } from "../../boards/schema.ts";

const QmkBuildSchema = z.object({
  kind: z.literal("qmk-docker"),
  /** The QMK CLI image, pinned by digest so a build can't change under us (S5). */
  image: z.string().regex(/@sha256:[0-9a-f]{64}$/, "must be pinned by sha256 digest"),
  /** The `LAYOUT_*` macro keymaps[] is written with. */
  layoutMacro: z.string().min(1),
  /** Where `<name>/keymap.c` goes, relative to the checkout. */
  keymapsDir: z.string().min(1),
  /** Submodules the build needs; the others are skipped to keep the checkout small (S5). */
  submodules: z.array(z.string().min(1)),
  /** Written to keymap.json when the layout carries none of its own. */
  modules: z.array(z.string().min(1)).optional(),
});

const ZappFlashSchema = z.object({
  kind: z.literal("zapp"),
  /** USB `VID:PID` of the bootloader this revision's binary is built for (S11). */
  bootloader: z.string().regex(/^[0-9a-f]{4}:[0-9a-f]{4}$/),
});

export type QmkBoardRevision = {
  id: string;
  qmkTarget: string;
  source: BoardRevision["source"];
  build: z.infer<typeof QmkBuildSchema>;
  flash: z.infer<typeof ZappFlashSchema>;
};

export class BoardConfigError extends Error {
  override name = "BoardConfigError";
}

/** The revision `revisionId` of `board` (the first when omitted), checked to be a QMK-in-Docker, Zapp-flashed one. */
export function qmkRevision(board: BoardDefinition, revisionId?: string): QmkBoardRevision {
  const rev = revisionId === undefined ? board.revisions[0] : board.revisions.find((r) => r.id === revisionId);
  if (!rev) {
    throw new BoardConfigError(`${board.id} has no revision "${revisionId}" (it has ${board.revisions.map((r) => r.id).join(", ")})`);
  }
  if (!rev.qmkTarget) throw new BoardConfigError(`${board.id} ${rev.id} has no qmkTarget`);
  const build = QmkBuildSchema.safeParse(rev.build);
  if (!build.success) throw new BoardConfigError(`${board.id} ${rev.id} build: ${build.error.message}`);
  const flash = ZappFlashSchema.safeParse(rev.flash);
  if (!flash.success) throw new BoardConfigError(`${board.id} ${rev.id} flash: ${flash.error.message}`);
  return { id: rev.id, qmkTarget: rev.qmkTarget, source: rev.source, build: build.data, flash: flash.data };
}
