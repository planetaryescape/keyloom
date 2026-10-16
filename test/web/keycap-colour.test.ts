import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Cap } from "../../src/web/keyboard/Cap.tsx";

const render = (keycap?: "red") =>
  renderToStaticMarkup(createElement(Cap, { tone: "holdTap", legend: { tap: "A" }, unit: 56, width: 1, ...(keycap === undefined ? {} : { keycap }) }));

describe("a cap's physical colour", () => {
  test("is a data attribute beside the kind, and the cap keeps its layers", () => {
    const html = render("red");
    expect(html).toContain('data-keycap="red"');
    expect(html).toContain('data-tone="holdTap"');
    for (const layer of ["cap-bleed", "cap-body", "cap-top", "cap-face", "cap-tap"]) expect(html).toContain(layer);
  });

  test("prints the hold on the front skirt, spelled out when it fits", () => {
    const html = renderToStaticMarkup(createElement(Cap, { tone: "holdTap", legend: { tap: "S", hold: "⌥" }, unit: 72, width: 1 }));
    expect(html).toContain("cap-front");
    expect(html).toContain("⌥ option");
  });

  test("marks a key that reaches a layer with that layer's light, and a hollow ring for an unlit one", () => {
    const lit = renderToStaticMarkup(createElement(Cap, { tone: "layer", legend: { tap: "NAV", hold: "hold" }, unit: 56, width: 1, reach: "#ff0000" }));
    expect(lit).toContain("--dot:#ff0000");
    const unlit = renderToStaticMarkup(createElement(Cap, { tone: "layer", legend: { tap: "L0", hold: "go" }, unit: 56, width: 1, reach: null }));
    expect(unlit).toContain('data-unlit="true"');
  });

  test("is absent when the board gives none", () => {
    expect(render()).not.toContain("data-keycap");
  });
});
