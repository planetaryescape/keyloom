import { z } from "zod";

// Installing what a build or flash needs, from a button (D-488, D-489). An install takes minutes, so the POST starts it
// and returns at once, and the page polls the GET until it is no longer running.
//   POST /api/system/install   { tool }   -> InstallState   (joins an install of that tool already running)
//   GET  /api/system/install?tool=<tool> -> InstallState
//   DELETE /api/system/install?tool=<tool> -> InstallState  (stops a running install: `phase` is "stopping" until it has, then
//                                          `status` is "cancelled"; an install that isn't running comes back as it is)
export const InstallableToolSchema = z.enum(["docker", "zapp", "dfu-util", "dfu-programmer", "avrdude"]);
export type InstallableTool = z.infer<typeof InstallableToolSchema>;

export const InstallRequestSchema = z.object({ tool: InstallableToolSchema }).strict();

export const InstallStateSchema = z.object({
  tool: InstallableToolSchema,
  status: z.enum(["idle", "running", "succeeded", "failed", "cancelled"]),
  phase: z.enum(["installing", "starting", "stopping"]).nullable(),
  logTail: z.array(z.string()),
  error: z.string().nullable(),
  // `no_brew`: keyloom can't install here; `brew_failed`: Homebrew stopped; `start_failed`: Docker installed but didn't start.
  errorCode: z.enum(["no_brew", "brew_failed", "start_failed"]).nullable(),
});
export type InstallState = z.infer<typeof InstallStateSchema>;
