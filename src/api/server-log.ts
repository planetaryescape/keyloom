import { z } from "zod";

// Where keyloom's log is, so "The details are in keyloom's log." comes with a way to read it (R8-09, D-541).
//   GET  /api/log      -> ServerLog
//   POST /api/log/show -> LogShown; 409 `log_in_terminal` when keyloom writes to a terminal, `log_unsupported` off macOS,
//                          500 `log_open_failed` when macOS couldn't open it
export const LOG_PATH = "/api/log";
export const SHOW_LOG_PATH = "/api/log/show";

export const ServerLogSchema = z.discriminatedUnion("kind", [
  /** The desktop app started keyloom and writes its output to this file. `canShow`: keyloom can open it (macOS). */
  z.object({ kind: z.literal("file"), path: z.string().min(1), canShow: z.boolean() }),
  /** keyloom runs in a terminal, which shows its output as it happens. */
  z.object({ kind: z.literal("terminal") }),
]);
export type ServerLog = z.infer<typeof ServerLogSchema>;

export const LogShownSchema = z.object({ shown: z.literal(true) });
export type LogShown = z.infer<typeof LogShownSchema>;
