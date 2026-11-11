// Restarting keyloom from the page (src/api/restart.ts, R5-15).
import { RESTART_PATH, RestartInfoSchema, RestartStartedSchema, type RestartInfo, type RestartStarted } from "../../api/restart.ts";
import { request } from "../api-write.ts";

export const fetchRestartInfo = (token: string, signal?: AbortSignal): Promise<RestartInfo> => request("GET", RESTART_PATH, token, RestartInfoSchema, signal);
export const restartKeyloom = (token: string): Promise<RestartStarted> => request("POST", RESTART_PATH, token, RestartStartedSchema, undefined, {});
