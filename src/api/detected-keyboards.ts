// A keyboard on USB that keyloom has no board for, with what it could be (22, D-336). Its own file, because the sync event stream carries
// these too (src/api/http.ts), and the rest of the keyboards API depends on the configs API, which depends on http.ts.
import { z } from "zod";

export const CandidateSchema = z.object({
  id: z.string().min(1),
  firmware: z.enum(["qmk", "zmk"]),
  name: z.string().min(1),
  vendor: z.string(),
  confidence: z.number(),
  reasons: z.array(z.string()),
  detail: z.string(),
  // "Corne (new)" when a board keyloom has is already called that (D-336).
  displayName: z.string(),
});
export type ApiCandidate = z.infer<typeof CandidateSchema>;

export const DetectedKeyboardSchema = z.object({
  device: z.object({
    vendorId: z.string(), productId: z.string(), product: z.string(), maker: z.string(), bcdDevice: z.string().nullable(), serial: z.string().nullable(),
  }),
  status: z.enum(["known", "candidates", "unknown"]),
  knownBoard: z.object({ id: z.string(), name: z.string() }).nullable(),
  candidates: z.array(CandidateSchema),
  ambiguous: z.boolean(),
  next: z.string(),
});
export type DetectedKeyboard = z.infer<typeof DetectedKeyboardSchema>;

