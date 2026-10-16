// `keyloom keyboard add` (22#building-the-board-definition, #storing-the-derived-board): derives a board definition for a keyboard the
// person confirmed, checks it exactly as `keyloom boards check` checks a contributed one, and stores it in the data directory where
// every command finds it beside the shipped boards. Nothing here touches a device.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DerivedBoard, DeriveError, deriveBoard, localBoardId, previewRows } from "../boards/derive/build-board.ts";
import type { Candidate } from "../boards/derive/detect.ts";
import { zmkBootVolume } from "../boards/derive/flash-recipe.ts";
import { keyboardIndex } from "../boards/derive/keyboard-index.ts";
import { PINNED_SOURCES } from "../boards/derive/pins.ts";
import { type Json, defaultLayout, infoChainPaths, layoutSource, toGeometryKeys } from "../boards/derive/qmk-info.ts";
import { boardForCandidate } from "../boards/derive/known.ts";
import { checkBoardDir } from "../boards/check.ts";
import { type GeometryOptions, GeometryError, defaultFetcher, fetchPinned } from "../boards/geometry.ts";
import type { Board } from "../boards/load.ts";
import { listBoards, setUserBoards } from "../boards/registry.ts";
import type { GeometryKey } from "../boards/schema.ts";
import { readUserBoards, userBoardDir, writeUserBoard } from "../boards/user-boards.ts";
import { parsePhysicalLayout } from "../boards/zmk-geometry.ts";
import { cacheDir } from "../persistence/paths.ts";
import type { App } from "./context.ts";
import { UsageError } from "./errors.ts";
import { findCandidate } from "./keyboard-detect.ts";

export type AddDeps = GeometryOptions & {
  /** The boards that count as already known; defaults to every board keyloom has loaded. */
  boards?: Board[];
};

export type AddInput = {
  candidate: string;
  /** 1-based from the top row of the main block. */
  homeRow?: number;
  /** QMK: the layout macro, when the keyboard has several. */
  layout?: string;
  /** ZMK: the controller board a shield runs on. */
  controller?: string;
  /** Replace a derived board of the same id. */
  force?: boolean;
};

export type KeyboardPreview = {
  candidate: { id: string; name: string; firmware: "qmk" | "zmk" };
  keyCount: number;
  /** Row lengths from the top, and the row keyloom would guess is the home row. */
  rows: Array<{ row: number; keys: number }>;
  guessedHomeRow: number;
  layout: string | null;
  /** What is still needed before the board can be written, as the flags that give it. */
  needs: string[];
  /** ZMK: the controllers that provide what the shield requires and whose boot drive keyloom knows. */
  controllers: Array<{ id: string; name: string }>;
};

function controllersFor(c: Candidate): Array<{ id: string; name: string }> {
  const requires = c.entry.kind === "zmk" ? (c.entry.zmk.requires ?? []) : [];
  if (requires.length === 0) return [];
  return keyboardIndex().controllers.filter((k) => zmkBootVolume(k.id) !== undefined && requires.every((r) => k.exposes.includes(r))).map((k) => ({ id: k.id, name: k.name }));
}

function resolveCandidate(id: string): Candidate {
  const c = findCandidate(id);
  if (!c) throw new UsageError(`no keyboard "${id}" in the index. Candidates look like qmk:crkbd/rev1 or zmk:corne; \`keyloom keyboard detect\` lists the ones for what is attached, and \`--search <name>\` finds others`);
  return c;
}

const isMissing = (err: unknown): boolean => err instanceof GeometryError && /returned 404/.test(err.message);

type Source = { geometry: { keys: GeometryKey[]; path: string }; layout: string | null };

/** The pinned firmware tree's geometry for a candidate. This is the only network read: one to five small files, cached by SHA. */
async function readGeometry(c: Candidate, input: Pick<AddInput, "layout">, opts: GeometryOptions): Promise<Source> {
  const fetchText = opts.fetchText ?? defaultFetcher;
  try {
    if (c.entry.kind === "qmk") {
      const e = c.entry.qmk;
      const layout = input.layout === undefined ? defaultLayout(e.layouts, e.aliases) : (e.aliases?.[input.layout] ?? input.layout);
      if (layout === undefined || e.layouts[layout] === undefined) {
        const choices = Object.entries(e.layouts).map(([n, k]) => `${n} (${k} keys)`).join(", ");
        throw new UsageError(input.layout === undefined ? `${e.name} has several layouts and none is the default; choose one with --layout: ${choices}` : `${e.name} has no layout "${input.layout}"; it has ${choices}`);
      }
      const files: Array<{ path: string; info: Json }> = [];
      for (const path of infoChainPaths(e.target)) {
        try {
          files.push({ path, info: JSON.parse(await fetchPinned({ source: { ...PINNED_SOURCES.qmk, ref: "pinned" } }, path, fetchText, opts.cacheDir)) as Json });
        } catch (err) {
          if (!isMissing(err)) throw err;
        }
      }
      const found = layoutSource(files, layout);
      if (!found) throw new UsageError(`QMK's tree has no layout ${layout} for ${e.target} at ${PINNED_SOURCES.qmk.sha.slice(0, 9)}`);
      return { geometry: { keys: toGeometryKeys(found.keys), path: found.path }, layout };
    }
    const z = c.entry.zmk;
    if (z.layout === undefined) {
      throw new UsageError(`ZMK's tree gives ${z.name} no physical layout with key positions that keyloom can read (29 of its shields have one). Contribute the board by hand: docs/blueprint/04-boards-and-contributions.md`);
    }
    const text = await fetchPinned({ source: { ...PINNED_SOURCES.zmk, ref: "pinned" } }, z.layout.file, fetchText, opts.cacheDir);
    return { geometry: { keys: parsePhysicalLayout(text, z.layout.label), path: `${z.layout.file}#${z.layout.label}` }, layout: null };
  } catch (err) {
    if (err instanceof GeometryError) throw new UsageError(`couldn't read ${c.name}'s layout from the pinned firmware tree: ${err.message}. keyloom reads it from GitHub the first time and keeps it in ${cacheDir()}`);
    throw err;
  }
}

/** What `keyboard add` needs from the person, and what it found; writes nothing. */
export async function previewKeyboard(input: Omit<AddInput, "force">, opts: AddDeps = {}): Promise<KeyboardPreview> {
  const c = resolveCandidate(input.candidate);
  const { geometry, layout } = await readGeometry(c, input, { cacheDir: cacheDirFor(opts), ...opts });
  const { rows, guessedHomeRow } = previewRows(geometry.keys);
  const needs: string[] = [];
  if (input.homeRow === undefined) needs.push("--home-row");
  if (c.entry.kind === "zmk" && (c.entry.zmk.requires?.length ?? 0) > 0 && input.controller === undefined) needs.push("--controller");
  return {
    candidate: { id: c.id, name: c.name, firmware: c.firmware }, keyCount: geometry.keys.length,
    rows: rows.map((r, i) => ({ row: i + 1, keys: r.length })), guessedHomeRow, layout, needs, controllers: controllersFor(c),
  };
}

const cacheDirFor = (opts: GeometryOptions): string => opts.cacheDir ?? join(cacheDir(), "geometry");

export type AddOutcome = {
  boardId: string;
  dir: string;
  derived: DerivedBoard["summary"];
  /** Warnings from the check; errors would have stopped the write. */
  warnings: string[];
};

export async function addKeyboard(app: App, input: AddInput, opts: AddDeps = {}): Promise<AddOutcome> {
  const c = resolveCandidate(input.candidate);
  const known = boardForCandidate((opts.boards ?? listBoards()).map((b) => b.definition), c);
  if (known !== undefined && !(input.force === true && known.id === localBoardId(c))) {
    throw new UsageError(`${c.name} is already a board: ${known.id}${known.id.startsWith("local/") ? ` (derived earlier; pass --force to derive it again)` : ""}. Put a config on it with \`keyloom keyboard put <layout> --on ${known.id}\``);
  }
  const providers = controllersFor(c);
  if (input.controller !== undefined && providers.length > 0 && !providers.some((p) => p.id === input.controller)) {
    throw new UsageError(`${input.controller} doesn't provide what ${c.name} needs, or keyloom doesn't know its boot drive. Controllers that do: ${providers.map((p) => p.id).join(", ")}`);
  }
  const geometryOpts = { ...opts, cacheDir: cacheDirFor(opts) };
  const { geometry, layout } = await readGeometry(c, input, geometryOpts);
  if (input.homeRow === undefined) throw new UsageError("say which row is the home row with --home-row <n>, counting from the top row of the main block (1 is the top)");
  let derived: DerivedBoard;
  try {
    derived = deriveBoard({
      candidate: c, geometry, homeRow: input.homeRow,
      ...(layout === null ? {} : { layout }),
      ...(input.controller === undefined ? {} : { controller: input.controller }),
    });
  } catch (err) {
    if (err instanceof DeriveError) throw new UsageError(err.message);
    throw err;
  }

  // The same check a contributed board gets, run on a copy first so a definition that fails it is never stored.
  const staging = await mkdtemp(join(tmpdir(), "keyloom-derive-"));
  try {
    const dir = writeUserBoard(staging, derived);
    const result = await checkBoardDir(dir, geometryOpts);
    if (!result.ok) {
      throw new UsageError(`the derived ${c.name} board fails \`keyloom boards check\`: ${result.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
    }
    const existing = userBoardDir(app.dataDir, derived.definition.id);
    if (input.force !== true && (await Bun.file(join(existing, "board.json")).exists())) {
      throw new UsageError(`${derived.definition.id} is already stored at ${existing}; pass --force to replace it`);
    }
    const stored = writeUserBoard(app.dataDir, derived);
    setUserBoards(readUserBoards(app.dataDir).boards);
    return { boardId: derived.definition.id, dir: stored, derived: derived.summary, warnings: result.issues.filter((i) => i.level === "warning").map((i) => i.message) };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
