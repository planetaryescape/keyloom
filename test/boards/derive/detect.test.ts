// Naming a keyboard from its USB identity against the committed index (22#recognising-the-keyboard, S42). The IDs below are the ones
// docs/research/new-keyboard.md reads from BK's boards and from qmk_firmware at the pinned commit.
import { describe, expect, test } from "bun:test";
import { type UsbIdentity, candidateById, detectCandidates, searchIndex } from "../../../src/boards/derive/detect.ts";
import { keyboardIndex } from "../../../src/boards/derive/keyboard-index.ts";
import { PINNED_SOURCES } from "../../../src/boards/derive/pins.ts";

const index = keyboardIndex();
const device = (over: Partial<UsbIdentity>): UsbIdentity => ({ vendorId: "0x0000", productId: "0x0000", product: "", maker: "", ...over });

describe("the committed keyboard index", () => {
  test("is generated from the pinned trees, and says so", () => {
    expect(index.sources).toEqual(PINNED_SOURCES);
  });

  test("covers the QMK tree and the ZMK shields, with unique ids", () => {
    expect(index.qmk.length).toBeGreaterThan(3500);
    expect(new Set(index.qmk.map((e) => e.target)).size).toBe(index.qmk.length);
    expect(new Set(index.zmk.map((e) => e.id)).size).toBe(index.zmk.length);
    // 29 of ZMK's shields carry key geometry (research); the rest cannot be derived from the tree.
    expect(index.zmk.filter((e) => e.layout).length).toBeGreaterThanOrEqual(29);
  });

  test("is as the research counted it: 0xFEED:0x0000 is shared by 175 keyboards", () => {
    expect(index.qmk.filter((e) => e.vid === "0xfeed" && e.pid === "0x0000").length).toBeGreaterThan(150);
  });
});

describe("QMK keyboards", () => {
  test("a Moonlander is named from its vendor and product ID alone", () => {
    const found = detectCandidates(index, device({ vendorId: "0x3297", productId: "0x1969" }));
    expect(found.candidates.map((c) => c.id)).toEqual(["qmk:zsa/moonlander"]);
    expect(found.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(found.ambiguous).toBe(false);
  });

  test("the product string and device version raise the confidence, and say why", () => {
    const bare = detectCandidates(index, device({ vendorId: "0x3297", productId: "0x1969" })).candidates[0]!;
    const named = detectCandidates(index, device({ vendorId: "0x3297", productId: "0x1969", product: "Moonlander Mark I", bcdDevice: "0x0001" })).candidates[0]!;
    expect(named.confidence).toBeGreaterThan(bare.confidence);
    expect(named.reasons.join(" ")).toContain('"Moonlander Mark I"');
  });

  test("a QMK Corne's ID is shared by two controller variants, so it is a list and not a guess", () => {
    const found = detectCandidates(index, device({ vendorId: "0x4653", productId: "0x0001", product: "Corne", maker: "foostan", bcdDevice: "0x0001" }));
    expect(found.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(["qmk:crkbd/rev1", "qmk:crkbd/r2g"]));
    expect(found.ambiguous).toBe(true);
  });

  test("a shared ID is narrowed by the product string, not guessed", () => {
    const shared = index.qmk.find((e) => index.qmk.filter((o) => o.vid === e.vid && o.pid === e.pid && o.vid !== "0xfeed").length > 1)!;
    const pool = index.qmk.filter((o) => o.vid === shared.vid && o.pid === shared.pid);
    const withoutName = detectCandidates(index, device({ vendorId: shared.vid, productId: shared.pid }));
    expect(withoutName.candidates.length).toBe(Math.min(pool.length, 10));
    expect(withoutName.ambiguous).toBe(true);
    expect(withoutName.candidates.every((c) => c.confidence < 0.6)).toBe(true);
  });

  test("the placeholder 0xFEED:0x0000 always gives a list, even with a product string that names one", () => {
    const named = index.qmk.find((e) => e.vid === "0xfeed" && e.pid === "0x0000")!;
    const found = detectCandidates(index, device({ vendorId: "0xfeed", productId: "0x0000", product: named.name }));
    expect(found.candidates.length).toBeGreaterThan(1);
    expect(found.ambiguous).toBe(true);
    expect(found.candidates.every((c) => c.confidence <= 0.55)).toBe(true);
    expect(found.candidates[0]?.reasons.join(" ")).toContain("placeholder");
  });

  test("an ID the index has never seen names nothing", () => {
    expect(detectCandidates(index, device({ vendorId: "0x9999", productId: "0x9999", product: "Some Keyboard" })).candidates).toEqual([]);
  });
});

describe("ZMK keyboards", () => {
  test("on ZMK's default ID the product string is the only fingerprint", () => {
    const found = detectCandidates(index, device({ vendorId: "0x1d50", productId: "0x615e", product: "Corne", maker: "ZMK Project" }));
    expect(found.candidates.map((c) => c.id)).toContain("zmk:corne");
    expect(found.candidates[0]?.reasons.join(" ")).toContain("default USB ID");
  });

  test("a Glove80 half is named by its own ID and its product string", () => {
    const found = detectCandidates(index, device({ vendorId: "0x16c0", productId: "0x27db", product: "Glove80 Left", maker: "MoErgo" }));
    expect(found.candidates[0]?.id).toBe("zmk:glove80");
    expect(found.candidates[0]?.confidence).toBeGreaterThan(0.9);
    const right = detectCandidates(index, device({ vendorId: "0x16c0", productId: "0x27d9", product: "Glove80 Right" }));
    expect(right.candidates[0]?.id).toBe("zmk:glove80");
  });

  test("a name that three shields share gives all three and asks", () => {
    const found = detectCandidates(index, device({ vendorId: "0x1d50", productId: "0x615e", product: "Kyria" }));
    expect(found.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(["zmk:kyria", "zmk:kyria_rev2", "zmk:kyria_rev3"]));
    expect(found.ambiguous).toBe(true);
  });

  test("a product string the tree has never set names nothing, and a search by name finds the shield", () => {
    expect(detectCandidates(index, device({ vendorId: "0x1d50", productId: "0x615e", product: "My Board 3000" })).candidates).toEqual([]);
    expect(searchIndex(index, "corne").map((c) => c.id)).toEqual(expect.arrayContaining(["zmk:corne", "qmk:crkbd/rev1"]));
  });
});

describe("candidates named by id", () => {
  test("any index entry can be chosen, plugged in or not", () => {
    expect(candidateById(index, "qmk:crkbd/rev1")?.name).toBe("Corne");
    expect(candidateById(index, "zmk:corne")?.entry.kind).toBe("zmk");
    expect(candidateById(index, "zmk:nothing-like-this")).toBeUndefined();
    expect(candidateById(index, "oryx:thing")).toBeUndefined();
  });
});
