// `keyloom boards check <dir>` (04): the facts keyloom validates in a board folder.
import { basename, dirname, resolve } from "node:path";
import { type GeometryOptions, generateGeometry, serializeGeometry } from "./geometry.ts";
import { type Board, loadBoardDir } from "./load.ts";
import { mirrorProblems } from "./mirror.ts";
import { isOnePiece } from "./one-piece.ts";
import type { BoardDefinition, BoardRevision } from "./schema.ts";

export type CheckIssue = { level: "error" | "warning"; message: string };
export type CheckResult = { ok: boolean; issues: CheckIssue[] };

const SKILL_MAX_LINES = 400;

export type CheckOptions = GeometryOptions & {
  /** Skip regenerating geometry from the firmware tree (no network). */
  offline?: boolean;
};

/** Each position 0..keyCount-1 must appear exactly once in `groups`. */
function checkPartition(label: string, keyCount: number, groups: Array<[string, readonly number[]]>, issues: CheckIssue[]): void {
  const seen = new Map<number, string>();
  for (const [group, positions] of groups) {
    for (const p of positions) {
      if (p >= keyCount) {
        issues.push({ level: "error", message: `${label} "${group}" has position ${p}, but keyCount is ${keyCount}` });
      } else if (seen.has(p)) {
        issues.push({ level: "error", message: `position ${p} is in ${label} "${seen.get(p)}" and "${group}"` });
      } else {
        seen.set(p, group);
      }
    }
  }
  const missing: number[] = [];
  for (let p = 0; p < keyCount; p++) if (!seen.has(p)) missing.push(p);
  if (missing.length > 0) issues.push({ level: "error", message: `${label} is missing positions: ${missing.join(", ")}` });
}

/** The recipe fields are validated by the schema; these are the rules that span fields. */
function checkRecipes(def: BoardDefinition, rev: BoardRevision, err: (message: string) => void): void {
  const at = `revision "${rev.id}"`;
  if (def.firmware === "kanata") {
    // A software remapper's recipes are its config file and its reload (21); none of the firmware fields apply.
    if (rev.build.kind !== "kanata-config") err(`${at}: a kanata board builds with kanata-config, not ${rev.build.kind}`);
    if (rev.flash.kind !== "kanata-reload") err(`${at}: a kanata board applies with kanata-reload, not ${rev.flash.kind}`);
    if (rev.qmkTarget) err(`${at}: qmkTarget is for QMK boards`);
    if (rev.detect !== null) err(`${at}: a kanata board is found by device.name, not a USB product ID`);
    if (!rev.device) err(`${at} needs a device, so kanata is told which keyboard to take`);
    if (rev.build.kind === "kanata-config" && rev.source.ref !== `v${rev.build.kanataVersion}`) {
      err(`${at}: source.ref ${rev.source.ref} must be v${rev.build.kanataVersion}, the kanata release the config targets`);
    }
    return;
  }
  if (rev.build.kind === "kanata-config" || rev.flash.kind === "kanata-reload") err(`${at}: kanata recipes are for kanata boards`);
  if (rev.device) err(`${at}: device is for kanata boards`);
  if (def.firmware === "qmk") {
    if (!rev.qmkTarget) err(`${at} needs a qmkTarget`);
    if (rev.build.kind !== "qmk-docker") err(`${at}: a QMK board builds with qmk-docker, not ${rev.build.kind}`);
    if (rev.flash.kind === "uf2-drives" && rev.build.kind === "qmk-docker" && rev.build.artifact !== "uf2") err(`${at}: uf2-drives flashing needs build.artifact "uf2"`);
    if (rev.flash.kind === "zapp" && rev.build.kind === "qmk-docker" && (rev.build.artifact ?? "bin") !== "bin") err(`${at}: zapp flashing needs build.artifact "bin"`);
    if (rev.flash.kind === "dfu-tool" && rev.build.kind === "qmk-docker") {
      const want = rev.flash.tool === "dfu-util" ? "bin" : "hex";
      if ((rev.build.artifact ?? "bin") !== want) err(`${at}: ${rev.flash.tool} flashing needs build.artifact "${want}"`);
    }
    return;
  }
  if (rev.build.kind === "qmk-docker") err(`${at}: a ZMK board builds with zmk-moergo-template or zmk-west-docker, not qmk-docker`);
  if (rev.flash.kind !== "uf2-drives") err(`${at}: a ZMK board flashes with uf2-drives, not ${rev.flash.kind}`);
  if (rev.qmkTarget) err(`${at}: qmkTarget is for QMK boards`);
  if (rev.build.kind === "zmk-west-docker" && rev.flash.kind === "uf2-drives") {
    if (rev.build.rgbMatrix) {
      const rgb = rev.build.rgbMatrix;
      if (rev.build.targets.length !== 2 || !rev.build.targets.some((t) => t.id === rgb.leftTarget)) {
        err(`${at}: RGB matrix needs two targets and a matching leftTarget`);
      }
      const positions = def.lighting?.ledPositions;
      const split = rev.build.rgbMatrix.leftLedCount;
      if (!positions || split >= positions.length || new Set(positions).size !== positions.length || positions.some((p) => p >= def.keyCount)) {
        err(`${at}: RGB matrix needs a unique, in-range LED map covering both halves`);
      } else if (positions.slice(0, split).some((p) => !def.hands.left.includes(p)) || positions.slice(split).some((p) => !def.hands.right.includes(p))) {
        err(`${at}: RGB LED order must list the left half before the right half`);
      }
      if (!rev.flash.handsFree) err(`${at}: RGB matrix needs the keyloom module for its external power rail`);
    }
    const targets = new Set(rev.build.targets.map((t) => t.id));
    if (targets.size !== rev.build.targets.length) err(`${at}: two build targets have the same id`);
    const flashed = new Set<string>();
    for (const step of rev.flash.steps) {
      if (step.target === undefined) err(`${at}: flash step "${step.label}" needs a target, because a west build makes one UF2 per target`);
      else if (!targets.has(step.target)) err(`${at}: flash step "${step.label}" names target "${step.target}", which the build doesn't have`);
      else flashed.add(step.target);
    }
    for (const t of targets) if (!flashed.has(t)) err(`${at}: build target "${t}" has no flash step`);
  }
  if (rev.build.kind === "zmk-moergo-template" && rev.flash.kind === "uf2-drives" && rev.flash.steps.some((s) => s.target !== undefined)) {
    err(`${at}: flash steps name a target, but zmk-moergo-template makes one UF2 for every step`);
  }
}

/** A hand-written geometry has no firmware file to be checked against, so it is checked for what can be seen: no two keys on top of each other, and a warning while nobody has measured it. */
function checkHandAuthored(board: Board, issues: CheckIssue[]): void {
  const { geometry } = board;
  if (!("kind" in geometry.source)) {
    if (board.definition.firmware === "kanata") issues.push({ level: "error", message: "a kanata board's geometry.json must say it is hand-authored" });
    return;
  }
  if (board.definition.firmware !== "kanata") issues.push({ level: "error", message: "hand-authored geometry is for software-remapper boards; firmware boards derive it from their pinned tree" });
  if (!geometry.source.verified) issues.push({ level: "warning", message: "geometry.json is hand-authored and not yet checked against the device (S36)" });
  const keys = geometry.keys;
  for (let a = 0; a < keys.length; a++) {
    for (let b = a + 1; b < keys.length; b++) {
      const p = keys[a];
      const q = keys[b];
      if (!p || !q) continue;
      // A small tolerance, so keys that touch edge to edge don't count as overlapping.
      const eps = 1e-6;
      if (p.x < q.x + q.w - eps && q.x < p.x + p.w - eps && p.y < q.y + q.h - eps && q.y < p.y + p.h - eps) {
        issues.push({ level: "error", message: `geometry.json keys ${a} and ${b} overlap` });
      }
    }
  }
}

function checkFacts(board: Board, dir: string, issues: CheckIssue[]): void {
  const { definition: def, geometry } = board;
  const err = (message: string) => issues.push({ level: "error", message });

  const folder = `${basename(dirname(resolve(dir)))}/${basename(resolve(dir))}`;
  if (folder !== def.id) err(`board id "${def.id}" must equal the folder path "${folder}"`);

  if (geometry.keys.length !== def.keyCount) {
    err(`keyCount is ${def.keyCount}, but geometry.json has ${geometry.keys.length} keys`);
  }

  checkPartition("hands", def.keyCount, [["left", def.hands.left], ["right", def.hands.right]], issues);

  const fingerPositions = Object.keys(def.fingers).map(Number);
  const badFingerKeys = Object.keys(def.fingers).filter((k) => !/^\d+$/.test(k));
  for (const k of badFingerKeys) err(`fingers key "${k}" is not a position number`);
  checkPartition("fingers", def.keyCount, fingerPositions.filter(Number.isInteger).map((p) => [String(p), [p]] as [string, number[]]), issues);

  checkPartition("rows", def.keyCount, Object.entries(def.rows), issues);

  for (const problem of mirrorProblems(def)) err(problem);
  // A display override that points past the geometry would otherwise only fail when someone opens the editor.
  const drawn = [...(def.display?.rotate ?? []).flatMap((r) => r.positions), ...(def.display?.shift ?? []).flatMap((r) => r.positions), ...Object.keys(def.display?.keycaps ?? {}).map(Number), ...Object.keys(def.display?.keyShapes ?? {}).map(Number)];
  for (const p of drawn) if (p >= def.keyCount) err(`display refers to position ${p}, but keyCount is ${def.keyCount}`);
  // A staggered laptop keyboard has no mirror image, so a software board may leave the map empty (21); so may any one-piece board (D-350).
  const emptyOnOnePiece = Object.keys(def.mirror).length === 0 && isOnePiece(def, geometry.keys);
  if (def.firmware !== "kanata") {
    if (!emptyOnOnePiece) for (const p of def.hands.left) {
      if (!(String(p) in def.mirror)) issues.push({ level: "warning", message: `left position ${p} has no mirror entry` });
    }
  } else if (Object.keys(def.mirror).length > 0) {
    err("a kanata board has no mirrored pairs; leave mirror empty");
  }

  const importerFirmware = (id: string) => (id === "karabiner-json" ? "kanata" : id.startsWith("zmk") ? "zmk" : "qmk");
  for (const id of def.importers) {
    // Oryx exports are QMK-only, and a ZMK keymap is not read by the QMK importers.
    const reads = id === "oryx-source" ? "qmk" : importerFirmware(id);
    if (reads !== def.firmware) err(`importer "${id}" reads ${reads.toUpperCase()} sources, but the board is ${def.firmware}`);
  }
  checkHandAuthored(board, issues);

  const ids = new Set<string>();
  for (const rev of def.revisions) {
    if (ids.has(rev.id)) err(`revision id "${rev.id}" appears twice`);
    ids.add(rev.id);
    checkRecipes(def, rev, err);
  }

  if (board.skill !== undefined) {
    const lines = board.skill.split("\n").length;
    if (lines > SKILL_MAX_LINES) {
      issues.push({ level: "warning", message: `SKILL.md has ${lines} lines; past ${SKILL_MAX_LINES} every agent turn pays for it` });
    }
  }
}

async function checkGeometryDrift(board: Board, opts: CheckOptions, issues: CheckIssue[]): Promise<void> {
  const { definition: def, geometry } = board;
  const [first, ...rest] = def.revisions;
  if (!first) return;
  try {
    const regenerated = await generateGeometry(def, first, opts);
    if (serializeGeometry(regenerated) !== serializeGeometry(geometry)) {
      issues.push({
        level: "error",
        message: `geometry.json differs from ${"path" in regenerated.source ? regenerated.source.path : "its source"} at ${first.source.sha}; run: keyloom boards geometry ${def.id}`,
      });
    }
    // geometry.json is shared by all revisions, which is only right while the revisions agree.
    for (const rev of rest) {
      const other = await generateGeometry(def, rev, opts);
      if (JSON.stringify(other.keys) !== JSON.stringify(regenerated.keys)) {
        issues.push({
          level: "error",
          message: `revision "${rev.id}" has different key geometry from "${first.id}"; per-revision geometry is not supported`,
        });
      }
    }
  } catch (err) {
    issues.push({ level: "error", message: `could not regenerate geometry: ${(err as Error).message}` });
  }
}

export async function checkBoardDir(dir: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const issues: CheckIssue[] = [];
  let board: Board;
  try {
    board = await loadBoardDir(dir);
  } catch (err) {
    return { ok: false, issues: [{ level: "error", message: (err as Error).message }] };
  }
  checkFacts(board, dir, issues);
  if (!opts.offline && board.definition.firmware !== "kanata") await checkGeometryDrift(board, opts, issues);
  return { ok: !issues.some((i) => i.level === "error"), issues };
}
