// R8-03: the chat's conversation list, the decisions view and the direct-edit toast keep a failure's code, so an answer that fails the
// same way every time offers Restart keyloom, never a bare Try again.
import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Layout } from "../../src/layout/schema.ts";
import { ConversationList } from "../../src/web/chat/ConversationList.tsx";
import { DecisionsView } from "../../src/web/decisions/DecisionsView.tsx";
import { applyOps } from "../../src/web/editor/useChange.ts";
import { RestartDialog } from "../../src/web/shell/RestartDialog.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS, wayOutFor } from "../../src/web/shell/unexpected.ts";

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

const layout = { layers: [] as Layout["layers"], macros: [] as Layout["macros"], tapDances: [] as Layout["tapDances"] } as unknown as Layout;
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
