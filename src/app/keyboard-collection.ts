import { listBoards } from "../boards/registry.ts";
import { getBoardConfig, setArchivedAt, setBoardConfig } from "../persistence/configs.ts";
import { listLayoutRows } from "../persistence/layouts.ts";
import { removedKeyboards, setKeyboardRemoved } from "../persistence/keyboard-collection.ts";
import { activeSyncs, finishSync, getBoardSync, setPaused } from "../persistence/syncs.ts";
import { processAlive } from "../firmware/toolchain/lock.ts";
import { transact } from "../persistence/transaction.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError } from "./errors.ts";
import { firmwareBusy } from "./firmware.ts";

export type CollectionKeyboard = {
  boardId: string; name: string; removedAt: number | null; layoutId: string | null; configCount: number; paused: boolean; modelled: boolean;
};

export function listSetupLayouts(app: App) {
  const removed = removedKeyboards(app.db);
  return listLayoutRows(app.db).filter((l) => !removed.has(l.boardId));
}

/** Includes archived-only keyboards for recovery, but never confuses the supported-board catalogue with the person's setup. */
export function listKeyboardCollection(app: App): CollectionKeyboard[] {
  const layouts = listLayoutRows(app.db);
  const removed = removedKeyboards(app.db);
  return listBoards().flatMap(({ definition: board }) => {
    const own = layouts.filter((l) => l.boardId === board.id);
    if (own.length === 0 && !removed.has(board.id) && !board.id.startsWith("local/")) return [];
    const live = own.filter((l) => l.archivedAt === null);
    const selected = getBoardConfig(app.db, board.id);
    const layout = own.find((l) => l.id === selected && l.archivedAt === null) ?? live[0] ?? own[0];
    return [{ boardId: board.id, name: board.name, removedAt: removed.get(board.id) ?? (own.length > 0 && live.length === 0 ? Math.max(...own.map((l) => l.archivedAt ?? 0)) : null),
      layoutId: layout?.id ?? null, configCount: own.length, paused: getBoardSync(app.db, board.id).paused, modelled: (board.display?.case?.length ?? 0) > 0 }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.boardId.localeCompare(b.boardId));
}

function requireKeyboard(app: App, boardId: string): CollectionKeyboard {
  const keyboard = listKeyboardCollection(app).find((k) => k.boardId === boardId);
  if (!keyboard) throw new NotFoundError(`no keyboard "${boardId}" in your setup`);
  return keyboard;
}

/** No firmware writes and no config deletion. A running build/flash must finish before collection membership changes. */
export function removeKeyboard(app: App, boardId: string, now = Date.now()): CollectionKeyboard {
  return transact(app.db, () => {
    const keyboard = requireKeyboard(app, boardId);
    for (const row of activeSyncs(app.db).filter((sync) => sync.boardId === boardId)) {
      if (processAlive(row.pid)) throw new UsageError("a build or keyboard write is running; wait for it to finish before removing a keyboard");
      finishSync(app.db, row.id, { status: "failed", failure: "interrupted", error: "keyloom stopped before this sync finished." }, now);
    }
    if (firmwareBusy(app)) throw new UsageError("a build or keyboard write is running; wait for it to finish before removing a keyboard");
    setPaused(app.db, boardId, true);
    setKeyboardRemoved(app.db, boardId, keyboard.removedAt ?? now);
    return requireKeyboard(app, boardId);
  });
}

/** Restore one usable config if this is an old archived-only board. Sync stays paused until the person explicitly resumes it. */
export function restoreKeyboard(app: App, boardId: string): CollectionKeyboard {
  return transact(app.db, () => {
    const keyboard = requireKeyboard(app, boardId);
    if (keyboard.removedAt === null) return keyboard;
    setPaused(app.db, boardId, true);
    if (keyboard.layoutId !== null) {
      setArchivedAt(app.db, keyboard.layoutId, null);
      setBoardConfig(app.db, boardId, keyboard.layoutId);
    }
    setKeyboardRemoved(app.db, boardId, null);
    return requireKeyboard(app, boardId);
  });
}
