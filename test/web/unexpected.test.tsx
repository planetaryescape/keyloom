import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import type { Layout } from "../../src/layout/schema.ts";
import { failure, request } from "../../src/web/api-write.ts";
import { fetchLayouts } from "../../src/web/api.ts";
import { HistoryPanel } from "../../src/web/history/HistoryPanel.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS, failureCode, failureWords, unexpectedWayOut } from "../../src/web/shell/unexpected.ts";

let mock: ReturnType<typeof spyOn> | undefined;
afterEach(() => mock?.mockRestore());
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a failure with no code gets one from its status, so no screen shows a status number (R7-01)", () => {
  expect(failureCode(500, undefined)).toBe("internal");
  expect(failureCode(502, undefined)).toBe("internal");
  expect(failureCode(404, undefined)).toBe("not_found");
  expect(failureCode(405, undefined)).toBe("unreadable");
  expect(failureCode(409, "stale_base")).toBe("stale_base");
});

test("the page says unexpected failures in its own words and keeps every other code's sentence", () => {
  expect(failureWords("internal", "internal error")).toBe(INTERNAL_WORDS);
  expect(failureWords("not_found", 'no layout "x"')).toBe(NOT_FOUND_WORDS);
  expect(failureWords("unreadable", "")).toBe(UNREADABLE_WORDS);
  expect(failureWords("stale_base", "The layout changed.")).toBe("The layout changed.");
  for (const words of [INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS]) expect(words).not.toMatch(/internal error|answered \d|terminal|reload/i);
});

test("Try again only where repeating is safe and can pass; Restart keyloom always; nothing for a screen's own code", () => {
  expect(unexpectedWayOut("internal", true)).toEqual({ retry: true, restart: true });
  expect(unexpectedWayOut("internal", false)).toEqual({ retry: false, restart: true });
  // A thing keyloom can't find, or an answer this page can't read, fails the same way every time.
  expect(unexpectedWayOut("not_found", true)).toEqual({ retry: false, restart: true });
  expect(unexpectedWayOut("unreadable", true)).toEqual({ retry: false, restart: true });
  expect(unexpectedWayOut("stale_base", true)).toBeNull();
  expect(unexpectedWayOut(undefined, true)).toBeNull();
});

test("failure() maps the server's coded exception and an uncoded answer to the page's words", async () => {
  const internal = await failure(json({ error: { code: "internal", message: "internal error" } }, 500));
  expect(internal).toMatchObject({ status: 500, code: "internal", message: INTERNAL_WORDS });
  const plain = await failure(new Response("not found", { status: 404 }));
  expect(plain).toMatchObject({ status: 404, code: "not_found", message: NOT_FOUND_WORDS });
  const bare = await failure(new Response("", { status: 503 }));
  expect(bare).toMatchObject({ code: "internal", message: INTERNAL_WORDS });
  const refused = await failure(json({ error: { code: "stale_base", message: "The layout changed." } }, 409));
  expect(refused).toMatchObject({ code: "stale_base", message: "The layout changed." });
});

test("an answer the page can't read is `unreadable`, with words that send the person to Restart keyloom (R7-09)", async () => {
  mock = spyOn(globalThis, "fetch").mockImplementation((async () => json({ unexpected: true }, 200)) as unknown as typeof fetch);
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(request("GET", "/api/x", "t", z.object({ ok: z.literal(true) }))).rejects.toMatchObject({ code: "unreadable", message: UNREADABLE_WORDS });
    await expect(fetchLayouts("t", new AbortController().signal)).rejects.toMatchObject({ code: "unreadable", message: UNREADABLE_WORDS });
  } finally {
    logged.mockRestore();
  }
});

const historyProps = {
  token: "t", layout: { layers: [] as Layout["layers"], macros: [] as Layout["macros"], tapDances: [] as Layout["tapDances"] }, configName: "Daily", boardName: "Moonlander", onKeyboard: false, onClose: () => {},
  onReload: () => {}, onGoBack: async () => {}, onCompare: () => {}, onPutOn: () => {}, onNewConfig: () => {}, onName: async () => {}, blockedReason: null,
};

test("a history keyloom can't find offers Restart keyloom, never a Try again that would fail the same way (R7 sweep)", () => {
  const html = renderToStaticMarkup(<HistoryPanel {...historyProps} versions={{ status: "error", message: NOT_FOUND_WORDS, code: "not_found" }} />);
  expect(html).toContain("keyloom couldn&#x27;t find what this page asked for.");
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Try again");
});

test("a history read that hit an exception offers Try again and Restart keyloom", () => {
  const html = renderToStaticMarkup(<HistoryPanel {...historyProps} versions={{ status: "error", message: INTERNAL_WORDS, code: "internal" }} />);
  expect(html).toContain("Try again");
  expect(html).toContain("Restart keyloom");
});

test("a history read that lost its connection keeps its Try again alone", () => {
  const html = renderToStaticMarkup(<HistoryPanel {...historyProps} versions={{ status: "error", message: "keyloom stopped answering.", code: "unreachable" }} />);
  expect(html).toContain("Try again");
  expect(html).not.toContain("Restart keyloom");
});
