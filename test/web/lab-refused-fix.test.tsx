// R10-12: a fix whose proposal keyloom's checks refused says why beside it, and offers Type again in Apply's place, never an Apply that is
// off with no reason. A fix keyloom never proposed (#313 review) never says a check refused it.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LabReadout, LabSession } from "../../src/api/lab.ts";
import { LabPanel } from "../../src/web/lab/LabScreens.tsx";
import { NOT_PROPOSED, READ_WITH_FIXES, noProposalWords } from "../../src/web/lab/lab-words.ts";
import type { Lab } from "../../src/web/lab/useLab.ts";

const suggestion = (problem: string | null | undefined): LabReadout["suggestions"][number] => ({
  title: "Raise the tapping term", before: 4, after: 0, removed: 4, introduced: 0, example: null, proposal: null, ...(problem === undefined ? {} : { problem }),
});
const readout = (s: LabReadout["suggestions"][number]): LabReadout => ({
  presses: 100, durationMs: 1000, passageId: "prose", counts: { typo: 0, misfireHold: 4, missed: 0 } as LabReadout["counts"],
  fingersLead: "", fingers: [], findings: [], suggestions: [s], notes: [],
});
const lab = (s: LabReadout["suggestions"][number], trying: number | null, showSession: Lab["showSession"] = async () => {}): Lab => ({
  token: "t", phase: { kind: "readout", session: { id: "s1" } as LabSession, readout: readout(s), open: null, trying }, passages: [], canRecord: { ok: true, why: null }, sessions: [],
  typed: "", problem: null, problemCode: null, loadFailed: false, reload: () => {}, setTyped: () => {}, start: async () => {}, retry: async () => {}, stop: async () => {},
  cancel: async () => {}, showSession, remove: async () => {}, openFinding: () => {}, tryFix: () => {}, again: () => {}, readAgain: null,
}) as Lab;
const render = (s: LabReadout["suggestions"][number], trying: number | null) =>
  renderToStaticMarkup(<LabPanel lab={lab(s, trying)} heat="speed" onHeat={() => {}} onTry={() => {}} onApply={async () => {}} onClose={() => {}} />);
const html = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

test("the words name the check's reason, with a full stop", () => {
  expect(noProposalWords("You asked to keep this where it is")).toBe("keyloom's checks refused this fix on your layout as it is now, so it can't be applied. You asked to keep this where it is.");
  expect(noProposalWords("this breaks a rule.")).toEndWith(" This breaks a rule.");
  expect(noProposalWords("")).toBe("keyloom's checks refused this fix on your layout as it is now, so it can't be applied.");
});

test("the read-out's list says why beside a refused fix", () => {
  const out = render(suggestion("You asked to keep this where it is"), null);
  expect(out).toContain(html(noProposalWords("You asked to keep this where it is")));
  expect(out).not.toContain("Try the fix");
});

test("a refused fix being tried hides Apply and offers Type again, with the reason", () => {
  const out = render(suggestion("You asked to keep this where it is"), 0);
  expect(out).toContain(html(noProposalWords("You asked to keep this where it is")));
  expect(out).toContain("Type again");
  expect(out).not.toMatch(/>Apply</);
});

test("a fix keyloom never proposed says so, never that a check refused it", () => {
  // `lab analyse --no-propose` stores no problem, and the readout sends null; an older keyloom sends none at all.
  for (const problem of [null, undefined]) {
    expect(noProposalWords(problem)).toBe(NOT_PROPOSED);
    const out = render(suggestion(problem), null);
    expect(out).toContain(html(NOT_PROPOSED));
    expect(out).not.toContain("refused");
    expect(out).not.toContain("Try the fix");
  }
});

test("a read-out with a fix never proposed offers Read it again with fixes, which reads the session again with proposals", () => {
  const calls: Array<[string, boolean]> = [];
  const panel = LabPanel({ lab: lab(suggestion(null), null, async (id, run) => { calls.push([id, run]); }), heat: "speed", onHeat: () => {}, onTry: () => {}, onApply: async () => {}, onClose: () => {} });
  const button = findButton(panel, READ_WITH_FIXES);
  expect(button).not.toBeNull();
  (button!.props as { onClick: () => void }).onClick();
  expect(calls).toEqual([["s1", true]]);
  // A refused fix was proposed and checked already, so reading again would refuse it the same way: no such button.
  expect(render(suggestion("You asked to keep this where it is"), null)).not.toContain(READ_WITH_FIXES);
});

test("a fix keyloom never proposed, being tried, offers Type again in Apply's place", () => {
  const out = render(suggestion(null), 0);
  expect(out).toContain(html(NOT_PROPOSED));
  expect(out).toContain("Type again");
  expect(out).not.toMatch(/>Apply</);
});

type El = { type: unknown; props: { children?: unknown; onClick?: () => void } };
function findButton(node: unknown, label: string): El | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const child of node) { const hit = findButton(child, label); if (hit) return hit; } return null; }
  const el = node as El;
  if (el.type === "button" && JSON.stringify(el.props.children ?? "").includes(label)) return el;
  return findButton(el.props?.children, label);
}
