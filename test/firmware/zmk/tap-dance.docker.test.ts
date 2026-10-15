// S16 on ZMK: the same key scripts as QMK, run on generated tap dances in ZMK's own emulator (native_posix_64) for the
// Glove80 (MoErgo's image) and the Corne (ZMK's west image). Gated, because it needs Docker and the images:
//   KEYLOOM_DOCKER_TESTS=zmk bun test test/firmware/zmk/tap-dance.docker.test.ts
// With KEYLOOM_EVIDENCE_DIR set it also writes what ZMK sent, for docs/research/spikes/S16.md.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { loadBoardDir } from "../../../src/boards/load.ts";
import type { EmulatorEvent } from "../../../src/firmware/emulate/types.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import { emulateZmk } from "../../../src/firmware/zmk/emulate.ts";
import { generateZmkSource } from "../../../src/firmware/zmk/generate.ts";
import { importZmkSource } from "../../../src/firmware/zmk/import.ts";
import type { Binding, Layout, TapDance } from "../../../src/layout/schema.ts";
import { cacheDir } from "../../../src/persistence/paths.ts";
import { SCENARIOS, plan, split } from "../../helpers/tap-dance-scenarios.ts";
import { tempDir } from "../../helpers/tmp.ts";
import { STYLE_FIXTURE } from "../../helpers/zmk.ts";

const gated = ["1", "zmk"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;
const TIMEOUT = 290_000;
const ROOT = `${import.meta.dir}/../../..`;

/** Esc tapped, Caps Lock double-tapped: the promise of rung 14. */
const ESC_CAPS: TapDance = { id: "esc-caps", name: "Esc and Caps", tap: { kind: "key", code: "ESCAPE" }, doubleTap: { kind: "key", code: "CAPS_LOCK" } };
/** All four slots. */
const FULL: TapDance = {
  id: "all-slots", name: "All slots", tap: { kind: "key", code: "ESCAPE" }, hold: { kind: "modifier", mods: ["LSFT"] },
  doubleTap: { kind: "key", code: "CAPS_LOCK" }, tapThenHold: { kind: "key", code: "TAB" },
};

async function emulate(boardDir: string, keymap: string, positions: [number, number], other: number, name: string) {
  const board = await loadBoardDir(`${ROOT}/${boardDir}`);
  const { layout: imported } = await importZmkSource(keymap, board.definition);
  const place = (b: Binding, p: number, id: string): Binding => (p === positions[0] || p === positions[1] ? { kind: "tapDance", tapDanceId: id } : b);
  const layout: Layout = {
    ...imported,
    tapDances: [ESC_CAPS, FULL],
    layers: imported.layers.map((l, i) =>
      i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (p === positions[0] ? place(b, p, ESC_CAPS.id) : p === positions[1] ? place(b, p, FULL.id) : b)) } : l,
    ),
  };
  const rev = board.definition.revisions[0];
  const source = generateZmkSource({
    layout, board: board.definition, geometry: board.geometry, revisionId: "rev_S16",
    ...(rev?.build.kind === "zmk-west-docker" ? { keymapName: rev.build.keymapName } : {}),
  });
  const p = plan(positions, other);
  const dir = tempDir();
  const slug = board.definition.id.replace("/", "-");
  const log = new LogSink(join(dir, "emulate.log"));
  try {
    const events: EmulatorEvent[] = p.events;
    const r = await emulateZmk({
      board: board.definition, boardRevision: "default", source, events,
      checkoutDir: checkoutDirFor(board), workDir: join(dir, "work"), imageContextDir: join(cacheDir(), "images", slug), log, containerName: `keyloom-emu-td-${name}-${process.pid}`,
    });
    const by = split(r.reports, p.windows, (k) => (k === positions[0] ? "esc-caps" : "all-slots"));
    const evidence = process.env.KEYLOOM_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(join(evidence, `zmk-${name}.json`), `${JSON.stringify({ source: source.files.find((f) => f.path.endsWith(".keymap"))?.content, scenarios: SCENARIOS, reports: by, warnings: r.warnings }, null, 2)}\n`);
    }
    return by;
  } finally {
    log.close();
  }
}

const sends = (reports: Array<{ kind: string; mods?: string[]; keys?: string[] }>) =>
  reports.filter((r) => r.kind === "keyboard").map((r) => [...(r.mods ?? []), ...(r.keys ?? [])].join("+"));

function expectSlots(by: Awaited<ReturnType<typeof emulate>>) {
  // Esc/Caps: a tap is Escape, a double-tap is Caps Lock, and neither leaves a key stuck down.
  expect(sends(by["esc-caps: tap"] ?? [])).toEqual(["ESCAPE", ""]);
  expect(sends(by["esc-caps: double-tap"] ?? [])).toEqual(["CAPS_LOCK", ""]);
  // All four slots.
  expect(sends(by["all-slots: tap"] ?? [])).toEqual(["ESCAPE", ""]);
  expect(sends(by["all-slots: double-tap"] ?? [])).toEqual(["CAPS_LOCK", ""]);
  expect(sends(by["all-slots: hold"] ?? [])).toEqual(["LSFT", ""]);
  expect(sends(by["all-slots: tap then hold"] ?? [])).toEqual(["TAB", ""]);
}

gated("tap dances on the Glove80 (moergo-sc/zmk in the MoErgo image)", () => {
  test("tap, double-tap, hold and tap-then-hold do what the model says", async () => {
    expectSlots(await emulate("boards/moergo/glove80", STYLE_FIXTURE, [24, 25], 29, "glove80"));
  }, TIMEOUT);
});

gated("tap dances on the Corne (upstream ZMK in zmk-build-arm)", () => {
  test("tap, double-tap, hold and tap-then-hold do what the model says", async () => {
    expectSlots(await emulate("boards/foostan/corne", `${ROOT}/test/fixtures/zmk/corne/corne.keymap`, [2, 3], 7, "corne"));
  }, TIMEOUT);
});

const MACROS = [
  { id: "copy-switch-paste", name: "Copy, switch, paste", steps: [
    { op: "tap" as const, code: "C", mods: ["LGUI" as const] }, { op: "waitMs" as const, ms: 100 },
    { op: "tap" as const, code: "TAB", mods: ["LGUI" as const] }, { op: "waitMs" as const, ms: 300 },
    { op: "tap" as const, code: "V", mods: ["LGUI" as const] },
  ] },
  { id: "sign-off", name: "Sign off", steps: [{ op: "text" as const, text: 'Thanks, "BK"!' }] },
];

async function emulateMacro(boardDir: string, keymap: string, positions: [number, number], name: string) {
  const board = await loadBoardDir(`${ROOT}/${boardDir}`);
  const { layout: imported } = await importZmkSource(keymap, board.definition);
  const place: Record<number, string> = { [positions[0]]: MACROS[0]?.id as string, [positions[1]]: MACROS[1]?.id as string };
  const layout: Layout = {
    ...imported,
    macros: [...imported.macros, ...MACROS],
    layers: imported.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p): Binding => (place[p] ? { kind: "macro", macroId: place[p] as string } : b)) } : l)),
  };
  const rev = board.definition.revisions[0];
  const source = generateZmkSource({
    layout, board: board.definition, geometry: board.geometry, revisionId: "rev_S16",
    ...(rev?.build.kind === "zmk-west-docker" ? { keymapName: rev.build.keymapName } : {}),
  });
  const dir = tempDir();
  const log = new LogSink(join(dir, "emulate.log"));
  try {
    const events: EmulatorEvent[] = [
      { at: 0, position: positions[0], action: "press" }, { at: 40, position: positions[0], action: "release" },
      { at: 3000, position: positions[1], action: "press" }, { at: 3040, position: positions[1], action: "release" },
    ];
    const r = await emulateZmk({
      board: board.definition, boardRevision: "default", source, events,
      checkoutDir: checkoutDirFor(board), workDir: join(dir, "work"), imageContextDir: join(cacheDir(), "images", board.definition.id.replace("/", "-")), log, containerName: `keyloom-emu-macro-${name}-${process.pid}`,
    });
    if (process.env.KEYLOOM_EVIDENCE_DIR) writeFileSync(join(process.env.KEYLOOM_EVIDENCE_DIR, `zmk-macros-${name}.json`), `${JSON.stringify({ reports: r.reports, text: r.text }, null, 2)}\n`);
    return r;
  } finally {
    log.close();
  }
}

const expectMacros = (r: Awaited<ReturnType<typeof emulateMacro>>) => {
  const chords = r.reports.filter((x) => x.kind === "keyboard" && x.keys.length > 0 && x.at < 3000).map((x) => (x.kind === "keyboard" ? [...x.mods, ...x.keys].join("+") : ""));
  expect(chords).toEqual(["LGUI+C", "LGUI+TAB", "LGUI+V"]);
  // The pause is the time with nothing down between one chord's release and the next chord's press. ZMK's own 15 ms
  // wait is what it is without a waitMs step, so the gaps must come out at the step's 100 and 300 ms, not at 15.
  const kb = r.reports.flatMap((x) => (x.kind === "keyboard" && x.at < 3000 ? [x] : []));
  const downs = kb.filter((x) => x.keys.length > 0);
  const gaps = downs.slice(1).map((d, i) => d.at - (kb.find((x) => x.at > (downs[i] as { at: number }).at && x.keys.length === 0) as { at: number }).at);
  expect(gaps.length).toBe(2);
  expect(Math.abs((gaps[0] as number) - 100)).toBeLessThanOrEqual(5);
  expect(Math.abs((gaps[1] as number) - 300)).toBeLessThanOrEqual(5);
  expect(r.text).toBe('Thanks, "BK"!');
};

gated("macros with text steps on ZMK", () => {
  test("the Glove80 types copy, switch, paste with its waits, and the text step", async () => {
    expectMacros(await emulateMacro("boards/moergo/glove80", STYLE_FIXTURE, [24, 25], "glove80"));
  }, TIMEOUT);
  test("the Corne does the same", async () => {
    expectMacros(await emulateMacro("boards/foostan/corne", `${ROOT}/test/fixtures/zmk/corne/corne.keymap`, [2, 3], "corne"));
  }, TIMEOUT);
});
