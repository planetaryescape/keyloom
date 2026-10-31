import { expect, test } from "bun:test";
import { acknowledgeView } from "../../src/web/chat/api-chat.ts";

test("a stalled acknowledgement fetch ends with its initiating intent, rather than retaining a dead observer", async () => {
  const original = globalThis.fetch;
  const abort = new AbortController();
  let observed: AbortSignal | null | undefined;
  globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
    observed = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Intent ended", "AbortError")), { once: true });
    });
  }, { preconnect: original.preconnect });
  try {
    const pending = acknowledgeView("synthetic", "run", { version: 1, owner: "30000000-0000-4000-8000-000000000001", configId: "config", intentId: "intent", result: { version: 1, status: "opened" } }, abort.signal);
    expect(observed).toBe(abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow("Intent ended");
  } finally { globalThis.fetch = original; }
});
