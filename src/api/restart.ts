import { z } from "zod";

// Restarting keyloom from the page (R5-15, D-521). Only a server the desktop app started can restart itself: it exits with
// RESTART_EXIT_CODE and the app's shell starts it again at once, through the path it already uses for a server that stopped. A server
// started in a terminal has nobody to start it again, so the page shows the line to run there instead.
//   GET  /api/restart -> RestartInfo
//   POST /api/restart -> RestartStarted (202); 409 `restart_unsupervised` when no desktop app would start it again
export const RESTART_PATH = "/api/restart";

/** `serve`'s exit code when the page or the menu bar asked for a restart. The desktop shell (lib.rs) restarts it without counting a stop. */
export const RESTART_EXIT_CODE = 11;

export const RestartInfoSchema = z.object({
  /** True when the desktop app started this server and starts it again when it exits. */
  canRestart: z.boolean(),
  /** The line that starts this server again in a terminal, after stopping the one that runs. */
  command: z.string().min(1),
});
export type RestartInfo = z.infer<typeof RestartInfoSchema>;

export const RestartStartedSchema = z.object({ restarting: z.literal(true) });
export type RestartStarted = z.infer<typeof RestartStartedSchema>;
