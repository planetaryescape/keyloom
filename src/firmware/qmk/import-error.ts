// Its own file so the readers that throw it (source.ts, keymap-json.ts) can import it without importing each other.
export class ImportError extends Error {
  override name = "ImportError";
}
