// Use cases for layouts: import, list, get (01#modules).
import type { Board } from "../boards/load.ts";
import { ImportError, importOryxSource } from "../firmware/qmk/import.ts";
import { ZmkImportError, importZmkSource } from "../firmware/zmk/import.ts";
import type { ImportReport } from "../layout/import-report.ts";
import type { Layout } from "../layout/schema.ts";
import {
  NameTakenError, type LayoutRow, type RevisionRow, createLayout, findLayoutRow, findRevision, listLayoutRows,
} from "../persistence/layouts.ts";
import type { App } from "./context.ts";
import { showBoard } from "./boards.ts";
import { NotFoundError, UsageError } from "./errors.ts";

export type ImportInput = {
  /** Board ID, such as `zsa/moonlander`. */
  board: string;
  /** An Oryx source zip or the folder it unpacks to; or a Layout Editor `.keymap` file, or a folder holding one. */
  source: string;
  /** Layout name; derived from the source when omitted. */
  name?: string;
};

export type ImportOutcome = { layoutId: string; revisionId: string; name: string; report: ImportReport };

type Imported = { layout: Layout; report: ImportReport; suggestedName: string };

type Importer = (path: string, board: Board) => Promise<Imported>;
const qmkKeymap: Importer = (path, board) => importOryxSource(path, board.definition);
const zmkKeymap: Importer = (path, board) => importZmkSource(path, board.definition);

// `qmk-keymap` and `zmk-keymap` are the neutral names for boards whose users aren't on Oryx or the Layout
// Editor: the readers take any QMK keymap folder (keymap.c) or ZMK .keymap file, whoever wrote it.
const IMPORTERS = new Map<string, Importer>([
  ["oryx-source", qmkKeymap],
  ["qmk-keymap", qmkKeymap],
  ["zmk-layout-editor-keymap", zmkKeymap],
  ["zmk-keymap", zmkKeymap],
]);

export async function importLayout(app: App, input: ImportInput): Promise<ImportOutcome> {
  const board = showBoard(input.board);
  const importer = board.definition.importers.map((id) => IMPORTERS.get(id)).find((f) => f !== undefined);
  if (!importer) throw new UsageError(`board ${board.definition.id} has no importer keyloom can run (${board.definition.importers.join(", ")})`);

  const explicit = input.name?.trim();
  if (input.name !== undefined && !explicit) throw new UsageError("--name must not be empty");
  if (explicit?.startsWith("lay_")) throw new UsageError('a layout name can\'t start with "lay_"; that prefix is for IDs');

  let result: Imported;
  try {
    result = await importer(input.source, board);
  } catch (err) {
    if (err instanceof ImportError || err instanceof ZmkImportError) throw new UsageError(err.message);
    throw err;
  }
  const { layout, report, suggestedName } = result;
  const summary = `Imported ${report.layers} layers of ${report.keysPerLayer} keys from ${suggestedName}`;

  // A derived name is made unique by suffix. The unique index decides, so two imports racing for
  // the same name can't both win.
  const base = explicit ?? suggestedName;
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      const created = createLayout(app.db, { name, layout, summary, origin: "import" });
      return { layoutId: created.layout.id, revisionId: created.revision.id, name, report };
    } catch (err) {
      if (!(err instanceof NameTakenError)) throw err;
      if (explicit) throw new UsageError(`${err.message}; pick another with --name`);
      if (attempt >= 100) throw err;
    }
  }
}

export function listLayouts(app: App): LayoutRow[] {
  return listLayoutRows(app.db);
}

export type LayoutView = {
  layout: LayoutRow;
  revision: RevisionRow;
  document: Layout;
  board: Board;
};

/** `ref` is a layout ID or a unique name; `revisionId` defaults to the head revision. */
export function getLayout(app: App, ref: string, revisionId?: string): LayoutView {
  const layout = findLayoutRow(app.db, ref);
  if (!layout) throw new NotFoundError(`no layout "${ref}"`);
  const found = findRevision(app.db, layout.id, revisionId ?? layout.headRevisionId);
  if (!found) throw new NotFoundError(`layout ${layout.name} has no revision "${revisionId}"`);
  return { layout, revision: found.revision, document: found.layout, board: showBoard(layout.boardId) };
}
