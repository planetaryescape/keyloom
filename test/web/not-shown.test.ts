// R7-06: a change applied but not shown stays marked in the editor until a read of the layout works, not only in a toast that closes.
import { describe, expect, test } from "bun:test";
import { notShownLine } from "../../src/web/editor/not-shown.ts";

describe("notShownLine", () => {
  test("shows while the page still shows the revision it showed when the read failed", () => {
    expect(notShownLine("rev_A", "rev_A")).toBe(true);
  });
  test("goes once a read works, which shows a newer revision or another config, and never shows unmarked", () => {
    expect(notShownLine("rev_A", "rev_B")).toBe(false);
    expect(notShownLine(null, "rev_A")).toBe(false);
  });
});
