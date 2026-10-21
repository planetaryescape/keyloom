// Regenerate the candidate HID supplement; diagnostics-v1 remains independently frozen.
import { z } from "zod";
import { operationSchema, transportResponseSchema, transportEventSchema, transportIdentitySchema, hidDevicesSchema, writtenSchema, closedSchema } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";
const schema = (value: z.ZodType) => z.toJSONSchema(value, { unrepresentable: "any" });
const contract = {
  ...schema(z.union([operationSchema, transportResponseSchema, transportEventSchema])),
  $defs: { identity: schema(transportIdentitySchema), devices: schema(hidDevicesSchema), written: schema(writtenSchema), closed: schema(closedSchema) },
  "x-maxFrameBytes": 65_536, "x-maxSessions": 8, "x-maxPending": 32, "x-maxDataEvents": 1024,
};
await Bun.write(new URL("../native/device-helper/protocol/transport-v1.schema.json", import.meta.url), `${JSON.stringify(contract, null, 2)}\n`);
