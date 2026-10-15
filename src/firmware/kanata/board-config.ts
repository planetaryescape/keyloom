// The kanata view of a board revision: the recipes are declared and validated in src/boards/recipes.ts (21).
import type { BoardDefinition } from "../../boards/schema.ts";
import { type KeyCode, isKeyCode } from "../../layout/keycodes.ts";

export type KanataBoardRevision = {
  id: string;
  /** The kanata release the generated syntax targets. */
  kanataVersion: string;
  tcpPort: number;
  driverVersions: readonly string[];
  /** The product string `defcfg macos-dev-names-include` compares against. */
  deviceName: string;
};

export class KanataBoardError extends Error {
  override name = "KanataBoardError";
}

export function kanataRevision(board: BoardDefinition, revisionId?: string): KanataBoardRevision {
  const rev = revisionId === undefined ? board.revisions[0] : board.revisions.find((r) => r.id === revisionId);
  if (!rev) throw new KanataBoardError(`${board.id} has no revision "${revisionId}" (it has ${board.revisions.map((r) => r.id).join(", ")})`);
  if (rev.build.kind !== "kanata-config" || rev.flash.kind !== "kanata-reload" || !rev.device) {
    throw new KanataBoardError(`${board.id} ${rev.id} is not a kanata revision`);
  }
  return { id: rev.id, kanataVersion: rev.build.kanataVersion, tcpPort: rev.flash.tcpPort, driverVersions: rev.flash.driverVersions, deviceName: rev.device.name };
}

/** What a position is on the device: a KeyCode, or the Apple fn/globe key, which has none. */
export type PhysicalKey = { kind: "key"; code: KeyCode } | { kind: "fn" };

export function physicalKeys(board: BoardDefinition): PhysicalKey[] {
  const names = board.physicalKeys;
  if (!names) throw new KanataBoardError(`${board.id} lists no physicalKeys, so kanata can't be told which keys to take`);
  if (names.length !== board.keyCount) throw new KanataBoardError(`${board.id} lists ${names.length} physicalKeys for ${board.keyCount} keys`);
  return names.map((n) => {
    if (n === "FN") return { kind: "fn" } as const;
    if (!isKeyCode(n)) throw new KanataBoardError(`${board.id} physical key "${n}" is not a keycode keyloom knows`);
    return { kind: "key", code: n } as const;
  });
}
