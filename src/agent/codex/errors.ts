// Codex reports failures as message strings only, so the kind is decided by matching the text (D-108).
import type { ModelErrorKind } from "../model.ts";

export class CodexError extends Error {
  override name = "CodexError";
  constructor(readonly kind: ModelErrorKind, message: string) {
    super(message);
  }
}

export const LOGIN_HINT = "Run `codex login` and sign in with ChatGPT, then send the message again.";

// codex-rs/protocol/src/error.rs @ f096185f formats the reset as "try again at 3:45 PM." on the day it resets, and as
// "try again at Nov 12th, 2026 3:45 PM." on a later day, in this computer's time zone (format_retry_timestamp).
const RESET_AT = /try again at ((?:[A-Z][a-z]{2} \d{1,2}(?:st|nd|rd|th), \d{4} )?\d{1,2}:\d{2} [AP]M)/i;

/** When Codex says the usage limit resets, as Codex wrote it; null when it didn't say ("try again later"). */
export function codexResetTime(text: string): string | null {
  return RESET_AT.exec(text)?.[1] ?? null;
}

/**
 * The usage-limit wording is from codex-rs/protocol/src/error.rs @ f096185f ("You’ve hit your usage limit…", and the workspace spend cap);
 * the rest is the usual phrasing of a signed-out client.
 */
export function codexErrorFor(message: string): CodexError {
  const text = message.trim() || "Codex failed without saying why";
  // A used-up plan allowance stays used up until it resets, so Try again alone is no way out: the page offers another provider (R5-04).
  // Codex's own sentence names upgrade pages and settings for a terminal, so these words are keyloom's, with the reset time when given.
  if (/usage limit|spend cap/i.test(text)) {
    const resets = codexResetTime(text);
    return new CodexError("usage_limit", `Your ChatGPT plan has used up its Codex allowance${resets === null ? ", and Codex didn't say when it resets." : ` until ${resets}.`}`);
  }
  if (/rate limit|too many requests|\b429\b/i.test(text)) {
    return new CodexError("rate_limit", `OpenAI is limiting Codex's requests for now: ${text}`);
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
