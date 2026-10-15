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
