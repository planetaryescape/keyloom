// An empty combo list offers New combo where the page can start one, instead of only describing the shift-click (R3-23).
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ComboList } from "../../src/web/combos/ComboPane.tsx";
import { tiny } from "../helpers/tiny.ts";

const empty = tiny({ combos: [] });
const noop = () => {};

test("with a way to start one, the empty list has a New combo button", () => {
  const html = renderToStaticMarkup(<ComboList layout={empty} onOpen={noop} onHover={noop} onClose={noop} onNew={noop} />);
  expect(html).toContain("New combo");
  expect(html).toContain("click its keys on the board");
});

test("without one, it keeps the shift-click steps and no button that does nothing", () => {
  const html = renderToStaticMarkup(<ComboList layout={empty} onOpen={noop} onHover={noop} onClose={noop} />);
  expect(html).not.toContain("New combo");
  expect(html).toContain("Shift-click two or more keys");
});

test("while choosing keys for a two-key combo, why its keys can't be removed is said beside them, not only on hover (R4-17)", async () => {
  const { ComboEditor } = await import("../../src/web/combos/ComboPane.tsx");
  const layout = tiny({ combos: [] });
  const draft = { id: "c1", isNew: true, name: "", positions: [0, 1], layerIds: "all" as const, output: null, timeoutMs: undefined };
  const html = renderToStaticMarkup(
    <ComboEditor token="t" layoutRef="lay" revisionId="rev" layout={layout} layerId="base" draft={draft} onDraft={noop} picking onPicking={noop} onBack={noop} onApplied={async () => {}} onStale={noop} />,
  );
  expect(html).toContain("A combo needs at least two keys.");
  expect(html).toContain('aria-describedby="combo-too-few"');
});
