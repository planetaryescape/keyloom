import { z } from "zod";

// Canonical diagnostics-v1 subset. The checked-in JSON schema is mechanically compared in tests.
const REQUEST_ID = /^[1-9][0-9]{0,19}$/;
export const requestIdSchema = z.string().regex(REQUEST_ID).refine((id) => REQUEST_ID.test(id) && BigInt(id) <= 18446744073709551615n);
export const requestSchema = z.strictObject({
  v: z.literal(1),
  type: z.literal("request"),
  id: requestIdSchema,
  method: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()),
});
export const helloSchema = z.strictObject({ protocol: z.literal(1), hostVersion: z.string(), target: z.string() });
export const identitySchema = z.object({
  protocol: z.literal(1), helperVersion: z.string(), target: z.string(), capabilities: z.tuple([]),
});
export const responseSchema = z.discriminatedUnion("ok", [
  z.object({ v: z.literal(1), type: z.literal("response"), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    v: z.literal(1), type: z.literal("response"), id: z.string(), ok: z.literal(false),
    error: z.object({ code: z.enum(["unsupported", "invalid_request", "version_mismatch"]), effect: z.literal("none"), retry: z.literal("never") }),
  }),
]);
export const MAX_FRAME = 65_536;
