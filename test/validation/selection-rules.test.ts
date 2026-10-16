import { describe, expect, test } from "bun:test";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding } from "../../src/layout/schema.ts";
import { outsideSelection } from "../../src/validation/selection-rules.ts";
import { validate } from "../../src/validation/validate.ts";
import { key, tiny, tinyBoard } from "../helpers/tiny.ts";

const set = (layerId: string, position: number, binding: Binding): ChangeOp => ({ op: "setBinding", at: { layerId, position }, binding });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("outside_selection (07)", () => {
  const selection = { layerId: "base", positions: [0, 1] };

  test("a change inside the selection is quiet", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 0, key("Q")), set("base", 1, key("W"))], { selection });
    expect(codes(r.warnings)).not.toContain("outside_selection");
  });

  test("a change to selected keys is not a warning for the keys it leaves alone", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 0, key("Q"))], { selection });
    expect(codes(r.warnings)).not.toContain("outside_selection");
  });

  test("a key outside the selection is warned about, named by what it prints (D-279), and listed as a slot", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 0, key("Q")), set("base", 3, key("Z"))], { selection });
    expect(r.ok).toBe(true);
    const warning = r.warnings.find((w) => w.code === "outside_selection");
    expect(warning?.slots).toEqual([{ layerId: "base", position: 3 }]);
    expect(warning?.message).toBe("This change edits 1 key you did not select: the D key on Base");
  });

  test("the same position on another layer is outside the selection", () => {
    const r = validate(tinyBoard, tiny(), [set("num", 0, key("Z"))], { selection });
    expect(r.warnings.find((w) => w.code === "outside_selection")?.slots).toEqual([{ layerId: "num", position: 0 }]);
  });

  test("a displaced function's new home counts, because it is a key the selection did not name", () => {
    const r = validate(tinyBoard, tiny(), [{ op: "moveBinding", from: { layerId: "base", position: 0 }, to: { layerId: "base", position: 3 } }], { selection });
    expect(r.warnings.find((w) => w.code === "outside_selection")?.slots).toEqual([{ layerId: "base", position: 3 }]);
  });

  test("a long list is cut and counted", () => {
    const slots = Array.from({ length: 9 }, (_, position) => ({ layerId: "base", position }));
    const [issue] = outsideSelection(tiny(), slots, { layerId: "base", positions: [] });
    expect(issue?.message).toContain("edits 9 keys");
    expect(issue?.message).toContain("; and 3 more");
    expect(issue?.slots).toHaveLength(9);
  });

  test("with no selection there is nothing to stray from", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 3, key("Z"))]);
    expect(codes(r.warnings)).not.toContain("outside_selection");
  });
});
