/** Codes cross the presentation boundary; raw exception messages and inputs never do. */
export class PublicToolError extends Error {
  constructor(readonly publicCode: "invalid_input" | "function_id" | "unknown_layer", message: string) { super(message); }
}
