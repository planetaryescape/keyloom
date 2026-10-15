import type { App } from "../../app/index.ts";
import type { Format, Io } from "../output.ts";

/** What a command module needs from main.ts, which owns the global flags and the database. */
export type CliContext = {
  io: Io;
  format: () => Format;
  withApp: <T>(fn: (app: App) => Promise<T> | T) => Promise<T>;
};
