// Codex reports failures as message strings only, so the kind is decided by matching the text (D-108).
import type { ModelErrorKind } from "../model.ts";

export class CodexError extends Error {
  override name = "CodexError";
  constructor(readonly kind: ModelErrorKind, message: string) {
    super(message);
  }
}

export const LOGIN_HINT = "Run `codex login` and sign in with ChatGPT, then send the message again.";

/** The usage-limit wording is from codex-rs/protocol (error_tests.rs); the rest is the usual phrasing of a signed-out client. */
export function codexErrorFor(message: string): CodexError {
  const text = message.trim() || "Codex failed without saying why";
  if (/usage limit|rate limit|too many requests|\b429\b/i.test(text)) {
    return new CodexError("rate_limit", `Codex hit your ChatGPT usage limit: ${text}`);
  }
  // codex-rs/protocol/src/error.rs words it "ran out of room in the model's context window"; sending it again is refused the same way (R4-11).
  if (/ran out of room in the model's context window|context window exceeded|context_length_exceeded/i.test(text)) {
    return new CodexError("context_full", "This conversation is too long for Codex's model to read in one go.");
  }
  if (/not logged in|log in|login|sign in|unauthori[sz]ed|\b401\b|auth(entication)? (failed|required)|token (expired|invalid)/i.test(text)) {
    return new CodexError("missing_key", `Codex is not signed in (${text}). ${LOGIN_HINT}`);
  }
  if (/stream (disconnected|closed)|connection|network|timed out|unreachable|dns/i.test(text)) {
    return new CodexError("connection", `Codex could not reach OpenAI: ${text}`);
  }
  return new CodexError("request", `Codex failed: ${text}`);
}

export const notInstalled = (bin: string): CodexError =>
  new CodexError("missing_key", `keyloom could not run \`${bin}\`. Install the Codex CLI (https://developers.openai.com/codex/cli), then run \`codex login\`.`);
