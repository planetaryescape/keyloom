import { describe, expect, test } from "bun:test";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding, Layer } from "../../src/layout/schema.ts";
import { LARGE_RELEARN_THRESHOLD, type PinnedPriority } from "../../src/validation/priority-rules.ts";
import { validate } from "../../src/validation/validate.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const at = (layerId: string, position: number) => ({ layerId, position });
const set = (layerId: string, position: number, binding: Binding): ChangeOp => ({ op: "setBinding", at: at(layerId, position), binding });
const pin = (over: Partial<PinnedPriority>): PinnedPriority => ({ decisionId: "dec_1", statement: "keep B where it is", slots: [], functions: [], ...over });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("moved_pinned (07)", () => {
  test("warns when a change alters a pinned slot, quoting BK and naming the key by what it prints (D-279)", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 1, key("Q"))], { pinned: [pin({ slots: [at("base", 1)] })] });
    expect(r.ok).toBe(true);
    const warning = r.warnings.find((w) => w.code === "moved_pinned");
    expect(warning).toMatchObject({ slots: [at("base", 1)] });
    expect(warning?.message).toContain('"keep B where it is"');
    expect(warning?.message).toContain("the B key on Base");
  });

  test("warns when a pinned function leaves the slot it held, even if it lands somewhere else", () => {
    // B moves from base 1 to base 3; D, displaced, is also on nav, so nothing is lost.
    const r = validate(tinyBoard, tiny(), [{ op: "moveBinding", from: at("base", 1), to: at("base", 3) }], { pinned: [pin({ functions: ["key:B"] })] });
    expect(codes(r.warnings)).toContain("moved_pinned");
    expect(r.warnings.find((w) => w.code === "moved_pinned")?.slots).toEqual([at("base", 1)]);
  });

  test("a pinned function dropped with dropFunction still warns, because it is the strongest kind of move", () => {
    const r = validate(tinyBoard, tiny(), [{ op: "dropFunction", function: "key:N4", reason: "unused" }, set("num", 3, T)], {
      pinned: [pin({ functions: ["key:N4"] })],
    });
    expect(r.ok).toBe(true);
    expect(codes(r.warnings)).toContain("moved_pinned");
  });

  test("stays quiet when the change leaves the pinned key alone, or when nothing is pinned", () => {
    const ops = [set("base", 0, key("Q"))];
    expect(codes(validate(tinyBoard, tiny(), ops, { pinned: [pin({ slots: [at("base", 1)], functions: ["key:B"] })] }).warnings)).toEqual([]);
    expect(validate(tinyBoard, tiny(), [set("base", 1, key("Q"))]).warnings).toEqual([]);
  });

  test("one warning per pinned priority, and it never blocks", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 0, key("Q")), set("base", 1, key("W"))], {
      pinned: [pin({ decisionId: "dec_a", slots: [at("base", 0)] }), pin({ decisionId: "dec_b", slots: [at("base", 1)] })],
    });
    expect(r.ok).toBe(true);
    expect(codes(r.warnings)).toEqual(["moved_pinned", "moved_pinned"]);
  });
});

describe("large_relearn (07)", () => {
  /** A base layer of `n` letters, each also reachable nowhere else, so a rotation moves every one. */
  const wide = (n: number) => {
    const codes = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const bindings = Array.from({ length: n }, (_, i): Binding => key(codes[i] as string));
    const layers: Layer[] = [{ id: "base", name: "Base", bindings }];
    return { layout: tiny({ layers, combos: [] }), board: { ...tinyBoard, keyCount: n } };
  };
  const rotate = (n: number): ChangeOp[] => Array.from({ length: n - 1 }, (_, i) => ({ op: "swapBindings", a: at("base", i), b: at("base", i + 1) }));

  test("warns above the threshold and not at it", () => {
    const over = wide(LARGE_RELEARN_THRESHOLD + 2);
    const big = validate(over.board, over.layout, rotate(LARGE_RELEARN_THRESHOLD + 2));
    expect(big.diff.relearnCount).toBe(LARGE_RELEARN_THRESHOLD + 2);
    expect(big.warnings.find((w) => w.code === "large_relearn")?.message).toContain(`${LARGE_RELEARN_THRESHOLD + 2} functions`);

    const exact = wide(LARGE_RELEARN_THRESHOLD);
    const small = validate(exact.board, exact.layout, rotate(LARGE_RELEARN_THRESHOLD));
    expect(small.diff.relearnCount).toBe(LARGE_RELEARN_THRESHOLD);
    expect(codes(small.warnings)).not.toContain("large_relearn");
  });
});
