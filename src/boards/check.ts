// `keyloom boards check <dir>` (04): the facts keyloom validates in a board folder.
import { basename, dirname, resolve } from "node:path";
import { type GeometryOptions, generateGeometry, serializeGeometry } from "./geometry.ts";
import { type Board, loadBoardDir } from "./load.ts";

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

  const left = new Set(def.hands.left);
  const right = new Set(def.hands.right);
  const targets = new Set<number>();
  for (const [from, to] of Object.entries(def.mirror)) {
    const f = Number(from);
    if (!left.has(f)) err(`mirror source ${from} is not a left-hand position`);
    if (!right.has(to)) err(`mirror target ${to} (from ${from}) is not a right-hand position`);
    if (targets.has(to)) err(`mirror target ${to} is used twice`);
    targets.add(to);
  }
  for (const p of def.hands.left) {
    if (!(String(p) in def.mirror)) issues.push({ level: "warning", message: `left position ${p} has no mirror entry` });
  }

  const ids = new Set<string>();
  for (const rev of def.revisions) {
    if (ids.has(rev.id)) err(`revision id "${rev.id}" appears twice`);
    ids.add(rev.id);
    if (def.firmware === "qmk" && !rev.qmkTarget) err(`revision "${rev.id}" needs a qmkTarget`);
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
        message: `geometry.json differs from ${regenerated.source.path} at ${first.source.sha}; run: keyloom boards geometry ${def.id}`,
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
  if (!opts.offline) await checkGeometryDrift(board, opts, issues);
  return { ok: !issues.some((i) => i.level === "error"), issues };
}
