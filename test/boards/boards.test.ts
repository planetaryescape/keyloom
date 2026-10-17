import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkBoardDir } from "../../src/boards/check.ts";
import { GeometryError, generateGeometry, serializeGeometry } from "../../src/boards/geometry.ts";
import { BoardFormatError, BoardNotFoundError, loadBoardDir, parseBoard } from "../../src/boards/load.ts";
import { getBoard, listBoards } from "../../src/boards/registry.ts";
import { MOONLANDER_DIR, moonlander } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

const FIX = `${import.meta.dir}/../fixtures/qmk`;
const kbReva = await Bun.file(`${FIX}/zsa-moonlander-reva-keyboard.json`).text();
const kbRevb = await Bun.file(`${FIX}/zsa-moonlander-revb-keyboard.json`).text();

/** Serves the recorded keyboard.json files for the pinned URLs; anything else is a test bug. */
const offlineFetch = async (url: string): Promise<string> => {
  if (url.endsWith("/keyboards/zsa/moonlander/reva/keyboard.json")) return kbReva;
  if (url.endsWith("/keyboards/zsa/moonlander/revb/keyboard.json")) return kbRevb;
  throw new Error(`unexpected fetch ${url}`);
};

/** A copy of the Moonlander folder at `<tmp>/zsa/moonlander`, with `edit` applied to board.json. */
async function boardCopy(edit?: (board: Record<string, any>) => void): Promise<string> {
  const root = tempDir();
  const dir = join(root, "zsa", "moonlander");
  mkdirSync(dir, { recursive: true });
  cpSync(MOONLANDER_DIR, dir, { recursive: true });
  if (edit) {
    const board = await Bun.file(join(dir, "board.json")).json();
    edit(board);
    await Bun.write(join(dir, "board.json"), JSON.stringify(board));
  }
  return dir;
}

const errors = (r: Awaited<ReturnType<typeof checkBoardDir>>) => r.issues.filter((i) => i.level === "error").map((i) => i.message);

describe("Moonlander geometry", () => {
  test("reva and revb keyboard.json have identical LAYOUT geometry (checked at the pinned SHA)", async () => {
    const { definition } = await moonlander();
    const [reva, revb] = definition.revisions;
    if (!reva || !revb) throw new Error("expected two revisions");
    const a = await generateGeometry(definition, reva, { fetchText: offlineFetch });
    const b = await generateGeometry(definition, revb, { fetchText: offlineFetch });
    expect(a.keys).toEqual(b.keys);
    expect(a.keys).toHaveLength(72);
    expect("path" in a.source && a.source.path).toBe("keyboards/zsa/moonlander/reva/keyboard.json");
  });

  test("the committed geometry.json is byte-identical to what the generator writes", async () => {
    const board = await moonlander();
    const rev = board.definition.revisions[0];
    if (!rev) throw new Error("no revision");
    const generated = await generateGeometry(board.definition, rev, { fetchText: offlineFetch });
    expect(serializeGeometry(generated)).toBe(await Bun.file(`${MOONLANDER_DIR}/geometry.json`).text());
  });

  test("keys are in binding order: first the number row's outer key, last the right thumb", async () => {
    const { geometry } = await moonlander();
    expect(geometry.keys[0]).toMatchObject({ x: 0, y: 0.375 });
    expect(geometry.keys[71]).toMatchObject({ x: 11, y: 5.5, h: 1.5 });
    expect(geometry.keys[59]).toMatchObject({ w: 2 });
  });

  test("a keyboard.json without LAYOUT, with the wrong key count, or that isn't JSON is an error", async () => {
    const { definition } = await moonlander();
    const rev = definition.revisions[0];
    if (!rev) throw new Error("no revision");
    const fetchWith = (body: string) => async () => body;
    await expect(generateGeometry(definition, rev, { fetchText: fetchWith("{not json") })).rejects.toThrow(GeometryError);
    await expect(generateGeometry(definition, rev, { fetchText: fetchWith(JSON.stringify({ layouts: { LAYOUT_a: { layout: [] }, LAYOUT_b: { layout: [] } } })) })).rejects.toThrow(/no layout named LAYOUT/);
    await expect(generateGeometry(definition, rev, { fetchText: fetchWith(JSON.stringify({ layouts: { LAYOUT: { layout: [{ x: 0, y: 0 }] } } })) })).rejects.toThrow(/1 keys/);
    await expect(generateGeometry({ ...definition, firmware: "zmk" }, rev, { fetchText: offlineFetch })).rejects.toThrow(/key_physical_attrs/);
  });

  test("fetched files are cached by SHA and reused", async () => {
    const { definition } = await moonlander();
    const rev = definition.revisions[0];
    if (!rev) throw new Error("no revision");
    const cacheDir = tempDir();
    let calls = 0;
    const counting = async (url: string) => { calls++; return offlineFetch(url); };
    await generateGeometry(definition, rev, { fetchText: counting, cacheDir });
    await generateGeometry(definition, rev, { fetchText: counting, cacheDir });
    expect(calls).toBe(1);
  });
});

describe("boards check", () => {
  test("the Moonlander passes, including regeneration", async () => {
    const r = await checkBoardDir(MOONLANDER_DIR, { fetchText: offlineFetch });
    expect(r).toEqual({ ok: true, issues: [] });
  });

  test("hands, fingers and rows cover each position exactly once", async () => {
    const { definition: d } = await moonlander();
    expect([...d.hands.left, ...d.hands.right].sort((a, b) => a - b)).toEqual(Array.from({ length: 72 }, (_, i) => i));
    expect(Object.keys(d.fingers)).toHaveLength(72);
    expect(Object.values(d.rows).flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 72 }, (_, i) => i));
  });

  test("hands match the fixture's chordal_hold_layout", async () => {
    const { definition: d } = await moonlander();
    const c = await Bun.file(`${import.meta.dir}/../fixtures/oryx/synchronized/keymap.c`).text();
    const block = c.slice(c.indexOf("chordal_hold_layout"), c.indexOf(");", c.indexOf("chordal_hold_layout")));
    const hands = [...block.matchAll(/'([LR])'/g)].map((m) => m[1]);
    expect(hands).toHaveLength(72);
    hands.forEach((h, i) => expect(h === "L" ? d.hands.left : d.hands.right).toContain(i));
  });

  test("mirror maps each left key to the right key at the mirrored x and same y", async () => {
    const { definition: d, geometry } = await moonlander();
    for (const [from, to] of Object.entries(d.mirror)) {
      const a = geometry.keys[Number(from)];
      const b = geometry.keys[to];
      expect(b?.y).toBe(a?.y);
      expect((a?.x ?? 0) + (a?.w ?? 0) + (b?.x ?? 0)).toBe(17); // mirrored about x = 8.5, so x + w + x' = 17
      expect(b?.w).toBe(a?.w);
    }
    expect(Object.keys(d.mirror)).toHaveLength(36);
  });

  test("a position missing from hands is an error naming it", async () => {
    const dir = await boardCopy((b) => { b.hands.left = b.hands.left.filter((p: number) => p !== 5); });
    expect(errors(await checkBoardDir(dir, { offline: true }))).toContain("hands is missing positions: 5");
  });

  test("a position in both hands, or in two row groups, is an error", async () => {
    const dir = await boardCopy((b) => { b.hands.right.push(0); b.rows.thumb.push(0); });
    const e = errors(await checkBoardDir(dir, { offline: true }));
    expect(e).toContain('position 0 is in hands "left" and "right"');
    expect(e.some((m) => m.startsWith("position 0 is in rows "))).toBe(true);
  });

  test("a finger for a position that doesn't exist, or a missing one, is an error", async () => {
    const dir = await boardCopy((b) => { b.fingers["72"] = "left-pinky"; delete b.fingers["3"]; });
    const e = errors(await checkBoardDir(dir, { offline: true }));
    expect(e.some((m) => m.includes("position 72") && m.includes("keyCount is 72"))).toBe(true);
    expect(e).toContain("fingers is missing positions: 3");
  });

  test("a non-numeric finger key is an error", async () => {
    const dir = await boardCopy((b) => { b.fingers.thumb = "x"; });
    expect(errors(await checkBoardDir(dir, { offline: true })).some((m) => m.includes('"thumb" is not a position'))).toBe(true);
  });

  test("keyCount that disagrees with geometry.json is an error", async () => {
    const dir = await boardCopy((b) => { b.keyCount = 70; });
    expect(errors(await checkBoardDir(dir, { offline: true }))).toContain("keyCount is 70, but geometry.json has 72 keys");
  });

  test("a display override or keycap colour past the last position is an error", async () => {
    const dir = await boardCopy((b) => {
      b.display.rotate[0].positions.push(72);
      b.display.keycaps["80"] = "red";
    });
    const e = errors(await checkBoardDir(dir, { offline: true }));
    expect(e).toContain("display refers to position 72, but keyCount is 72");
    expect(e).toContain("display refers to position 80, but keyCount is 72");
  });

  test("a keycap colour outside the palette is rejected", async () => {
    const dir = await boardCopy((b) => { b.display.keycaps["59"] = "chartreuse"; });
    expect((await checkBoardDir(dir, { offline: true })).issues.some((i) => i.level === "error")).toBe(true);
  });

  test("a mirror that points at the wrong hand or reuses a target is an error", async () => {
    const dir = await boardCopy((b) => { b.mirror["0"] = 1; b.mirror["1"] = 1; });
    const e = errors(await checkBoardDir(dir, { offline: true }));
    expect(e).toContain("mirror target 1 (from 0) is not a right-hand position");
    expect(e).toContain("mirror target 1 is used twice");
  });

  test("a mirror pair across rows is an error; an empty mirror warns per key on a split board and not at all on a one-piece one", async () => {
    const crossed = await boardCopy((b) => { b.mirror = { "15": 40 }; });
    expect(errors(await checkBoardDir(crossed, { offline: true })).some((m) => m.startsWith("mirror 15 -> 40 crosses rows"))).toBe(true);
    const warnings = async (dir: string) => (await checkBoardDir(dir, { offline: true })).issues.filter((i) => i.level === "warning" && i.message.includes("mirror"));
    expect((await warnings(await boardCopy((b) => { b.mirror = {}; }))).length).toBe(36);
    const onePiece = await boardCopy((b) => { b.mirror = {}; b.display.case = [{ hand: null, kind: "body", d: "M-1,-1 L20,-1 L20,8 L-1,8 Z" }]; });
    expect(await warnings(onePiece)).toEqual([]);
  });

  test("a folder whose path doesn't match the board id is an error", async () => {
    const root = tempDir();
    const dir = join(root, "zsa", "other");
    cpSync(MOONLANDER_DIR, dir, { recursive: true });
    expect(errors(await checkBoardDir(dir, { offline: true }))).toContain('board id "zsa/moonlander" must equal the folder path "zsa/other"');
  });

  test("a QMK revision without a qmkTarget, and a repeated revision id, are errors", async () => {
    const dir = await boardCopy((b) => { delete b.revisions[0].qmkTarget; b.revisions[1].id = "reva"; });
    const e = errors(await checkBoardDir(dir, { offline: true }));
    expect(e).toContain('revision "reva" needs a qmkTarget');
    expect(e).toContain('revision id "reva" appears twice');
  });

  test("an over-long SKILL.md warns", async () => {
    const dir = await boardCopy();
    await Bun.write(join(dir, "SKILL.md"), "line\n".repeat(401));
    const r = await checkBoardDir(dir, { offline: true });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.level === "warning" && i.message.includes("SKILL.md"))).toBe(true);
  });

  test("drift: a geometry.json that differs from the firmware tree fails", async () => {
    const dir = await boardCopy();
    const g = await Bun.file(join(dir, "geometry.json")).json();
    g.keys[3].x += 0.5;
    await Bun.write(join(dir, "geometry.json"), JSON.stringify(g));
    const r = await checkBoardDir(dir, { fetchText: offlineFetch });
    expect(r.ok).toBe(false);
    expect(errors(r).some((m) => m.startsWith("geometry.json differs from keyboards/zsa/moonlander/reva/keyboard.json"))).toBe(true);
  });

  test("drift: revisions whose geometry differs fail, since geometry.json is shared", async () => {
    const moved = JSON.parse(kbRevb);
    moved.layouts.LAYOUT.layout[0].x = 9;
    const r = await checkBoardDir(MOONLANDER_DIR, {
      fetchText: async (url) => (url.includes("/revb/") ? JSON.stringify(moved) : kbReva),
    });
    expect(errors(r).some((m) => m.includes('revision "revb" has different key geometry'))).toBe(true);
  });

  test("a firmware tree that can't be fetched fails the check rather than passing it", async () => {
    const r = await checkBoardDir(MOONLANDER_DIR, { fetchText: async () => { throw new Error("offline"); } });
    expect(r.ok).toBe(false);
    expect(errors(r)[0]).toContain("could not regenerate geometry: offline");
  });

  test("--offline skips regeneration", async () => {
    const dir = await boardCopy();
    const g = await Bun.file(join(dir, "geometry.json")).json();
    g.keys[3].x += 0.5;
    await Bun.write(join(dir, "geometry.json"), JSON.stringify(g));
    expect((await checkBoardDir(dir, { offline: true })).ok).toBe(true);
  });

  test("a folder with no board.json, no geometry.json, or broken JSON reports it", async () => {
    const empty = tempDir();
    expect(errors(await checkBoardDir(empty, { offline: true }))[0]).toContain("no board.json");
    const noGeo = await boardCopy();
    await Bun.$`rm ${join(noGeo, "geometry.json")}`.quiet();
    expect(errors(await checkBoardDir(noGeo, { offline: true }))[0]).toContain("no geometry.json");
    const broken = await boardCopy();
    await Bun.write(join(broken, "board.json"), "{oops");
    expect(errors(await checkBoardDir(broken, { offline: true }))[0]).toContain("not valid JSON");
    const wrongShape = await boardCopy();
    await Bun.write(join(wrongShape, "board.json"), JSON.stringify({ id: "zsa/moonlander" }));
    expect(errors(await checkBoardDir(wrongShape, { offline: true }))[0]).toContain("board.json is invalid");
  });
});

describe("loading", () => {
  test("loadBoardDir returns the definition and geometry", async () => {
    const b = await loadBoardDir(MOONLANDER_DIR);
    expect(b.definition.id).toBe("zsa/moonlander");
    expect(b.definition.revisions.map((r) => [r.id, r.qmkTarget, r.detect?.usbProductId])).toEqual([
      ["reva", "zsa/moonlander/reva", "0x1969"],
      ["revb", "zsa/moonlander/revb", "0x1972"],
    ]);
    for (const r of b.definition.revisions) {
      expect(r.build.kind).toBe("qmk-docker");
      expect(r.flash.kind).toBe("zapp");
      expect(r.source.sha).toBe("93b2b9ec3368f86c5eb5a2e3f934049f8daef885");
    }
    expect(b.definition.importers).toEqual(["oryx-source"]);
  });

  test("errors are typed", async () => {
    await expect(loadBoardDir(tempDir())).rejects.toThrow(BoardNotFoundError);
    expect(() => parseBoard("{", "{}")).toThrow(BoardFormatError);
  });

  test("the embedded registry agrees with the folder", async () => {
    const onDisk = await moonlander();
    expect(getBoard("zsa/moonlander").definition).toEqual(onDisk.definition);
    expect(getBoard("zsa/moonlander").geometry).toEqual(onDisk.geometry);
    expect(listBoards().map((b) => b.definition.id)).toContain("zsa/moonlander");
  });

  test("unknown and prototype board ids are not found", () => {
    for (const id of ["nope/nope", "constructor", "__proto__", ""]) expect(() => getBoard(id)).toThrow(BoardNotFoundError);
  });
});
