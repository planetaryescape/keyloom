// The committed keyboard index (keyboard-index.json), parsed once on first use. Regenerate it with scripts/gen-keyboard-index.ts;
// nothing here reads the network.
import raw from "./keyboard-index.json" with { type: "json" };
import { type KeyboardIndex, KeyboardIndexSchema } from "./index-schema.ts";

let parsed: KeyboardIndex | undefined;

export function keyboardIndex(): KeyboardIndex {
  parsed ??= KeyboardIndexSchema.parse(raw);
  return parsed;
}
