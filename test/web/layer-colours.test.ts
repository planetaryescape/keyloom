import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boardCapabilities, capabilityLine } from "../../src/boards/capabilities.ts";
import { showBoard } from "../../src/app/boards.ts";
import { blankDocument } from "../../src/app/configs.ts";
import { LightingSection } from "../../src/web/settings/LightingSection.tsx";
import { SettingsPane } from "../../src/web/settings/SettingsPane.tsx";
import { KeyColour } from "../../src/web/settings/KeyColour.tsx";

async function count(html: string, selector: string): Promise<number> {
  let found = 0;
  await new HTMLRewriter().on(selector, { element: () => { found++; } }).transform(new Response(html)).text();
  return found;
}

test.each(["moergo/glove80", "apple/macbook-ansi"])("%s exposes display styling separately and explains unavailable LED editing without offering hardware controls", async (id) => {
  const board = showBoard(id).definition;
  const layout = blankDocument(id);
  const caps = boardCapabilities(board);
  expect(caps.layerStyle.supported).toBe(true);
  expect(caps.lighting.supported).toBe(false);
  expect(capabilityLine(board)).toContain("On-screen: layer colours and short labels");
  expect(capabilityLine(board)).toContain("Cannot do: per-key hardware LED colours");
  const html = renderToStaticMarkup(createElement(SettingsPane, {
    token: "synthetic", layoutRef: "synthetic", revisionId: "revision", layout, board, advanced: false,
    lighting: new Map(), onLighting: () => {}, currentLayerId: "base", onShowLayer: () => {}, onClose: () => {}, onApplied: async () => {}, onStale: () => {}, colourway: { case: null, caps: null }, onColourway: () => {}, boardName: board.name,
  }));
  expect(html).toContain("Keyboard LED lighting");
  if (caps.lighting.because === undefined) throw new Error("unsupported LED editing needs a reason");
  expect(html).toContain(Bun.escapeHTML(caps.lighting.because));
  expect(html).toContain("On-screen layer colours are still available");
  expect(await count(html, ".colour-choice")).toBe(0);
});

test("Moonlander exposes explicitly labelled LED controls without confusing them with display colours", async () => {
  const board = showBoard("zsa/moonlander").definition;
  const layout = blankDocument(board.id);
  expect(boardCapabilities(board).layerStyle.supported).toBe(true);
  expect(boardCapabilities(board).lighting.supported).toBe(true);
  const html = renderToStaticMarkup(createElement(LightingSection, { board, layout, draft: new Map(), onChange: () => {}, currentLayerId: "base", onShowLayer: () => {} }));
  expect(html).toContain("Keyboard LED lighting");
  expect(html).toContain("Physical keyboard lights, separate from");
  expect(html).not.toContain("LED editing is unavailable");
  expect(await count(html, '[role="group"][aria-label="LED colour for Base"]')).toBe(1);
  expect(await count(html, 'input[type="color"]')).toBe(1);
});

test("the per-key picker also explicitly identifies physical LED scope", async () => {
  const layer = blankDocument("zsa/moonlander").layers[0];
  if (layer === undefined) throw new Error("base layer missing");
  const html = renderToStaticMarkup(createElement(KeyColour, { layer, position: 0, busy: false, onPick: () => {} }));
  expect(html).toContain("Key LED colour");
  expect(html).toContain("not the on-screen layer colour");
  expect(await count(html, '[role="group"][aria-label="LED colour for this key on Base"]')).toBe(1);
});
