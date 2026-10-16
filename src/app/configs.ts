// Use cases for configs (25, D-300): a config is a layout; this lists them, makes new ones, and renames, archives and deletes them.
// Which config is on a keyboard is the sync engine's to act on (`useConfig` in sync.ts); here it is only read and protected.
import { identityLayout } from "../firmware/kanata/identity.ts";
import { plainSummary } from "../layout/history-summary.ts";
import type { Layout } from "../layout/schema.ts";
import { boardConfigs, deleteLayoutCascade, getBoardConfig, renameLayoutRow, setArchivedAt } from "../persistence/configs.ts";
import {
  type LayoutRow, NameTakenError, createLayout, findLayoutRow, findRevision, listLayoutRows,
} from "../persistence/layouts.ts";
import { activeSyncs } from "../persistence/syncs.ts";
import { transact } from "../persistence/transaction.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError } from "./errors.ts";
import { versionRevision } from "./versions.ts";

export type ConfigView = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
  headRevisionId: string;
  createdAt: number;
  updatedAt: number;
  /** The one the sync engine keeps on this board's keyboard (D-300). */
  onKeyboard: boolean;
  archivedAt: number | null;
  copiedFrom: { layoutId: string; layoutName: string | null; revisionId: string } | null;
};

const viewOf = (app: App, row: LayoutRow, onKeyboardId: string | undefined): ConfigView => ({
  id: row.id, name: row.name, boardId: row.boardId, boardName: showBoard(row.boardId).definition.name, headRevisionId: row.headRevisionId,
  createdAt: row.createdAt, updatedAt: row.updatedAt, onKeyboard: row.id === onKeyboardId, archivedAt: row.archivedAt,
  copiedFrom: row.copiedFrom && { ...row.copiedFrom, layoutName: findLayoutRow(app.db, row.copiedFrom.layoutId)?.name ?? null },
});

export type ListConfigsOptions = { board?: string; includeArchived?: boolean };

/** A board's configs, newest edited first (the order the config menu shows), or every board's. Archived ones are left out unless asked for. */
export function listConfigs(app: App, opts: ListConfigsOptions = {}): ConfigView[] {
  const on = boardConfigs(app.db);
  return listLayoutRows(app.db)
    .filter((l) => (opts.board === undefined || l.boardId === opts.board) && (opts.includeArchived === true || l.archivedAt === null))
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1))
    .map((l) => viewOf(app, l, on.get(l.boardId)));
}

export function showConfig(app: App, ref: string): ConfigView {
  const row = requireConfig(app, ref);
  return viewOf(app, row, getBoardConfig(app.db, row.boardId));
}

function requireConfig(app: App, ref: string): LayoutRow {
  const row = findLayoutRow(app.db, ref);
  if (!row) throw new NotFoundError(`no config "${ref}"`);
  return row;
}

const failNoVersion = (source: LayoutRow, ref: string): never => {
  throw new NotFoundError(`config ${source.name} has no version "${ref}"`);
};

function checkedName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new UsageError("the config's name must not be empty");
  if (trimmed.startsWith("lay_")) throw new UsageError('a config name can\'t start with "lay_"; that prefix is for IDs');
  return trimmed;
}

export type NewConfigInput = { name: string } & (
  /** A copy of the config's head, or of one revision of it, or of the revision a version names. */
  | { from: "config"; config: string; revision?: string; version?: string }
  /** The board's starting point: see `blankDocument`. */
  | { from: "blank"; board: string }
);

/**
 * The document a blank config starts from. keyloom holds no default keymap for a QMK or ZMK board (the firmware tree's own is not
 * in the repo), so those start as one empty Base layer; a software remapper starts as the identity map, because an empty one would
 * leave the laptop's keyboard typing nothing the moment it is put on.
 */
export function blankDocument(boardId: string): Layout {
  const def = showBoard(boardId).definition;
  if (def.firmware === "kanata") return identityLayout(def);
  return {
    schemaVersion: 1, boardId: def.id, firmware: def.firmware,
    layers: [{ id: "base", name: "Base", bindings: Array.from({ length: def.keyCount }, () => ({ kind: "none" as const })) }],
    macros: [], tapDances: [], combos: [], holdTapProfiles: [], settings: [], passthrough: [],
  };
}

/**
 * Makes a config. It is never put on the keyboard: only `useConfig` does that, except on a board with no config yet, where
 * the first one is the board's. A copy starts its own history at the copied document, with a link back to where it came from.
 */
export function newConfig(app: App, input: NewConfigInput): ConfigView {
  const name = checkedName(input.name);
  let layout: Layout;
  let summary: string;
  let copiedFrom: { layoutId: string; revisionId: string } | undefined;
  if (input.from === "blank") {
    layout = blankDocument(input.board);
    summary = `Started from the ${showBoard(input.board).definition.name} blank`;
  } else {
    const source = requireConfig(app, input.config);
    let revisionId = source.headRevisionId;
    if (input.revision !== undefined && input.version !== undefined) throw new UsageError("name a revision or a version to copy, not both");
    if (input.version !== undefined) {
      revisionId = versionRevision(app, source, input.version) ?? failNoVersion(source, input.version);
    } else if (input.revision !== undefined) {
      revisionId = input.revision;
    }
    const found = findRevision(app.db, source.id, revisionId);
    if (!found) throw new NotFoundError(`config ${source.name} has no revision "${revisionId}"`);
    layout = found.layout;
    copiedFrom = { layoutId: source.id, revisionId };
    summary = `Copied from ${source.name}: ${plainSummary(found.revision.summary)}`;
  }
  try {
    const created = createLayout(app.db, { name, layout, summary, origin: "import", ...(copiedFrom ? { copiedFrom } : {}) });
    return viewOf(app, created.layout, getBoardConfig(app.db, created.layout.boardId));
  } catch (err) {
    if (err instanceof NameTakenError) throw new UsageError(`a config named "${name}" already exists; pick another name`);
    throw err;
  }
}

export function renameConfig(app: App, ref: string, to: string): ConfigView {
  const row = requireConfig(app, ref);
  const name = checkedName(to);
  try {
    renameLayoutRow(app.db, row.id, name);
  } catch (err) {
    if (err instanceof NameTakenError) throw new UsageError(err.message);
    throw err;
  }
  return showConfig(app, row.id);
}

/** Hides a config but keeps everything; the one on a keyboard can't be hidden, because the engine would be keeping a keyboard on something nobody can see. */
export function archiveConfig(app: App, ref: string, now = Date.now()): ConfigView {
  return transact(app.db, () => {
    const row = requireConfig(app, ref);
    if (getBoardConfig(app.db, row.boardId) === row.id) {
      throw new UsageError(`${row.name} is the config on your ${showBoard(row.boardId).definition.name}; put another on before archiving it`);
    }
    if (row.archivedAt === null) setArchivedAt(app.db, row.id, now);
    return showConfig(app, row.id);
  });
}

export function restoreConfig(app: App, ref: string): ConfigView {
  return transact(app.db, () => {
    const row = requireConfig(app, ref);
    setArchivedAt(app.db, row.id, null);
    return showConfig(app, row.id);
  });
}

/**
 * Deletes a config for good, after its name is typed. It refuses the config on a keyboard, and a config a sync is using,
 * because both would pull the data out from under a keyboard that is being kept on it.
 */
export function deleteConfig(app: App, ref: string, confirmName: string): { id: string; name: string } {
  return transact(app.db, () => {
    const row = requireConfig(app, ref);
    if (confirmName !== row.name) throw new UsageError(`type the config's name (${row.name}) to delete it`);
    if (getBoardConfig(app.db, row.boardId) === row.id) {
      throw new UsageError(`${row.name} is the config on your ${showBoard(row.boardId).definition.name}; put another on before deleting it`);
    }
    if (activeSyncs(app.db).some((s) => s.layoutId === row.id)) throw new UsageError(`a sync of ${row.name} is running; wait for it to finish`);
    deleteLayoutCascade(app.db, row.id);
    return { id: row.id, name: row.name };
  });
}
