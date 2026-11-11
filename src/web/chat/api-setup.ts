// The browser side of setting up a model from the app (D-496; src/api/http.ts, "Setting up a provider"). The key goes in
// one POST body and is never kept in this page's state after it is sent.
import { ChatProviderKeySavedSchema, ChatProviderStatusSchema, type ChatProviderKeySaved, type ChatProviderStatus } from "../../api/http.ts";
import { ApiError } from "../api.ts";
import { failure, request } from "../api-write.ts";
import type { KeyProvider } from "./setup-words.ts";

export function saveProviderKey(token: string, provider: KeyProvider, key: string): Promise<ChatProviderKeySaved> {
  return request("POST", "/api/chat/provider/key", token, ChatProviderKeySavedSchema, undefined, { provider, key });
}

async function send(method: "DELETE" | "POST", path: string, token: string): Promise<ChatProviderStatus> {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { "x-keyloom-token": token } });
  } catch {
    throw new ApiError(0, "Can't reach keyloom.");
  }
  if (!response.ok) throw await failure(response);
  // `request` in api-write.ts has no DELETE; this keeps its answer for a body the page can't read.
  const parsed = ChatProviderStatusSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ApiError(response.status, "keyloom sent an answer this page can't read. Restart keyloom and reload.");
  return parsed.data;
}

export const forgetProviderKey = (token: string, provider: KeyProvider): Promise<ChatProviderStatus> =>
  send("DELETE", `/api/chat/provider/key/${provider}`, token);

export const startCodexSignIn = (token: string): Promise<ChatProviderStatus> => send("POST", "/api/chat/provider/codex-login", token);
export const cancelCodexSignIn = (token: string): Promise<ChatProviderStatus> => send("DELETE", "/api/chat/provider/codex-login", token);
