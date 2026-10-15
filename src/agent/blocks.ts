// Stored blocks are neutral between providers (D-111): text, tool_use and tool_result in one shape,
// plus the provider's own block as opaque `providerData` where replaying it exactly matters. This is
// the only place that knows how a provider-shaped block (today every stored one is Anthropic's) maps
// to the neutral shape, so the app and the other adapters never inspect `providerData`.
import type { ContentBlock } from "./model.ts";

type Raw = { type: string; [key: string]: unknown };

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && typeof (value as Raw).type === "string";

/** A tool result's content is a string, or (Anthropic) a list of text blocks; the neutral form is the text. */
function resultText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content.map((c) => (isRaw(c) && c.type === "text" && typeof c.text === "string" ? c.text : null));
  return parts.every((p) => p !== null) ? parts.join("") : null;
}

const sameKeys = (raw: Raw, keys: string[]) => Object.keys(raw).every((k) => keys.includes(k));

/**
 * The neutral form of a block as a provider (or an old row) wrote it. Idempotent: a block that is
 * already neutral comes back as it is. When the provider's block carries anything the neutral form
 * drops, it is kept whole in `providerData`.
 */
export function neutralBlock(raw: Raw): ContentBlock {
  if ("providerData" in raw && raw.providerData !== undefined) return raw as ContentBlock;
  const keep = (neutral: ContentBlock, keys: string[]): ContentBlock => (sameKeys(raw, keys) ? neutral : { ...neutral, providerData: raw });
  if (raw.type === "text" && typeof raw.text === "string") return keep({ type: "text", text: raw.text }, ["type", "text"]);
  if (raw.type === "tool_use" && typeof raw.id === "string" && typeof raw.name === "string") {
    return keep({ type: "tool_use", id: raw.id, name: raw.name, input: raw.input }, ["type", "id", "name", "input"]);
  }
  if (raw.type === "tool_result" && typeof raw.tool_use_id === "string") {
    const content = resultText(raw.content);
    if (content !== null) {
      const neutral: ContentBlock = { type: "tool_result", tool_use_id: raw.tool_use_id, content, ...(typeof raw.is_error === "boolean" ? { is_error: raw.is_error } : {}) };
      // A string `content` is already neutral; a list of text blocks is not, so the original stays for replay.
      if (typeof raw.content !== "string") return { ...neutral, providerData: raw };
      return keep(neutral, ["type", "tool_use_id", "content", ...(raw.is_error === undefined ? [] : ["is_error"])]);
    }
  }
  // Thinking, redacted thinking and anything else the neutral form has no word for.
  return { type: "opaque", providerData: raw };
}

/** The block to put on the wire for a provider that replays its own blocks: the original when kept, else the neutral one. */
export function wireBlock(block: ContentBlock): unknown {
  return "providerData" in block && block.providerData !== undefined ? block.providerData : block;
}
