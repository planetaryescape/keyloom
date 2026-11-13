// R10-12: a fix whose proposal keyloom's checks refused says why beside it, and offers Type again in Apply's place, never an Apply that is
// off with no reason.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LabReadout, LabSession } from "../../src/api/lab.ts";
import { LabPanel } from "../../src/web/lab/LabScreens.tsx";
import { refusedFixWords } from "../../src/web/lab/lab-words.ts";
import type { Lab } from "../../src/web/lab/useLab.ts";

const suggestion = (problem: string | null | undefined): LabReadout["suggestions"][number] => ({
  title: "Raise the tapping term", before: 4, after: 0, removed: 4, introduced: 0, example: null, proposal: null, ...(problem === undefined ? {} : { problem }),
});
const readout = (s: LabReadout["suggestions"][number]): LabReadout => ({
  presses: 100, durationMs: 1000, passageId: "prose", counts: { typo: 0, misfireHold: 4, missed: 0 } as LabReadout["counts"],
  fingersLead: "", fingers: [], findings: [], suggestions: [s], notes: [],
});
const lab = (s: LabReadout["suggestions"][number], trying: number | null): Lab => ({
  token: "t", phase: { kind: "readout", session: { id: "s1" } as LabSession, readout: readout(s), open: null, trying }, passages: [], canRecord: { ok: true, why: null }, sessions: [],
  typed: "", problem: null, problemCode: null, loadFailed: false, reload: () => {}, setTyped: () => {}, start: async () => {}, retry: async () => {}, stop: async () => {},
  cancel: async () => {}, showSession: async () => {}, remove: async () => {}, openFinding: () => {}, tryFix: () => {}, again: () => {}, readAgain: null,
}) as Lab;
const render = (s: LabReadout["suggestions"][number], trying: number | null) =>
  renderToStaticMarkup(<LabPanel lab={lab(s, trying)} heat="speed" onHeat={() => {}} onTry={() => {}} onApply={async () => {}} onClose={() => {}} />);
const html = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

test("the words name the check's reason, with a full stop", () => {
  expect(refusedFixWords("You asked to keep this where it is")).toBe("keyloom's checks refused this fix on your layout as it is now, so it can't be applied. You asked to keep this where it is.");
  expect(refusedFixWords("this breaks a rule.")).toEndWith(" This breaks a rule.");
  expect(refusedFixWords(null)).toBe("keyloom's checks refused this fix on your layout as it is now, so it can't be applied.");
});

test("the read-out's list says why beside a refused fix", () => {
  const out = render(suggestion("You asked to keep this where it is"), null);
  expect(out).toContain(html(refusedFixWords("You asked to keep this where it is")));
  expect(out).not.toContain("Try the fix");
});

test("a refused fix being tried hides Apply and offers Type again, with the reason", () => {
  const out = render(suggestion("You asked to keep this where it is"), 0);
  expect(out).toContain(html(refusedFixWords("You asked to keep this where it is")));
  expect(out).toContain("Type again");
  expect(out).not.toMatch(/>Apply</);
});

test("an older keyloom that sends no reason still says the fix can't be applied", () => {
  const out = render(suggestion(undefined), 0);
  expect(out).toContain(html(refusedFixWords(null)));
  expect(out).toContain("Type again");
});
