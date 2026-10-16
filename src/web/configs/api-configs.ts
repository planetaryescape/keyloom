// The configs and versions calls (src/api/configs.ts, rung 23): the config switcher, History's versions, and compare.
import {
  CompareResponseSchema, ConfigListResponseSchema, ConfigResponseSchema, NameVersionResponseSchema, RestoreVersionResponseSchema,
  VersionHistoryResponseSchema, type ApiConfig, type CompareResponse, type NewConfigRequest, type VersionHistoryResponse,
} from "../../api/configs.ts";
import { SyncNowResponseSchema, type SyncNowResponse } from "../../api/http.ts";
import { request } from "../api-write.ts";

const at = (ref: string) => `/api/configs/${encodeURIComponent(ref)}`;

export const fetchConfigs = async (token: string, board: string, opts: { archived?: boolean; signal?: AbortSignal } = {}): Promise<ApiConfig[]> =>
  (await request("GET", `/api/configs?board=${encodeURIComponent(board)}${opts.archived === true ? "&archived=1" : ""}`, token, ConfigListResponseSchema, opts.signal)).configs;
export const createConfig = async (token: string, body: NewConfigRequest): Promise<ApiConfig> =>
  (await request("POST", "/api/configs", token, ConfigResponseSchema, undefined, body)).config;
export const renameConfig = async (token: string, ref: string, name: string): Promise<ApiConfig> =>
  (await request("POST", `${at(ref)}/rename`, token, ConfigResponseSchema, undefined, { name })).config;
export const archiveConfig = async (token: string, ref: string): Promise<ApiConfig> => (await request("POST", `${at(ref)}/archive`, token, ConfigResponseSchema, undefined, {})).config;
export const restoreConfig = async (token: string, ref: string): Promise<ApiConfig> => (await request("POST", `${at(ref)}/restore`, token, ConfigResponseSchema, undefined, {})).config;
/** Makes the config the one on its board's keyboard and starts one sync. */
export const useConfig = (token: string, ref: string): Promise<SyncNowResponse> => request("POST", `${at(ref)}/use`, token, SyncNowResponseSchema, undefined, {});

export const fetchVersions = (token: string, ref: string, signal?: AbortSignal): Promise<VersionHistoryResponse> => request("GET", `${at(ref)}/versions`, token, VersionHistoryResponseSchema, signal);
export const nameVersion = async (token: string, ref: string, target: string, name: string) =>
  (await request("POST", `${at(ref)}/versions/name`, token, NameVersionResponseSchema, undefined, { target, name })).version;
export const restoreVersion = (token: string, ref: string, target: string) => request("POST", `${at(ref)}/versions/restore`, token, RestoreVersionResponseSchema, undefined, { target });
export const compareVersion = (token: string, ref: string, target: string, signal?: AbortSignal): Promise<CompareResponse> =>
  request("GET", `${at(ref)}/compare?to=${encodeURIComponent(target)}`, token, CompareResponseSchema, signal);

/** One sync of the config on the keyboard, with its failure thrown, where the sync line's own Sync now only reports it. */
export const syncConfig = (token: string, layoutId: string): Promise<SyncNowResponse> => request("POST", "/api/sync", token, SyncNowResponseSchema, undefined, { layoutId });
