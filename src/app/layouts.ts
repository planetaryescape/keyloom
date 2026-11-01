// Use cases for layouts: import, export, list, get (01#modules). Export writes the keyloom layout document
// (src/layout/export-document.ts); an import recognises that document before the other tools' formats.
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Board } from "../boards/load.ts";
import { ImportError, importOryxSource } from "../firmware/qmk/import.ts";
import { KarabinerImportError, importKarabiner } from "../firmware/kanata/karabiner.ts";
import { ZmkImportError, importZmkSource } from "../firmware/zmk/import.ts";
import {
  type LayoutExportDocument, type LayoutExportProbe, buildLayoutExportDocument, probeLayoutExport,
} from "../layout/export-document.ts";
import type { ImportReport, NativeItem } from "../layout/import-report.ts";
import type { Binding, Layout } from "../layout/schema.ts";
import { ReviewActivitiesSchema, type ReviewActivity } from "../layout/review-workload.ts";
import { setReviewActivities } from "../persistence/review-workloads.ts";
import { transact } from "../persistence/transaction.ts";
import {
  NameTakenError, type LayoutRow, type RevisionRow, createLayout, findLayoutRow, findRevision, listLayoutRows,
} from "../persistence/layouts.ts";
import type { App } from "./context.ts";
import { showBoard } from "./boards.ts";
import { NotFoundError, UsageError } from "./errors.ts";

/** A portable layout document is far smaller than this; the cap only stops a huge file being read as one. */
const MAX_LAYOUT_EXPORT_BYTES = 8_000_000;

const BINDING_KINDS: readonly Binding["kind"][] = ["key", "modifier", "holdTap", "layer", "macro", "tapDance", "transparent", "none", "native"];

export type ImportInput = {
  /** Board ID, such as `zsa/moonlander`. */
  board: string;
  /** An Oryx source zip or the folder it unpacks to; or a Layout Editor `.keymap` file, or a folder holding one; or a keyloom layout document. */
  source: string;
  /** Layout name; derived from the source when omitted. */
  name?: string;
  reviewActivities?: ReviewActivity[];
};

export type ImportOutcome = { layoutId: string; revisionId: string; name: string; report: ImportReport };

type Imported = { layout: Layout; report: ImportReport; suggestedName: string };

type Importer = (path: string, board: Board) => Promise<Imported>;
const qmkKeymap: Importer = (path, board) => importOryxSource(path, board.definition);
const zmkKeymap: Importer = (path, board) => importZmkSource(path, board.definition);
// Read-only: the file is BK's, tracked in his dotfiles, and keyloom never writes to it (D-233).
const karabinerJson: Importer = async (path, board) => {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new KarabinerImportError(`${path} doesn't exist`);
  return importKarabiner(await file.text(), board.definition, "karabiner.json");
};

// `qmk-keymap` and `zmk-keymap` are the neutral names for boards whose users aren't on Oryx or the Layout
// Editor: the readers take any QMK keymap folder (keymap.c) or ZMK .keymap file, whoever wrote it.
const IMPORTERS = new Map<string, Importer>([
  ["oryx-source", qmkKeymap],
  ["qmk-keymap", qmkKeymap],
  ["zmk-layout-editor-keymap", zmkKeymap],
  ["zmk-keymap", zmkKeymap],
  ["karabiner-json", karabinerJson],
]);

/**
 * Reads a file as a keyloom layout document, by its shape. A missing path and a folder are `not-keyloom`, so
 * each of the other importers keeps giving its own message for what it can't read.
 */
async function readLayoutExport(path: string): Promise<LayoutExportProbe> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch {
    return { kind: "not-keyloom" };
  }
  if (!info.isFile() || info.size > MAX_LAYOUT_EXPORT_BYTES) return { kind: "not-keyloom" };
  try {
    return probeLayoutExport(await readFile(path, "utf8"));
  } catch {
    return { kind: "not-keyloom" };
  }
}

/** The import report for a document keyloom itself wrote: the counts a reader would see from any importer. */
function reportOfLayout(layout: Layout): ImportReport {
  const bindings = Object.fromEntries(BINDING_KINDS.map((kind) => [kind, 0])) as ImportReport["bindings"];
  const native: NativeItem[] = [];
  for (const layer of layout.layers) {
    for (const [position, binding] of layer.bindings.entries()) {
      bindings[binding.kind] += 1;
      if (binding.kind === "native") native.push({ layerId: layer.id, position, source: binding.source, label: binding.label, reason: "kept as written" });
    }
  }
  return {
    boardId: layout.boardId, layers: layout.layers.length, keysPerLayer: layout.layers[0]?.bindings.length ?? 0, bindings,
    macros: layout.macros.map((m) => m.name), tapDances: layout.tapDances.map((t) => t.name), combos: layout.combos.length,
    settings: layout.settings.length, profiles: layout.holdTapProfiles.map((p) => p.name), native,
    passthrough: layout.passthrough.map((p) => ({ file: p.file, anchor: p.anchor, refersToLayerIndices: p.refersToLayerIndices })), warnings: [],
  };
}

/** Stores an imported document as a new layout. A derived name is made unique by suffix; an explicit clash is refused. */
function storeImported(app: App, imported: Imported, explicit: string | undefined, activities?: ReviewActivity[]): ImportOutcome {
  const { layout, report, suggestedName } = imported;
  const summary = `Imported ${report.layers} layers of ${report.keysPerLayer} keys from ${suggestedName}`;
  // The unique index decides, so two imports racing for the same name can't both win.
  const base = explicit ?? suggestedName;
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      const created = transact(app.db, () => {
        const made = createLayout(app.db, { name, layout, summary, origin: "import" });
        if (activities !== undefined) setReviewActivities(app.db, made.layout.id, [...activities].sort());
        return made;
      });
      return { layoutId: created.layout.id, revisionId: created.revision.id, name, report };
    } catch (err) {
      if (!(err instanceof NameTakenError)) throw err;
      if (explicit) throw new UsageError(`${err.message}; pick another with --name`);
      if (attempt >= 100) throw err;
    }
  }
}

/** Imports a document keyloom wrote, binding it to the board the caller named. */
function importExportedLayout(app: App, input: ImportInput, board: Board, explicit: string | undefined, document: LayoutExportDocument): ImportOutcome {
  const wanted = board.definition.id;
  if (document.board_id !== document.layout.boardId) {
    throw new UsageError(`${input.source} is damaged: its board_id is ${document.board_id}, but its layout is for ${document.layout.boardId}`);
  }
  if (document.layout.boardId !== wanted) {
    throw new UsageError(`${input.source} is a layout for ${document.layout.boardId}, not ${wanted}; pass --board ${document.layout.boardId}`);
  }
  return storeImported(app, { layout: document.layout, report: reportOfLayout(document.layout), suggestedName: document.layout_name ?? `${board.definition.name} layout` }, explicit, input.reviewActivities);
}

export async function importLayout(app: App, input: ImportInput): Promise<ImportOutcome> {
  if (input.reviewActivities !== undefined && !ReviewActivitiesSchema.safeParse(input.reviewActivities).success) throw new UsageError("invalid review activities");
  const board = showBoard(input.board);

  const explicit = input.name?.trim();
  if (input.name !== undefined && !explicit) throw new UsageError("--name must not be empty");
  if (explicit?.startsWith("lay_")) throw new UsageError('a layout name can\'t start with "lay_"; that prefix is for IDs');

  const exported = await readLayoutExport(input.source);
  if (exported.kind === "malformed") throw new UsageError(`${input.source} looks like a keyloom layout document, but ${exported.reason}`);
  if (exported.kind === "keyloom") return importExportedLayout(app, input, board, explicit, exported.document);

  const importer = board.definition.importers.map((id) => IMPORTERS.get(id)).find((f) => f !== undefined);
  if (!importer) throw new UsageError(`board ${board.definition.id} has no importer keyloom can run (${board.definition.importers.join(", ")})`);

  let result: Imported;
  try {
    result = await importer(input.source, board);
  } catch (err) {
    if (err instanceof ImportError || err instanceof ZmkImportError || err instanceof KarabinerImportError) throw new UsageError(err.message);
    throw err;
  }
  return storeImported(app, result, explicit, input.reviewActivities);
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

export type ExportOutcome = {
  layoutId: string;
  name: string;
  boardId: string;
  revisionId: string;
  /** The absolute path written. */
  path: string;
  document: LayoutExportDocument;
};

/** The document itself, for the API read; it writes nothing. */
export function layoutExportDocument(app: App, ref: string, revisionId?: string): LayoutExportDocument {
  const view = getLayout(app, ref, revisionId);
  return buildLayoutExportDocument({ name: view.layout.name, revisionId: view.revision.id, layout: view.document });
}

/**
 * Writes the layout as a keyloom layout document. The file appears whole or not at all: it is written beside
 * the target and renamed into place, so a failure midway leaves the previous file untouched.
 */
export async function exportLayout(app: App, ref: string, opts: { out: string; revisionId?: string }): Promise<ExportOutcome> {
  const view = getLayout(app, ref, opts.revisionId);
  const path = resolve(opts.out);
  const document = buildLayoutExportDocument({ name: view.layout.name, revisionId: view.revision.id, layout: view.document });
  await writeLayoutExport(path, opts.out, document);
  return { layoutId: view.layout.id, name: view.layout.name, boardId: view.layout.boardId, revisionId: view.revision.id, path, document };
}

async function writeLayoutExport(path: string, shown: string, document: LayoutExportDocument): Promise<void> {
  const dir = dirname(path);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(dir);
  } catch {
    throw new UsageError(`the folder ${dir} doesn't exist; make it first`);
  }
  if (!info.isDirectory()) throw new UsageError(`${dir} is not a folder`);

  const existing = await stat(path).catch(() => undefined);
  if (existing?.isDirectory()) throw new UsageError(`${shown} is a folder; name a file such as ${shown}/layout.json`);

  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => undefined);
    const code = (err as { code?: string }).code;
    if (code === "EACCES" || code === "EPERM" || code === "ENOSPC" || code === "EROFS") {
      throw new UsageError(`couldn't write ${shown}: ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
  }
}
