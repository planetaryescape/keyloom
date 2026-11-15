import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroCap } from "../../src/web/card/HeroCap.tsx";
import { loadBoardDir } from "../../src/boards/load.ts";

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
  expect(tapHeight).toBeGreaterThanOrEqual(12.1);
  expect(html).toContain('class="hero-extra-slots"');
  expect(html).toContain("When held: Control");
  if (corners) expect(html).toContain("When double-tapped: B");
});

test("a roomy flat button fits its corner label and tap without reducing the font", () => {
  const html = renderToStaticMarkup(createElement(HeroCap, {
    legend: { tap: "A" }, tone: "tapDance", hold: { text: "Control", name: "When held" },
    doubleTap: { text: "B", name: "When double-tapped" }, tapThenHold: null,
    open: null, draft: false, onOpen: () => {}, label: "A", size: 84,
    shape: { profile: "flat", w: 1, h: 1 },
  }));
  const value = (name: string) => Number(new RegExp(`--hero-${name}:([\\d.]+)px`).exec(html)?.[1]);
  expect(value("corners")).toBeGreaterThanOrEqual(13.2);
  expect(value("h") - value("front") - value("corners")).toBeGreaterThanOrEqual(12.1);
  expect(html).not.toContain('class="hero-extra-slots"');
});

test("a cap shorter than a text line keeps its tap available below the cap", () => {
  const html = renderToStaticMarkup(createElement(HeroCap, {
    legend: { tap: "A" }, tone: "key", hold: null, doubleTap: null, tapThenHold: null,
    open: null, draft: false, onOpen: () => {}, label: "A", size: 84,
    shape: { profile: "flat", w: 10, h: 1 },
  }));
  expect(html).toContain("When tapped: A");
  expect(html).toContain('class="hero-extra-slots"');
  expect(html).not.toContain('class="hero-region hero-tap"');
});

test("empty corner actions remain available when a flat cap moves its slots below the cap", () => {
  const html = renderToStaticMarkup(createElement(HeroCap, {
    legend: { tap: "A" }, tone: "tapDance", hold: { text: "Control", name: "When held" },
    doubleTap: { text: null, ghost: "double tap…", name: "When double-tapped" },
    tapThenHold: { text: null, name: "When tapped, then held" },
    open: null, draft: false, onOpen: () => {}, label: "A", size: 84,
    shape: { profile: "flat", w: 4, h: 1 },
  }));
  expect(html).toContain('class="hero-extra-slots"');
  expect(html).toContain('aria-label="When double-tapped: nothing yet. Add"');
  expect(html).toContain("When double-tapped: double tap…");
  expect(html).toContain('aria-label="When tapped, then held: nothing yet. Add"');
  expect(html).toContain("When tapped, then held: Nothing");
});

test.each([84, 112])("an A+ button at %s px keeps filled slots readable", async (size) => {
  const board = await loadBoardDir(`${import.meta.dir}/../../boards/ploopy/aplus`);
  const html = renderToStaticMarkup(createElement(HeroCap, {
    legend: { tap: "A" }, tone: "tapDance", hold: { text: "Control", name: "When held" },
    doubleTap: { text: "B", name: "When double-tapped" }, tapThenHold: { text: "C", name: "When tapped, then held" },
    open: null, draft: false, onOpen: () => {}, label: "A", size,
    shape: board.definition.display!.keyShapes!["0"],
  }));
  if (size === 84) {
    expect(html).toContain('class="hero-extra-slots"');
    expect(html).toContain("When tapped, then held: C");
    expect(html).toContain("When double-tapped: B");
  } else expect(html).not.toContain('class="hero-extra-slots"');
});
