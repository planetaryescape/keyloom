// R8-03: the chat's conversation list, the decisions view and the direct-edit toast keep a failure's code, so an answer that fails the
// same way every time offers Restart keyloom, never a bare Try again.
import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Layout } from "../../src/layout/schema.ts";
import { ConversationList } from "../../src/web/chat/ConversationList.tsx";
import { DecisionsView } from "../../src/web/decisions/DecisionsView.tsx";
import { applyOps } from "../../src/web/editor/useChange.ts";
import { RestartDialog } from "../../src/web/shell/RestartDialog.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, type PageFailure, UNREADABLE_WORDS, failureError, pageFailure, wayOutFor } from "../../src/web/shell/unexpected.ts";
import { ApiError } from "../../src/web/api.ts";
import { ProblemNotice, SwitchFailed } from "../../src/web/chat/ChatStates.tsx";
import { CLOSED_WORDS, proposalApplyFailure, proposalFailureWay } from "../../src/web/chat/proposal-apply-words.ts";
import { type Problem, classify } from "../../src/web/chat/useChat.ts";
import { FailureNote } from "../../src/web/shell/UnexpectedWayOut.tsx";

let mock: ReturnType<typeof spyOn> | undefined;
afterEach(() => mock?.mockRestore());

const list = (history: Parameters<typeof ConversationList>[0]["history"]) =>
  renderToStaticMarkup(<ConversationList token="t" history={history} currentId={null} onBack={() => {}} onReload={() => {}} onOpen={async () => null} />);

test("a conversation list keyloom answers with its catch-all offers Restart keyloom and no Try again", () => {
  const html = list({ status: "error", message: NOT_FOUND_WORDS, code: "not_found", generic: true });
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Try again");
});

test("a conversation list read that hit an exception offers Try again and Restart keyloom; a lost connection keeps Try again alone", () => {
  const internal = list({ status: "error", message: INTERNAL_WORDS, code: "internal" });
  expect(internal).toContain("Try again");
  expect(internal).toContain("Restart keyloom");
  const lost = list({ status: "error", message: "keyloom stopped answering.", code: "unreachable" });
  expect(lost).toContain("Try again");
  expect(lost).not.toContain("Restart keyloom");
});

// SAFETY: the view reads the layout only to name a decision's keys, and these tests render no decisions.
const layout = {} as Layout;
const decisions = (state: Parameters<typeof DecisionsView>[0]["state"]) => renderToStaticMarkup(
  <DecisionsView token="t" state={state} layout={layout} onBack={() => {}} onReload={() => {}} onHighlight={() => {}} onEdit={async () => {}} onRetire={async () => {}} onOpenConversation={async () => null} />,
);

test("what keyloom remembers, unreadable, offers Restart keyloom and no Try again", () => {
  const html = decisions({ status: "error", message: UNREADABLE_WORDS, code: "unreadable" });
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Try again");
});

test("what keyloom remembers, with a route's own not_found, keeps the screen's Try again", () => {
  const html = decisions({ status: "error", message: "no layout l1", code: "not_found" });
  expect(html).toContain("Try again");
  expect(html).not.toContain("Restart keyloom");
});

test("a direct edit refused by keyloom's catch-all keeps the failure, so its toast offers Restart keyloom", async () => {
  mock = spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ error: { code: "not_found", message: "not found", generic: true } }, { status: 404 })) as unknown as typeof fetch);
  const outcome = await applyOps({ token: "t", layoutRef: "l", revisionId: "r1", onChanged: async () => {}, onNotShown: () => {}, onStale: () => {} }, [], "Swapped A and B");
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.message).toBe(NOT_FOUND_WORDS);
  expect(outcome.failure).toEqual({ message: NOT_FOUND_WORDS, code: "not_found", generic: true });
  expect(wayOutFor(outcome.failure ?? { message: "" }, true)).toEqual({ retry: false, restart: true });
});

test("the dialog a toast's Restart keyloom opens says what happened and offers Restart keyloom and Close", () => {
  const html = renderToStaticMarkup(<RestartDialog token="t" title="keyloom couldn't make that change" failure={{ message: INTERNAL_WORDS, code: "internal" }} onRetry={() => {}} onClose={() => {}} />);
  expect(html).toContain("keyloom couldn&#x27;t make that change");
  expect(html).toContain("keyloom hit a problem it didn&#x27;t expect.");
  expect(html).toContain("Try again");
  expect(html).toContain("Restart keyloom");
  expect(html).toContain("Close");
  const missing = renderToStaticMarkup(<RestartDialog token="t" title="x" failure={{ message: NOT_FOUND_WORDS, code: "not_found", generic: true }} onClose={() => {}} />);
  expect(missing).not.toContain("Try again");
});

// PR #305 review: the chat composer's own failure box, and the smaller chat and decision paths, keep the code too.
const setup = { token: "t", status: null, onChanged: () => {}, onReload: () => {} };
const notice = (problem: Problem, onRetry?: () => void) =>
  renderToStaticMarkup(<ProblemNotice problem={problem} setup={setup} retry={{ pinned: null, onRetry, onSwitch: () => {} }} onDismiss={() => {}} />);

test("the composer keeps a refused message's code and generic flag", () => {
  expect(classify(new ApiError(500, INTERNAL_WORDS, { code: "internal" }))).toEqual({ kind: "other", message: INTERNAL_WORDS, code: "internal" });
  expect(classify(new ApiError(404, NOT_FOUND_WORDS, { code: "not_found", generic: true }))).toEqual({ kind: "other", message: NOT_FOUND_WORDS, code: "not_found", generic: true });
  expect(classify(new ApiError(409, "keyloom is still answering.", { code: "busy" }))).toMatchObject({ kind: "busy", code: "busy" });
  expect(classify("x")).toEqual({ kind: "other", message: "Something went wrong sending that." });
});

test("the composer's failure box offers Try again and Restart keyloom for an exception", () => {
  const html = notice({ kind: "other", message: INTERNAL_WORDS, code: "internal" }, () => {});
  expect(html).toContain("Try again");
  expect(html).toContain("Restart keyloom");
});

test("the composer's failure box offers Restart keyloom alone for an unreadable answer or keyloom's catch-all, even with the message in the box", () => {
  for (const problem of [{ kind: "other", message: UNREADABLE_WORDS, code: "unreadable" }, { kind: "other", message: NOT_FOUND_WORDS, code: "not_found", generic: true }] as const) {
    const html = notice(problem, () => {});
    expect(html).toContain("Restart keyloom");
    expect(html).not.toContain("Try again");
  }
});

test("the composer's own refusals keep their Try again and add no Restart keyloom", () => {
  const busy = notice({ kind: "busy", message: "keyloom is still answering.", code: "busy" }, () => {});
  expect(busy).toContain("Try again");
  expect(busy).not.toContain("Restart keyloom");
  // A route's own not_found (the conversation was deleted) stays the screen's.
  expect(notice({ kind: "other", message: "no conversation c1", code: "not_found" }, () => {})).not.toContain("Restart keyloom");
});

test("a provider switch keyloom can't read offers Restart keyloom and no Try again; an exception keeps Try again", () => {
  const switched = (failure: PageFailure) => renderToStaticMarkup(<SwitchFailed token="t" to="codex" failure={failure} onRetry={() => {}} onDismiss={() => {}} />);
  const unreadable = switched({ message: UNREADABLE_WORDS, code: "unreadable" });
  expect(unreadable).toContain("Restart keyloom");
  expect(unreadable).not.toContain("Try again");
  const internal = switched({ message: INTERNAL_WORDS, code: "internal" });
  expect(internal).toContain("Try again");
  expect(internal).toContain("Restart keyloom");
});

test("a failed forget, outcome answer or model choice adds Restart keyloom beside the control that failed, only where it applies", () => {
  const note = (failure: PageFailure, token: string | null = "t") => renderToStaticMarkup(<FailureNote token={token ?? undefined} failure={failure} className="decision-problem" />);
  expect(note({ message: UNREADABLE_WORDS, code: "unreadable" })).toContain("Restart keyloom");
  expect(note({ message: INTERNAL_WORDS, code: "internal" })).toContain("Restart keyloom");
  // The control that failed is the Try again, so the note never adds one.
  expect(note({ message: INTERNAL_WORDS, code: "internal" })).not.toContain("Try again");
  expect(note({ message: "Can't reach keyloom.", code: "unreachable" })).not.toContain("Restart keyloom");
  expect(note({ message: UNREADABLE_WORDS, code: "unreadable" }, null)).not.toContain("Restart keyloom");
});

test("a proposal card keeps Read proposals again only where a read can pass, and adds Restart keyloom for the unexpected", () => {
  expect(proposalFailureWay({ message: CLOSED_WORDS, closed: true })).toEqual({ apply: true, readAgain: true, restart: false });
  expect(proposalFailureWay({ message: "x", closed: true, code: "internal" })).toEqual({ apply: true, readAgain: true, restart: true });
  expect(proposalFailureWay({ message: "x", closed: true, code: "unreadable" })).toEqual({ apply: false, readAgain: false, restart: true });
  expect(proposalFailureWay({ message: "x", closed: true, code: "not_found", generic: true })).toEqual({ apply: false, readAgain: false, restart: true });
  expect(proposalFailureWay({ message: "x", closed: false, code: "internal" })).toEqual({ apply: true, readAgain: false, restart: true });
  // R9-04: after an answer that fails the same way every time, Apply is off, with the sentence and Restart keyloom beside it.
  expect(proposalFailureWay({ message: UNREADABLE_WORDS, closed: false, code: "unreadable" }).apply).toBe(false);
  expect(proposalFailureWay({ message: NOT_FOUND_WORDS, closed: false, code: "not_found", generic: true }).apply).toBe(false);
  expect(proposalFailureWay({ message: "Can't reach keyloom.", closed: false, code: "unreachable" }).apply).toBe(true);
  // keyloom's catch-all on Apply is a version mismatch, not a proposal that was closed elsewhere.
  expect(proposalApplyFailure({ code: "not_found", generic: true, message: NOT_FOUND_WORDS }).closed).toBe(false);
  expect(proposalApplyFailure({ code: "not_found", message: "no change set cs1" }).closed).toBe(true);
});

test("a failure rethrown as an Error keeps its code, so reading the proposals again doesn't lose it", () => {
  const kept = { message: NOT_FOUND_WORDS, code: "not_found", generic: true };
  expect(pageFailure(failureError(kept), "x")).toEqual(kept);
  expect(pageFailure(failureError({ message: "m" }), "x")).toEqual({ message: "m" });
});
