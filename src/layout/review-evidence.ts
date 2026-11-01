import { z } from "zod";

export const BehaviorEvidenceSchema = z.object({
  status: z.enum(["not-tested", "verified", "partial", "failed"]),
  checks: z.array(z.object({ name: z.string(), status: z.enum(["verified", "failed", "unsupported"]), reason: z.string().nullable() })),
  limitations: z.array(z.string()),
});
export type BehaviorEvidence = z.infer<typeof BehaviorEvidenceSchema>;
