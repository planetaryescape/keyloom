// A board preview that fails says why and offers Try again, instead of "Reading…" for ever with the next step disabled (R3-08).
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiCandidate } from "../../src/api/detected-keyboards.ts";
import { NewBoardPanel } from "../../src/web/keyboards/NewBoardPanel.tsx";
import type { NewKeyboard } from "../../src/web/keyboards/useNewKeyboard.ts";

const candidate = { id: "zmk/corne", name: "Corne", firmware: "zmk" } as ApiCandidate;
const flow = (previewProblem: string | null): NewKeyboard => ({
  step: { kind: "confirm", keyboard: null, candidate, homeRow: null, controller: null },
  preview: null, previewProblem, problem: null, retryPreview: () => {}, backToCard: () => {}, notNow: () => {}, review: () => {},
}) as unknown as NewKeyboard;

test("while the preview is read, the panel says so", () => {
  const html = renderToStaticMarkup(<NewBoardPanel flow={flow(null)} sources={[]} onMade={() => {}} />);
  expect(html).toContain("Reading…");
  expect(html).not.toContain("Try again");
});

test("a failed preview stops reading, says why and offers Try again", () => {
  const html = renderToStaticMarkup(<NewBoardPanel flow={flow("keyloom couldn't reach the firmware tree.")} sources={[]} onMade={() => {}} />);
  expect(html).not.toContain("Reading…");
  expect(html).toContain('role="alert"');
  expect(html).toContain("keyloom couldn&#x27;t draw this board. keyloom couldn&#x27;t reach the firmware tree.");
  expect(html).toContain("Try again");
});
