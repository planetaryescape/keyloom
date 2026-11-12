// R5-12: "Make a combo" with one key selected says why it is off beside it, not only in a title that touch and keyboard users never see.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectionBar } from "../../src/web/keyboard/SelectionBar.tsx";

const bar = (count: number) =>
  renderToStaticMarkup(
    <SelectionBar count={count} layerName="Base" selectMode={false} onSelectMode={() => {}} onClear={() => {}} onCombo={() => {}} copied={null} onPaste={() => {}}
      quick={null} onQuickStart={() => {}} onQuickApply={() => {}} onQuickCancel={() => {}} busy={false} />,
  );

test("one key selected: Make a combo is off and the reason shows beside it", () => {
  const html = bar(1);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="combo-why"[^>]*>.*Make a combo<\/button><span id="combo-why"[^>]*>Select a second key to make a combo<\/span>/);
});

test("two keys selected: Make a combo is on and no reason shows", () => {
  const html = bar(2);
  expect(html).not.toContain("Select a second key");
  expect(html).not.toMatch(/disabled=""[^>]*>.*Make a combo/);
});
