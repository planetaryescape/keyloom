import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Cap } from "../../src/web/keyboard/Cap.tsx";

const render = (keycap?: "red") =>
  renderToStaticMarkup(createElement(Cap, { tone: "holdTap", legend: { tap: "A" }, unit: 56, width: 1, ...(keycap === undefined ? {} : { keycap }) }));

describe("a cap's physical colour", () => {
  test("is a data attribute beside the kind, so the kind's fill and shape stay", () => {
    const html = render("red");
    expect(html).toContain('data-keycap="red"');
    expect(html).toContain('data-tone="holdTap"');
    expect(html).toContain("cap-band");
  });

  test("is absent when the board gives none", () => {
    expect(render()).not.toContain("data-keycap");
  });
});
