import { z } from "zod";

// The computer keyloom is running on. Firmware is built in Docker, and the person should never have to work
// out that a closed Docker Desktop is why a build stopped, so this asks and starts it (D-486).
//   GET  /api/system/docker           -> DockerReadinessResponse
//   POST /api/system/docker/start     -> DockerStartResponse   (starts the engine and waits, up to about two minutes)
export const DockerProblemSchema = z.enum(["not-installed", "daemon-down", "slow"]);
export type DockerProblem = z.infer<typeof DockerProblemSchema>;

export const DockerReadinessResponseSchema = z.discriminatedUnion("ok", [
  // `engine` is what runs the daemon here, such as "Docker Desktop"; `autoStart` is whether keyloom may start it itself.
  z.object({ ok: z.literal(true), version: z.string().min(1), engine: z.string().min(1), autoStart: z.boolean() }),
  z.object({
    ok: z.literal(false), problem: DockerProblemSchema, reason: z.string().min(1),
    // The engine keyloom would start, or null when it found none: a missing docker CLI needs an install.
    engine: z.string().nullable(),
    // Whether a start from keyloom could help, given the engine it found and the person's setting.
    canStart: z.boolean(),
    autoStart: z.boolean(),
  }),
]);
export type DockerReadinessResponse = z.infer<typeof DockerReadinessResponseSchema>;

export const DockerStartResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), version: z.string().min(1), engine: z.string().min(1), waitedMs: z.number().finite() }),
  // A start that fails is not a bad request; the sentence is what the person reads, so it comes back as data.
  z.object({ ok: z.literal(false), reason: z.string().min(1), engine: z.string().nullable() }),
]);
export type DockerStartResponse = z.infer<typeof DockerStartResponseSchema>;
