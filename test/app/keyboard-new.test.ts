// Rung 21's demo, with fakes (22): a Corne keyloom has never seen is plugged in, named from its USB identity, confirmed, derived, and
// BK's Glove80 layout is put on it. BK's committed Corne is hidden from detection, so the board is built, not looked up.
import { afterAll, describe, expect, test } from "bun:test";
import { addKeyboard, detectKeyboards, previewKeyboard } from "../../src/app/index.ts";
import { applyChange, getLayout, importLayout, listChanges, listConfigs, openApp, showBoard } from "../../src/app/index.ts";
import { putConfig } from "../../src/app/keyboard-put.ts";
import { listBoards, setUserBoards } from "../../src/boards/registry.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import type { UsbDevice } from "../../src/firmware/toolchain/usb.ts";
import { CORNE_DIR, CORNE_LAYOUT_FIXTURE } from "../helpers/derive-sources.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";
import { tempDir } from "../helpers/tmp.ts";

// ZMK's default USB ID, BK's Corne's product string, and ZMK's maker string.
const corneLeft: UsbDevice = { vendorId: "0x1d50", productId: "0x615e", name: "Corne", maker: "ZMK Project", serial: "0123456789ABCDEF" };
const hub: UsbDevice = { vendorId: "0x05e3", productId: "0x0610", name: "USB2.0 Hub", maker: "GenesysLogic" };

/** The pinned firmware tree, from a fixture: no test reads GitHub. */
const tree = async (url: string): Promise<string> => {
  if (url.endsWith("/app/dts/layouts/foostan/corne/6column.dtsi")) return Bun.file(CORNE_LAYOUT_FIXTURE).text();
  throw new Error(`GET ${url} returned 404`);
};

const withoutCommittedCorne = () => listBoards().filter((b) => b.definition.id !== "foostan/corne");

function world() {
  const app = openApp({ dataDir: tempDir() });
  return { app, deps: { fetchText: tree, cacheDir: tempDir(), boards: withoutCommittedCorne() } };
}

// Derived boards live in the registry of this process; leave it as other test files expect it.
afterAll(() => setUserBoards([]));

describe("a Corne keyloom has never seen", () => {
  test("detect lists it with the Corne among the candidates, and leaves the hub out", async () => {
    const found = await detectKeyboards({ usb: async () => [hub, corneLeft], boards: withoutCommittedCorne() });
    expect(found).toHaveLength(1);
    const corne = found[0]!;
    expect(corne.status).toBe("candidates");
    expect(corne.candidates.map((c) => c.id)).toContain("zmk:corne");
    expect(corne.candidates[0]?.reasons.join(" ")).toContain("default USB ID");
  });

  test("with the committed Corne in place, the same device is known and not offered again", async () => {
    const found = await detectKeyboards({ usb: async () => [corneLeft] });
    expect(found[0]?.status).toBe("known");
    expect(found[0]?.knownBoard?.id).toBe("foostan/corne");
  });

  test("add asks for the home row and the controller before it writes anything", async () => {
    const { app, deps } = world();
    const preview = await previewKeyboard({ candidate: "zmk:corne" }, deps);
    expect(preview.keyCount).toBe(42);
    expect(preview.rows).toEqual([{ row: 1, keys: 12 }, { row: 2, keys: 12 }, { row: 3, keys: 12 }]);
    expect(preview.guessedHomeRow).toBe(2);
    expect(preview.needs).toEqual(["--home-row", "--controller"]);
    expect(preview.controllers.map((c) => c.id)).toContain("nice_nano//zmk");
    await expect(addKeyboard(app, { candidate: "zmk:corne", controller: "nice_nano//zmk" }, deps)).rejects.toThrow(/home row/);
    expect(listBoards().some((b) => b.definition.id === "local/corne")).toBe(false);
  });

  test("a controller that does not fit the shield is refused with the ones that do", async () => {
    const { app, deps } = world();
    await expect(addKeyboard(app, { candidate: "zmk:corne", homeRow: 2, controller: "xiao_ble//zmk" }, deps)).rejects.toThrow(/Controllers that do: .*nice_nano\/\/zmk/);
  });

  test("the derived board passes boards check and matches the committed Corne's hands, thumbs and fingers", async () => {
    const { app, deps } = world();
    const added = await addKeyboard(app, { candidate: "zmk:corne", homeRow: 2, controller: "nice_nano//zmk" }, deps);
    expect(added.boardId).toBe("local/corne");
    const derived = showBoard("local/corne");
    const committed = (await loadBoardDir(CORNE_DIR)).definition;
    expect(derived.definition.hands).toEqual(committed.hands);
    expect(derived.definition.fingers).toEqual(committed.fingers);
    expect(derived.definition.rows).toEqual(committed.rows);
    expect(derived.definition.mirror).toEqual(committed.mirror);
    expect(derived.definition.keyCount).toBe(42);
    expect(derived.geometry.keys).toEqual((await loadBoardDir(CORNE_DIR)).geometry.keys);
  });
});

describe("BK's Glove80 setup on the derived Corne", () => {
  async function put() {
    const { app, deps } = world();
    await addKeyboard(app, { candidate: "zmk:corne", homeRow: 2, controller: "nice_nano//zmk" }, deps);
    const glove = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove80" });
    return { app, glove, out: putConfig(app, { from: glove.layoutId, board: "local/corne" }) };
  }

  test("a new config on the Corne holds a mapped proposal and a placement proposal, and nothing is applied", async () => {
    const { app, glove, out } = await put();
    expect(out.config).toMatchObject({ name: "my-glove80 on Corne", boardId: "local/corne" });
    // The glove80 layout is untouched, and the new config is still the blank it started as.
    expect(getLayout(app, glove.layoutId).layout.boardId).toBe("moergo/glove80");
    const blank = getLayout(app, out.config.id);
    expect(blank.document.layers).toHaveLength(1);
    expect(blank.document.layers[0]?.bindings.every((b) => b.kind === "none")).toBe(true);
    expect(out.proposals.map((p) => p.title)).toEqual([
      "Put my-glove80 on the Corne",
      "Put my-glove80 on the Corne, with its layer keys placed",
    ]);
    const stored = listChanges(app, out.config.id);
    expect(stored.map((c) => c.status)).toEqual(["proposed", "proposed"]);
    expect(new Set(stored.map((c) => c.proposalGroup)).size).toBe(1);
    expect(stored.every((c) => c.validation.ok)).toBe(true);
    // The first proposal, which has no placed layer key, warns that a layer is unreachable; the second does not.
    const [alt, main] = stored;
    expect(main!.validation.warnings.length).toBeGreaterThan(alt!.validation.warnings.length);
  });

  test("the mapping lands home-row mods on the right fingers with the right hand's modifiers and profiles", async () => {
    const { app, out } = await put();
    applyChange(app, out.proposals[0]!.changeSetId);
    const doc = getLayout(app, out.config.id).document;
    const base = doc.layers[0]!;
    // Corne home row: 12-17 left, 18-23 right. Glove80's A S D F J K L ; keep their letters and take the hand of the key they land on.
    const tapOf = (p: number) => (base.bindings[p]!.kind === "holdTap" ? (base.bindings[p] as { tap: { code: string }; hold: unknown }).tap.code : base.bindings[p]!.kind === "key" ? (base.bindings[p] as { code: string }).code : "");
    expect([13, 14, 15, 16].map(tapOf)).toEqual(["A", "S", "D", "F"]);
    expect([19, 20, 21, 22].map(tapOf)).toEqual(["J", "K", "L", "SEMICOLON"]);
    expect(base.bindings[19]).toMatchObject({ kind: "holdTap", hold: { mods: ["RSFT"] }, profileId: "hm-right" });
    expect(base.bindings[16]).toMatchObject({ kind: "holdTap", hold: { mods: ["LSFT"] }, profileId: "hm-left" });
    // Each hand's profile waits for the other hand and the thumbs on the Corne's own positions, not the Glove80's.
    const left = doc.holdTapProfiles.find((p) => p.id === "hm-left")!;
    expect(left.options["hold-trigger-key-positions"]).toEqual([...showBoard("local/corne").definition.hands.right, 36, 37, 38].sort((a, b) => a - b));
    // All three layers came across, in order, named as they were; macros and a layer-tap profile came with the keys that use them.
    expect(doc.layers.map((l) => l.name)).toEqual(["Base", "layer_Nav", "layer_Magic"]);
    expect(doc.macros.map((m) => m.id)).toContain("opt_opt");
    expect(doc.holdTapProfiles.map((p) => p.id)).toEqual(expect.arrayContaining(["hm-left", "hm-right", "lt"]));
  });

  test("the keys with no counterpart are listed with the reason, and combos on those keys say why they stayed behind", async () => {
    const { out } = await put();
    const base = out.layers[0]!;
    expect(base.carried).toBe(42);
    expect(base.notCarried).toBe(38);
    expect(out.notCarried.find((n) => n.sourceName.startsWith("F1 "))?.why).toBe("the new board has no key in this place");
    // combo-caps outputs a ZMK caps word, which the Corne has as a builtin, so it carries (D-443); combo-esc's output has no counterpart.
    expect(out.combos.copied).toEqual(["combo-caps"]);
    expect(out.combos.skipped.map((c) => c.id)).toEqual(["combo-esc"]);
    expect(out.combos.skipped[0]?.why).toContain("has no confident counterpart on the target");
  });

  test("a layer key with no counterpart is offered free thumb keys first, then keys held by a guess, and applying the placement retires the other proposal", async () => {
    const { app, out } = await put();
    expect(out.placements).toHaveLength(1);
    const placement = out.placements[0]!;
    expect(placement.sourceName).toContain("Space hold Layer");
    expect(placement.candidates.map((c) => c.name)).toEqual(["right thumb, inner", "right thumb, middle", "right thumb, outer"]);
    expect(placement.candidates[0]?.replaces).toBeDefined();
    const applied = applyChange(app, out.proposals[1]!.changeSetId);
    expect(applied.validation.ok).toBe(true);
    const base = getLayout(app, out.config.id).document.layers[0]!;
    expect(base.bindings[39]).toMatchObject({ kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "layer-magic" } });
    expect(listChanges(app, out.config.id).map((c) => c.status).sort()).toEqual(["applied", "superseded"]);
  });

  test("BK's Moonlander layout goes onto the same board through the same path, and passes the validator", async () => {
    const { app, deps } = world();
    await addKeyboard(app, { candidate: "zmk:corne", homeRow: 2, controller: "nice_nano//zmk" }, deps);
    const moon = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-moonlander" });
    const out = putConfig(app, { from: moon.layoutId, board: "local/corne", name: "Moonlander on Corne" });
    expect(out.config.name).toBe("Moonlander on Corne");
    expect(out.proposals.length).toBeGreaterThanOrEqual(1);
    expect(listChanges(app, out.config.id).every((c) => c.validation.ok)).toBe(true);
    expect(out.layers[0]!.carried).toBeGreaterThan(30);
  });

  test("refusals: the same board and a name already taken (a laptop keyboard is no longer one: D-383)", async () => {
    const { app, glove } = await put();
    expect(() => putConfig(app, { from: glove.layoutId, board: "moergo/glove80" })).toThrow(/already a Glove80 config/);
    expect(() => putConfig(app, { from: glove.layoutId, board: "local/corne" })).toThrow(/already exists/);
    expect(listConfigs(app).filter((c) => c.boardId === "local/corne")).toHaveLength(1);
  });

  test("putConfig respects explicit layers and placements options", async () => {
    const { app, deps } = world();
    await addKeyboard(app, { candidate: "zmk:corne", homeRow: 2, controller: "nice_nano//zmk" }, deps);
    const glove = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "my-glove" });
    const out = putConfig(app, {
      from: glove.layoutId,
      board: "local/corne",
      name: "Custom Put",
      layers: ["Base"],
      placements: { "73": 39 },
    });
    expect(out.config.name).toBe("Custom Put");
    expect(out.layers).toHaveLength(1);
    expect(out.layers[0]!.source).toBe("layer-base");
  });
});
