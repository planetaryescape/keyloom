// S16 on QMK's real core: BK's Oryx source and keyloom's regenerated source, run through the same key scripts,
// must send the same reports for every tap dance slot. Gated, because it needs Docker and the pinned checkout:
//   KEYLOOM_DOCKER_TESTS=qmk bun test test/firmware/qmk/tap-dance.docker.test.ts
// With KEYLOOM_EVIDENCE_DIR set it also writes what each source sent, for docs/research/spikes/S16.md.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { emulateQmk } from "../../../src/firmware/qmk/emulate.ts";
import { type GeneratedSource, generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { importOryxSource } from "../../../src/firmware/qmk/import.ts";
import type { Layout, TapDance } from "../../../src/layout/schema.ts";
import { FIXTURE_DIR, moonlander } from "../../helpers/board.ts";
import { SCENARIOS, plan, split } from "../../helpers/tap-dance-scenarios.ts";

const gated = ["1", "qmk"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;

const TD0 = 34; // Hyper+Space, double-tap [
const TD1 = 35; // Alt+Space, double-tap ]
const A = 29;

const board = await moonlander();
const oryx = await importOryxSource(FIXTURE_DIR, board.definition);
const original: GeneratedSource = {
  keymapName: "oryx",
  files: await Promise.all(["keymap.c", "config.h", "rules.mk", "keymap.json"].map(async (path) => ({ path, content: await Bun.file(`${FIXTURE_DIR}/${path}`).text() }))),
};
const regenerated = (layout: Layout) => generateQmkSource({ layout, board: board.definition, revisionId: "rev_S16" });

gated("Oryx's tap dances and keyloom's regeneration of them, on QMK's real core", () => {
  const TIMEOUT = 600_000;
  const { events, windows } = plan([TD0, TD1], A);
  const label = (key: number) => `TD${key === TD0 ? 0 : 1}`;

  async function run(source: GeneratedSource) {
    const r = await emulateQmk({ board: board.definition, boardRevisionId: "reva", source, checkoutDir: checkoutDirFor(board), events });
    return split(r.reports, windows, label);
  }

  test("every scenario sends the same reports from the Oryx source and from keyloom's regeneration", async () => {
    const fromOryx = await run(original);
    const fromKeyloom = await run(regenerated(oryx.layout));
    const evidence = process.env.KEYLOOM_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(join(evidence, "qmk-oryx-vs-keyloom.json"), `${JSON.stringify({ scenarios: SCENARIOS, oryx: fromOryx, keyloom: fromKeyloom }, null, 2)}\n`);
    }
    // The scenarios must actually exercise the dances: the double-tap sends [ and the tap sends the Hyper chord.
    const dt = fromOryx["TD0: double-tap"] ?? [];
    expect(dt.some((r) => r.kind === "keyboard" && r.keys.includes("LEFT_BRACKET"))).toBe(true);
    expect((fromOryx["TD0: tap"] ?? []).some((r) => r.kind === "keyboard" && r.mods.length === 4 && r.keys.includes("SPACE"))).toBe(true);
    for (const name of Object.keys(fromOryx)) expect({ name, reports: fromKeyloom[name] }).toEqual({ name, reports: fromOryx[name] });
  }, TIMEOUT);

  test("Esc and Caps Lock, and a dance with every slot, behave as the model says on QMK", async () => {
    // The same two dances the ZMK test runs, so S16 can lay the two firmwares side by side.
    const escCaps: TapDance = { id: "esc-caps", name: "Esc and Caps", tap: { kind: "key", code: "ESCAPE" }, doubleTap: { kind: "key", code: "CAPS_LOCK" } };
    const full: TapDance = {
      id: "all-slots", name: "All slots", tap: { kind: "key", code: "ESCAPE" }, hold: { kind: "modifier", mods: ["LSFT"] },
      doubleTap: { kind: "key", code: "CAPS_LOCK" }, tapThenHold: { kind: "key", code: "TAB" },
    };
    const place: Record<number, string> = { 0: escCaps.id, 1: full.id };
    const layout: Layout = {
      ...oryx.layout,
      tapDances: [...oryx.layout.tapDances, escCaps, full],
      layers: oryx.layout.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (place[p] ? { kind: "tapDance" as const, tapDanceId: place[p] as string } : b)) } : l)),
    };
    const p = plan([0, 1], A);
    const r = await emulateQmk({ board: board.definition, boardRevisionId: "reva", source: regenerated(layout), checkoutDir: checkoutDirFor(board), events: p.events });
    const by = split(r.reports, p.windows, (k) => (k === 0 ? "esc-caps" : "all-slots"));
    const keys = (name: string) => (by[name] ?? []).filter((x) => x.kind === "keyboard").map((x) => (x.kind === "keyboard" ? [...x.mods, ...x.keys].join("+") : ""));
    expect(keys("esc-caps: tap")).toEqual(["ESCAPE", ""]);
    expect(keys("esc-caps: double-tap")).toEqual(["CAPS_LOCK", ""]);
    expect(keys("all-slots: tap")).toEqual(["ESCAPE", ""]);
    expect(keys("all-slots: double-tap")).toEqual(["CAPS_LOCK", ""]);
    expect(keys("all-slots: hold")).toEqual(["LSFT", ""]);
    expect(keys("all-slots: tap then hold")).toEqual(["TAB", ""]);
    if (process.env.KEYLOOM_EVIDENCE_DIR) writeFileSync(join(process.env.KEYLOOM_EVIDENCE_DIR, "qmk-esc-caps.json"), `${JSON.stringify({ scenarios: SCENARIOS, reports: by }, null, 2)}\n`);
  }, TIMEOUT);
});

gated("macros with text steps, on QMK's real core", () => {
  test("copy, switch, paste is three chords with the waits between them, and a text step types its characters", async () => {
    const macros = [
      { id: "copy-switch-paste", name: "Copy, switch, paste", steps: [
        { op: "tap" as const, code: "C", mods: ["LGUI" as const] }, { op: "waitMs" as const, ms: 100 },
        { op: "tap" as const, code: "TAB", mods: ["LGUI" as const] }, { op: "waitMs" as const, ms: 300 },
        { op: "tap" as const, code: "V", mods: ["LGUI" as const] },
      ] },
      { id: "sign-off", name: "Sign off", steps: [{ op: "text" as const, text: 'Thanks, "BK"!' }] },
    ];
    const place: Record<number, string> = { 1: "copy-switch-paste", 2: "sign-off" };
    const layout: Layout = {
      ...oryx.layout,
      macros: [...oryx.layout.macros, ...macros],
      layers: oryx.layout.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (place[p] ? { kind: "macro" as const, macroId: place[p] as string } : b)) } : l)),
    };
    const run = (position: number) =>
      emulateQmk({ board: board.definition, boardRevisionId: "reva", source: regenerated(layout), checkoutDir: checkoutDirFor(board), events: [{ at: 0, position, action: "press" }, { at: 40, position, action: "release" }] });
    const csp = await run(1);
    const chords = csp.reports.filter((r) => r.kind === "keyboard" && r.keys.length > 0).map((r) => (r.kind === "keyboard" ? [...r.mods, ...r.keys].join("+") : ""));
    expect(chords).toEqual(["LGUI+C", "LGUI+TAB", "LGUI+V"]);
    const at = csp.reports.filter((r) => r.kind === "keyboard" && r.keys.length > 0).map((r) => r.at);
    expect((at[1] as number) - (at[0] as number)).toBeGreaterThanOrEqual(100);
    expect((at[2] as number) - (at[1] as number)).toBeGreaterThanOrEqual(300);
    const sign = await run(2);
    expect(sign.text).toBe('Thanks, "BK"!');
    if (process.env.KEYLOOM_EVIDENCE_DIR) writeFileSync(join(process.env.KEYLOOM_EVIDENCE_DIR, "qmk-macros.json"), `${JSON.stringify({ copySwitchPaste: csp, signOff: sign }, null, 2)}\n`);
  }, 600_000);
});
