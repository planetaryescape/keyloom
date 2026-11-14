import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroCap } from "../../src/web/card/HeroCap.tsx";

test.each([false, true])("a short flat button keeps space for its tap, hold and corners=%s", (corners) => {
  const html = renderToStaticMarkup(createElement(HeroCap, {
    legend: { tap: "A" }, tone: "holdTap", hold: { text: "Control", name: "When held" },
    doubleTap: corners ? { text: "B", name: "When double-tapped" } : null,
    tapThenHold: null, open: null, draft: false, onOpen: () => {}, label: "A", size: 112,
    shape: { profile: "flat", w: 4, h: 1 },
  }));
  const value = (name: string) => Number(new RegExp(`--hero-${name}:([\\d.]+)px`).exec(html)?.[1]);
  const tapHeight = value("h") - value("front") - value("corners");
  expect(tapHeight).toBeGreaterThan(0);
  expect(value("front")).toBeGreaterThan(0);
  if (corners) expect(value("corners")).toBeGreaterThan(0);
  else expect(value("corners")).toBe(0);
});
