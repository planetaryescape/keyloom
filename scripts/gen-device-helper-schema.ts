// Regenerate the candidate transport supplement; diagnostics-v1 remains independently frozen.
import { z } from "zod";
import { requestIdSchema, requestSchema, responseSchema, helloSchema, identitySchema, MAX_FRAME } from "../src/firmware/toolchain/device-helper/protocol.ts";
import { operationSchema, transportResponseSchema, transportEventSchema, transportIdentitySchema, hidDevicesSchema, writtenSchema, serialDevicesSchema, serialWrittenSchema, touchedSchema, closedSchema } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";
const schema = (value: z.ZodType) => z.toJSONSchema(value, { unrepresentable: "any" });
// JSON Schema pattern bounds decimal request IDs to 20 digits, but cannot compare them with u64 max.
const documentedRuntimeRefinements = new Map<object, string>([[requestIdSchema, "request ID must fit in unsigned 64-bit range"]]);
interface ZodSchemaGraphNode {}
function assertRefinementsDocumented(...roots: z.ZodType[]) {
  const visited = new Set<object>();
  // SAFETY: The visitor receives only objects reached from the local, trusted Zod schema graph.
  const visit = (node: ZodSchemaGraphNode) => {
    if (visited.has(node)) return;
    visited.add(node);
    if (node instanceof z.ZodType) {
      const def = node._zod.def;
      if (def.type && def.checks?.some((check) => check._zod.def.check === "custom")) {
        const allowance = Object.getOwnPropertyDescriptor(node.meta?.() ?? {}, "x-runtime-refinement")?.value ?? documentedRuntimeRefinements.get(node);
        if (!allowance) {
          throw new Error(`Undocumented runtime refinement in Zod ${def.type} schema; add a commented x-runtime-refinement allowance or express it in JSON Schema`);
        }
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach((entry) => { if (entry instanceof Object) visit(entry); });
      else if (child instanceof Object) visit(child);
    }
  };
  roots.forEach((root) => visit(root));
}
assertRefinementsDocumented(operationSchema, transportResponseSchema, transportEventSchema, transportIdentitySchema, hidDevicesSchema, writtenSchema, serialDevicesSchema, serialWrittenSchema, closedSchema, requestSchema, responseSchema, helloSchema, identitySchema);
const contract = {
  ...schema(z.union([operationSchema, transportResponseSchema, transportEventSchema])),
  $defs: { identity: schema(transportIdentitySchema), devices: schema(hidDevicesSchema), written: schema(writtenSchema), serialDevices: schema(serialDevicesSchema), serialWritten: schema(serialWrittenSchema), touched: schema(touchedSchema), closed: schema(closedSchema) },
  "x-maxFrameBytes": 65_536, "x-maxSessions": 8, "x-maxPending": 32, "x-maxDataEvents": 1024, "x-maxSerialOutputChunks": 16, "x-maxSerialChunkBytes": 4096,
};
await Bun.write(new URL("../native/device-helper/protocol/transport-v1.schema.json", import.meta.url), `${JSON.stringify(contract, null, 2)}\n`);

// Keep the diagnostics-only schema frozen while generating both contracts from their TS sources.
const diagnostics = {
  ...schema(z.union([requestSchema, responseSchema])),
  $defs: { helloParams: schema(helloSchema), helloResult: schema(identitySchema) },
  "x-maxFrameBytes": MAX_FRAME, "x-maxRequestId": "18446744073709551615",
};
await Bun.write(new URL("../native/device-helper/protocol/v1.schema.json", import.meta.url), `${JSON.stringify(diagnostics, null, 2)}\n`);
