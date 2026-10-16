// The real thing: generated source built by QMK in Docker. Gated, because it needs Docker, the pinned
// checkout (created on first run, ~500 MB) and about a minute per build:
//   KEYLOOM_DOCKER_TESTS=1 bun test test/firmware/qmk/docker.test.ts
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { dfuProblem } from "../../../src/firmware/qmk/dfu.ts";
import { buildQmk } from "../../../src/firmware/qmk/build.ts";
import { generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { markerInFirmware, buildMarker } from "../../../src/firmware/qmk/handsfree.ts";
import { importOryxSource } from "../../../src/firmware/qmk/import.ts";
import { definedSymbols } from "../../../src/firmware/toolchain/elf.ts";
import { LogSink } from "../../../src/firmware/toolchain/run.ts";
import type { Layout } from "../../../src/layout/schema.ts";
import { FIXTURE_DIR, moonlander } from "../../helpers/board.ts";
import { tempDir } from "../../helpers/tmp.ts";

const gated = process.env.KEYLOOM_DOCKER_TESTS === "1" ? describe : describe.skip;

// SHA-256 of what the pinned fork and image build from BK's unchanged Oryx source for revb (S5,
// zsa_moonlander_revb_oryxs3.bin). Generated source that is equivalent must give the same bytes.
const ORYX_REVB_SHA256 = "fcceb9fba425d4fe40ae4b53c541891edba6fe357c01f22af4b9310d3fa37e4d";
// The same for reva, which BK's Moonlander is (S1: USB product 0x1969, read 2026-10-15). Built with the
// S5 command from the unchanged fixture as keymap `oryxs3`; 67,268 bytes.
const ORYX_REVA_SHA256 = "ccd90fdeda0a7f5e7c0017d1b5c8a9585fa2f08faeb341859ba05183d94a43fe";

gated("a generated keymap built in Docker", () => {
  const TIMEOUT = 20 * 60_000;

  // Passed or not, the plain builds below are the byte-identical-to-Oryx check: hands-free is opt-in per build (D-070).
  async function build(layout: Layout, boardRevisionId: "reva" | "revb", handsFree?: { buildId: string }) {
    const board = await moonlander();
    const dir = tempDir();
    const log = new LogSink(join(dir, "build.log"));
    const artifactPath = join(dir, "out.bin");
    const r = await buildQmk({
      board: board.definition, boardRevisionId, checkoutDir: checkoutDirFor(board), artifactPath, log, containerName: `keyloom-test-${process.pid}-${boardRevisionId}`,
      source: generateQmkSource({ layout, board: board.definition, revisionId: "rev_test", boardRevisionId, ...(handsFree ? { handsFree } : {}) }),
    });
    log.close();
    return { ...r, bytes: await Bun.file(artifactPath).bytes() };
  }

  test("BK's Oryx layout, round-tripped through keyloom, builds for revb to the same binary Oryx's source gives", async () => {
    const board = await moonlander();
    const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
    const built = await build(layout, "revb");
    expect(dfuProblem(built.bytes, "3297:2003")).toBeUndefined();
    expect(new Bun.CryptoHasher("sha256").update(built.bytes).digest("hex")).toBe(ORYX_REVB_SHA256);
  }, TIMEOUT);

  test("BK's Oryx layout, round-tripped through keyloom, builds for reva to the same binary Oryx's source gives", async () => {
    const board = await moonlander();
    const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
    const built = await build(layout, "reva");
    expect(dfuProblem(built.bytes, "0483:df11")).toBeUndefined();
    expect(new Bun.CryptoHasher("sha256").update(built.bytes).digest("hex")).toBe(ORYX_REVA_SHA256);
  }, TIMEOUT);

  test("an edited layout with a new macro, a layer-scoped combo, a combo timeout and a tapping-term override compiles for reva", async () => {
    const board = await moonlander();
    const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
    const edited: Layout = {
      ...layout,
      layers: layout.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (p === 4 ? { kind: "key" as const, code: "Z", mods: ["LCTL" as const, "LSFT" as const] } : p === 5 ? { kind: "macro" as const, macroId: "new" } : b)) } : l)),
      macros: [...layout.macros, { id: "new", name: "Paste twice", steps: [{ op: "tap", code: "V", mods: ["LGUI"] }, { op: "waitMs", ms: 40 }, { op: "tap", code: "V", mods: ["LGUI"] }, { op: "press", code: "A", mods: ["LSFT"] }, { op: "release", code: "A", mods: ["LSFT"] }] }],
      combos: [...layout.combos, { id: "extra", name: "Extra", positions: [45, 46], layerIds: ["layer-0", "layer-1"], output: { kind: "key", code: "ESCAPE" }, timeoutMs: 25 }],
      holdTapProfiles: layout.holdTapProfiles.map((p) => (p.id === "home-row-mods" ? { ...p, options: { ...p.options, TAPPING_TERM: 175, PERMISSIVE_HOLD: false } } : p)),
    };
    const built = await build(edited, "reva");
    expect(dfuProblem(built.bytes, "0483:df11")).toBeUndefined();
    expect(built.bytes.length).toBeGreaterThan(60_000);
  }, TIMEOUT);

  test("a hands-free build for each revision links the wrapper in front of Oryx's raw_hid_receive and carries its marker", async () => {
    const board = await moonlander();
    const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
    for (const [rev, bootloader] of [["reva", "0483:df11"], ["revb", "3297:2003"]] as const) {
      const buildId = "bld_01JABCDEFGHJKMNPQRSTVWXYZ0";
      const built = await build(layout, rev, { buildId });
      expect(dfuProblem(built.bytes, bootloader)).toBeUndefined();
      expect(markerInFirmware(built.bytes)).toBe(buildMarker(buildId));
      // buildQmk has already refused the build if the ELF lacked the wrapper; this reads the same file again, independently.
      const elf = await Bun.file(join(checkoutDirFor(board), ".build", `zsa_moonlander_${rev}_keyloom.elf`)).bytes();
      const symbols = definedSymbols(elf);
      expect(symbols.has("__wrap_raw_hid_receive")).toBe(true);
      expect(symbols.has("raw_hid_receive")).toBe(true);
      // The typing lab's recorder (D-281) is wrapped around action_exec, which stays defined beside it.
      expect(symbols.has("__wrap_action_exec")).toBe(true);
      expect(symbols.has("action_exec")).toBe(true);
      // reva's plain build is 67,268 bytes (above); the wrapper, the lab's stream and a longer serial are the only code added.
      if (rev === "reva") {
        expect(built.bytes.length).toBeGreaterThan(67_268);
        expect(built.bytes.length).toBeLessThan(67_268 + 2500);
      }
      console.log(`keyloom: ${rev} hands-free build with the typing stream is ${built.bytes.length} bytes`);
    }
  }, TIMEOUT);
});
