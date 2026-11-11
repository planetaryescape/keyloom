import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchLayouts } from "../../src/web/api.ts";
import type { LayoutSummary } from "../../src/api/http.ts";

interface LayoutListBody {
  layouts: LayoutSummary[];
}

const summary: LayoutSummary = {
  id: "a",
  name: "A",
  boardId: "zsa/moonlander",
  createdAt: 1,
  updatedAt: 1,
  revisionId: "rev_a",
};

let mock: ReturnType<typeof spyOn> | undefined;
const controller = new AbortController();

afterEach(() => {
  mock?.mockRestore();
});

function respondWith(body: LayoutListBody): void {
  mock = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

describe("fetchLayouts", () => {
  test("returns the layouts from a well-formed response", async () => {
    respondWith({ layouts: [summary] });
    expect(await fetchLayouts("tok", controller.signal)).toEqual([summary]);
  });

  test("a malformed response gives the page a plain sentence, and the detail goes to the console", async () => {
    respondWith({ layouts: [{ ...summary, id: "" }] });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      // The anchored pattern rules out the raw ZodError text, which the page must never show.
      await expect(fetchLayouts("tok", controller.signal)).rejects.toThrow(
        /^keyloom sent a layout this page can't read\. Restart keyloom and reload\.$/,
      );
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("why a layout read failed, as a code the page acts on (R1-08)", () => {
  const read = async (answer: Response | Error) => {
    mock = answer instanceof Error ? spyOn(globalThis, "fetch").mockRejectedValue(answer) : spyOn(globalThis, "fetch").mockResolvedValue(answer);
    return fetchLayouts("tok", controller.signal).then(() => null, (e: unknown) => e as { status: number; code?: string; message: string });
  };

  test("404 is a layout that is gone, said in words, never the path", async () => {
    const e = await read(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
    expect(e).toMatchObject({ status: 404, code: "not_found" });
    expect(e?.message).not.toContain("/api/");
  });

  test("no answer at all is keyloom gone, with no terminal in the sentence", async () => {
    const e = await read(new TypeError("Failed to fetch"));
    expect(e).toMatchObject({ status: 0, code: "unreachable" });
    expect(e?.message).not.toMatch(/terminal|Failed to fetch/);
  });

  test("401 says keyloom restarted", async () => {
    expect(await read(new Response("", { status: 401 }))).toMatchObject({ status: 401, code: "token", message: expect.stringContaining("restarted") });
  });

  test("any other failure carries the server's own sentence when it sent one", async () => {
    expect(await read(new Response(JSON.stringify({ error: { code: "internal", message: "internal error" } }), { status: 500 }))).toMatchObject({ status: 500, message: "internal error" });
  });
});
