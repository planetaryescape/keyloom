// Regenerate the candidate transport supplement; diagnostics-v1 remains independently frozen.
import { z } from "zod";
import { requestSchema, responseSchema, helloSchema, identitySchema, MAX_FRAME } from "../src/firmware/toolchain/device-helper/protocol.ts";
import { operationSchema, transportResponseSchema, transportEventSchema, transportIdentitySchema, hidDevicesSchema, writtenSchema, serialDevicesSchema, serialWrittenSchema, touchedSchema, closedSchema } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";
const schema = (value: z.ZodType) => z.toJSONSchema(value, { unrepresentable: "any" });
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
