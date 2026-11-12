import { z } from "zod";

// The computer keyloom is running on. Firmware is built in Docker, and the person should never have to work
// out that a closed Docker Desktop is why a build stopped, so this asks and starts it (D-486, D-487).
//   GET  /api/system/docker           -> DockerReadinessResponse
//   POST /api/system/docker/start     -> DockerStartResponse   (starts the engine and waits, up to about two minutes; for
//                                       `cli-missing` it opens the app named in `engine`, whose setup puts its CLI in place)
//   POST /api/system/docker/restart   -> DockerStartResponse   (quits and reopens the Mac app named in `access.restartApp`, or stops
//                                       and starts the Colima named in `restartEngine`; refused while keyloom is starting Docker)
//                                       Body `{}`, or `{ "force": true }` to restart an engine that answers, for a build that failed with
//                                       `stale_mount` or `stuck_container` (R6-09); that is refused with `build_running` while a build or
//                                       flash runs, because the restart would stop it.
// `no-access`: the daemon runs but refuses this account its socket; `access` then says the way out (D-497).
export const DockerProblemSchema = z.enum(["not-installed", "cli-missing", "daemon-down", "slow", "no-access"]);
export type DockerProblem = z.infer<typeof DockerProblemSchema>;

// What to install where there is no Docker: a command when one is known here, and the page to read otherwise.
// `canInstall` is true where keyloom can run the install itself (Homebrew on a Mac, D-488); `alternatives` are other engines to link.
export const DockerInstallSchema = z.object({
  engine: z.string().min(1),
  command: z.string().min(1).nullable(),
  url: z.string().min(1),
  note: z.string(),
  canInstall: z.boolean(),
  alternatives: z.array(z.object({ name: z.string().min(1), url: z.string().min(1) })),
});
export type DockerInstall = z.infer<typeof DockerInstallSchema>;

export const DockerReadinessResponseSchema = z.discriminatedUnion("ok", [
  // `engine` is what runs the daemon here, such as "Docker Desktop"; `autoStart` is whether keyloom may start it itself.
  z.object({ ok: z.literal(true), version: z.string().min(1), engine: z.string().min(1), autoStart: z.boolean() }),
  z.object({
    ok: z.literal(false), problem: DockerProblemSchema, reason: z.string().min(1),
    // The engine keyloom would start, or null when it found none it knows how to start.
    engine: z.string().nullable(),
    // Whether a start from keyloom could help, given the engine it found and the person's setting.
    canStart: z.boolean(),
    autoStart: z.boolean(),
    // What to install, when there is no Docker at all; null otherwise.
    install: DockerInstallSchema.nullable(),
    // How to get this account access when the problem is `no-access`: a command to copy (Linux) or null, and a note; null otherwise.
    // `restartApp` is the Mac app keyloom can quit and reopen to give the socket back (R2-07), or null.
    access: z.object({ command: z.string().min(1).nullable(), note: z.string().min(1), restartApp: z.string().min(1).nullable() }).nullable(),
    // The engine keyloom can stop and start from scratch (POST /api/system/docker/restart) when a start fails: Colima (R3-04). Optional
    // so an older server's answer still reads.
    restartEngine: z.string().min(1).nullable().optional(),
    // Engines to install instead of a `restartEngine` that won't start, even after a restart (R4-04b). Optional for older servers.
    alternatives: z.array(z.object({ name: z.string().min(1), url: z.string().min(1) })).optional(),
    // keyloom is starting or restarting the engine now, for a page or a build (R4-04). Optional for older servers.
    engineAction: z.enum(["start", "restart"]).nullable().optional(),
  }),
]);
export type DockerReadinessResponse = z.infer<typeof DockerReadinessResponseSchema>;

export const DockerStartResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), version: z.string().min(1), engine: z.string().min(1), waitedMs: z.number().finite() }),
  // A start that fails is not a bad request; the sentence is what the person reads, so it comes back as data.
  // `engine_busy`: refused because keyloom is already starting or restarting the engine (R4-04); the page follows that one instead.
  // `build_running`: a forced restart refused because a build or flash runs, which it would stop (R6-09); the page says so and waits.
  z.object({ ok: z.literal(false), reason: z.string().min(1), engine: z.string().nullable(), code: z.enum(["engine_busy", "build_running"]).optional() }),
]);

export const DockerRestartRequestSchema = z.union([
  z.object({}).strict(),
  z.object({ force: z.boolean() }).strict(),
]);
export type DockerStartResponse = z.infer<typeof DockerStartResponseSchema>;

// Karabiner-Elements' config, read from ~/.config/karabiner/karabiner.json for the MacBook's import card (R1-24). The page uploads
// it through POST /api/import like a dropped file.
//   GET  /api/system/karabiner-config   -> KarabinerConfigResponse   (404 karabiner_missing, 413 karabiner_too_large, 403 karabiner_denied,
//                                                                     422 karabiner_not_a_file, 404 karabiner_unavailable)
export const KarabinerConfigResponseSchema = z.object({ filename: z.string().min(1), content: z.string() });
export type KarabinerConfigResponse = z.infer<typeof KarabinerConfigResponseSchema>;
