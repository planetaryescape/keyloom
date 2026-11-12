// A provider switch made in one reader of the status (the review, or chat) shows in the other without a reload (R6-01 review).
import { expect, test } from "bun:test";
import type { ChatProviderStatus } from "../../src/api/http.ts";
import { onSharedProviderStatus, shareProviderStatus } from "../../src/web/chat/useProviderStatus.ts";

const status = (provider: "anthropic" | "codex"): ChatProviderStatus => ({
  active: { provider, model: "m", effort: "medium" }, lockedBy: null, keyStore: null, codexSignIn: { state: "idle" }, providers: [],
});

test("a status one reader saves reaches every other reader on the page, until it stops listening", () => {
  const page = new EventTarget();
  const chat: ChatProviderStatus[] = [];
  const stop = onSharedProviderStatus((next) => chat.push(next), page);
  shareProviderStatus(status("anthropic"), page);
  expect(chat.map((s) => s.active?.provider)).toEqual(["anthropic"]);
  stop();
  shareProviderStatus(status("codex"), page);
  expect(chat).toHaveLength(1);
});
