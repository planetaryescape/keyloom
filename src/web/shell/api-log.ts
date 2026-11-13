// Where keyloom's log is, and opening it (src/api/server-log.ts, R8-09).
import { LOG_PATH, LogShownSchema, SHOW_LOG_PATH, ServerLogSchema, type LogShown, type ServerLog } from "../../api/server-log.ts";
import { request } from "../api-write.ts";

export const fetchServerLog = (token: string, signal?: AbortSignal): Promise<ServerLog> => request("GET", LOG_PATH, token, ServerLogSchema, signal);
export const showServerLog = (token: string): Promise<LogShown> => request("POST", SHOW_LOG_PATH, token, LogShownSchema, undefined, {});
