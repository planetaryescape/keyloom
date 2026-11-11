// Which way out a chat with no model offers (D-496): Send only when the provider that answers is ready, the picker only when it
// can change the choice, and a new conversation with a ready provider when the pinned one can't answer.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatProviderStatus } from "../../src/api/http.ts";
import { MissingKey } from "../../src/web/chat/ChatStates.tsx";
import { offersPicker, retryOffer } from "../../src/web/chat/provider-ready.ts";

type Provider = ChatProviderStatus["providers"][number];
const base = { label: "x", defaultModel: "m", setup: "s", command: "c", installed: true, credential: null, ready: false } as const;
function status(ready: Provider["id"][], active: Provider["id"] | null, lockedBy: ChatProviderStatus["lockedBy"] = null): ChatProviderStatus {
  return {
    active: active === null ? null : { provider: active, model: "m", effort: "medium" },
    lockedBy, keyStore: "keychain", codexSignIn: { state: "idle" },
    providers: (["anthropic", "openrouter", "codex"] as const).map((id) => ({ ...base, id, ready: ready.includes(id) })),
  };
}

describe("sending a refused message again", () => {
  test("is offered only when the provider that answers is ready, not when some other one is", () => {
    expect(retryOffer(status(["openrouter"], "anthropic", "KEYLOOM_PROVIDER"), null)).toEqual({ kind: "none" });
    expect(retryOffer(status(["anthropic"], "anthropic"), null)).toEqual({ kind: "send" });
  });

  test("a pinned conversation answers on its own provider, so a ready next provider doesn't make it ready", () => {
    expect(retryOffer(status(["openrouter"], "openrouter"), "anthropic")).toEqual({ kind: "switch", to: ["openrouter"] });
    expect(retryOffer(status(["openrouter"], "openrouter", "--provider"), "anthropic")).toEqual({ kind: "none" });
    expect(retryOffer(status(["anthropic"], "openrouter"), "anthropic")).toEqual({ kind: "send" });
  });

  test("the notice shows the switch, not Send, when the pinned provider can't answer", () => {
    const setup = { token: "t", status: status(["openrouter"], "openrouter"), onChanged: () => {}, onReload: () => {} };
    const html = renderToStaticMarkup(<MissingKey setup={setup} retry={{ pinned: "anthropic", onRetry: () => {}, onSwitch: () => {} }} />);
    expect(html).not.toContain("Send your message");
    expect(html).toContain("Use OpenRouter in a new conversation");
  });
});

describe("Set up a model in the review", () => {
  test("offers the picker when a ready provider can be chosen there", () => {
    expect(offersPicker(status(["openrouter"], "anthropic"))).toBe(true);
    expect(offersPicker(status(["anthropic"], "anthropic"))).toBe(false);
    expect(offersPicker(null)).toBe(false);
  });

  test("offers the setup when --provider or KEYLOOM_PROVIDER locks an unready provider", () => {
    expect(offersPicker(status(["openrouter"], "anthropic", "KEYLOOM_PROVIDER"))).toBe(false);
    expect(offersPicker(status(["openrouter"], "anthropic", "--provider"))).toBe(false);
  });
});
