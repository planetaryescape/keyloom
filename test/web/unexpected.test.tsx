import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import type { Layout } from "../../src/layout/schema.ts";
import { IMPORT_TOO_LARGE } from "../../src/api/http.ts";
import { failure, isGone, removeOrGone, request } from "../../src/web/api-write.ts";
import { ApiError, fetchLayouts } from "../../src/web/api.ts";
import { uploadLayout } from "../../src/web/import/api-import.ts";
import { HistoryPanel } from "../../src/web/history/HistoryPanel.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, TOO_LARGE_WORDS, UNREADABLE_WORDS, failureCode, failureWords, unexpectedWayOut } from "../../src/web/shell/unexpected.ts";

let mock: ReturnType<typeof spyOn> | undefined;
afterEach(() => mock?.mockRestore());
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a failure with no code gets one from its status, so no screen shows a status number (R7-01)", () => {
  expect(failureCode(500, undefined)).toBe("internal");
  expect(failureCode(502, undefined)).toBe("internal");
  expect(failureCode(404, undefined)).toBe("not_found");
  // Bun refuses a body over the server's cap with a bare 413 before any route runs (#301 review).
  expect(failureCode(413, undefined)).toBe("too_large");
  expect(failureCode(405, undefined)).toBe("unreadable");
  expect(failureCode(409, "stale_base")).toBe("stale_base");
});

test("the page says unexpected failures in its own words and keeps every other code's sentence, a route's own not_found included", () => {
  expect(failureWords("internal", "internal error")).toBe(INTERNAL_WORDS);
  expect(failureWords("unreadable", null)).toBe(UNREADABLE_WORDS);
  expect(failureWords("stale_base", "The layout changed.")).toBe("The layout changed.");
  // A route's not_found names the way on, which the restart words would replace (#301 review).
  expect(failureWords("not_found", "This build has no firmware file. Build it again.")).toBe("This build has no firmware file. Build it again.");
  // No sentence from the server: no code, or its catch-all.
  expect(failureWords("not_found", null)).toBe(NOT_FOUND_WORDS);
  expect(failureWords("too_large", null)).toBe(TOO_LARGE_WORDS);
  for (const words of [INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS, TOO_LARGE_WORDS]) expect(words).not.toMatch(/internal error|answered \d|terminal|reload/i);
  expect(TOO_LARGE_WORDS).not.toMatch(/version|restart/i);
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

test("failure() keeps a route's own not_found sentence and uses the restart words only for the server's catch-all (#301 review)", async () => {
  const route = await failure(json({ error: { code: "not_found", message: "This build has no firmware file. Build it again." } }, 404));
  expect(route).toMatchObject({ code: "not_found", message: "This build has no firmware file. Build it again." });
  const catchAll = await failure(json({ error: { code: "not_found", message: "not found", generic: true } }, 404));
  expect(catchAll).toMatchObject({ code: "not_found", message: NOT_FOUND_WORDS });
  // An older keyloom's bare body has no code, so the page gives it one with its own words.
  const old = await failure(json({ error: "not found" }, 404));
  expect(old).toMatchObject({ code: "not_found", message: NOT_FOUND_WORDS });
});

test("a body Bun refused for size is too_large, never the version-mismatch words (#301 review)", async () => {
  expect(await failure(new Response("", { status: 413 }))).toMatchObject({ code: "too_large", message: TOO_LARGE_WORDS });
  // A route's own too_large keeps its sentence.
  const route = await failure(json({ error: { code: "too_large", message: "The request body is too large." } }, 413));
  expect(route).toMatchObject({ code: "too_large", message: "The request body is too large." });
});

test("an import over the cap says the import route's words, whether Bun or the route refused it", async () => {
  for (const answer of [() => new Response("", { status: 413 }), () => json({ error: { code: "too_large", message: IMPORT_TOO_LARGE } }, 413)]) {
    mock = spyOn(globalThis, "fetch").mockImplementation((async () => answer()) as unknown as typeof fetch);
    await expect(uploadLayout("t", "zsa/moonlander", new File(["x"], "big.zip"))).rejects.toMatchObject({ code: "too_large", message: IMPORT_TOO_LARGE });
    mock.mockRestore();
  }
});

test("removing something another tab already removed counts as removed; any other failure still throws", async () => {
  await expect(removeOrGone(async () => { throw new ApiError(404, 'no priority "p1"', { code: "not_found" }); })).resolves.toBeUndefined();
  await expect(removeOrGone(async () => { throw new ApiError(500, INTERNAL_WORDS, { code: "internal" }); })).rejects.toMatchObject({ code: "internal" });
  expect(isGone(new ApiError(404, "x", { code: "not_found" }))).toBe(true);
  expect(isGone(new ApiError(409, "x", { code: "stale_base" }))).toBe(false);
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
