import { z } from "zod";
import { identitySchema, requestSchema } from "./protocol.ts";

export const HID_CAPABILITIES = ["hid.list", "hid.open", "hid.write"] as const;
export const capabilitySchema = z.enum(HID_CAPABILITIES);
export const transportIdentitySchema = identitySchema.extend({ capabilities: z.array(capabilitySchema).max(3).refine((v) => new Set(v).size === v.length) });
const token = z.string().min(1).max(128);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).max(20);
export const transportErrorSchema = z.object({
  code: z.enum(["permission_denied", "busy", "not_found", "stale_device", "ambiguous_device", "unsupported", "invalid_request", "invalid_session", "capacity", "io_failed", "timeout", "disconnected", "overflow", "protocol_error", "helper_exited", "version_mismatch", "helper_unavailable"]),
  effect: z.enum(["none", "possible", "confirmed_transport_only"]),
  retry: z.enum(["never", "after_rediscovery", "after_user_action"]),
});
export const transportResponseSchema = z.discriminatedUnion("ok", [
  z.object({ v: z.literal(1), type: z.literal("response"), id: token, ok: z.literal(true), result: z.unknown() }),
  z.object({ v: z.literal(1), type: z.literal("response"), id: token, ok: z.literal(false), error: transportErrorSchema }),
]);
const eventBase = { v: z.literal(1), type: z.literal("event"), sessionId: token, seq: count.refine((n) => n > 0) };
export const reportBytesSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).refine((v) => Buffer.from(v, "base64").toString("base64") === v);
export const transportEventSchema = z.discriminatedUnion("event", [
  z.object({ ...eventBase, event: z.literal("data"), receivedAtUs: decimal, bytes: reportBytesSchema }),
  z.object({ ...eventBase, event: z.literal("failed"), error: transportErrorSchema, loss: z.enum(["none_known", "detected", "unknown"]) }),
  z.object({ ...eventBase, event: z.literal("closed"), reason: z.enum(["requested", "failed"]) }),
]);
const u16 = z.number().int().min(0).max(65535);
export const hidDevicesSchema = z.object({ devices: z.array(z.object({
  deviceRef: token, transport: z.literal("hid"), vendorId: u16, productId: u16,
  serial: z.string().refine((v) => Buffer.byteLength(v) <= 256).optional(),
  usagePage: z.literal(0xff60), usage: z.literal(0x61),
})).max(256) });
export const openedSchema = z.object({ sessionId: token });
export const writtenSchema = z.object({ acceptedBytes: z.literal(32) });
export const closedSchema = z.object({ finalSeq: count });
export const operationSchema = z.discriminatedUnion("method", [
  requestSchema.extend({ method: z.literal("list"), params: z.strictObject({ transport: z.literal("hid") }) }),
  requestSchema.extend({ method: z.literal("hid.open"), params: z.strictObject({ deviceRef: token }) }),
  requestSchema.extend({ method: z.literal("hid.write"), params: z.strictObject({ deviceRef: token, reportId: z.literal(0), bytes: reportBytesSchema }) }),
  requestSchema.extend({ method: z.literal("session.write"), params: z.strictObject({ sessionId: token, reportId: z.literal(0), bytes: reportBytesSchema }) }),
  requestSchema.extend({ method: z.literal("session.close"), params: z.strictObject({ sessionId: token }) }),
]);
export type TransportEvent = z.infer<typeof transportEventSchema>;
export type TransportError = z.infer<typeof transportErrorSchema>;
