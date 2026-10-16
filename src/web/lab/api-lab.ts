// The typing lab's calls (src/api/lab.ts).
import { z } from "zod";
import {
  LabPassagesResponseSchema, LabReadoutResponseSchema, LabSessionResponseSchema, LabSessionsResponseSchema, RecordingResponseSchema, type LabPassagesResponse,
  type LabReadoutResponse, type LabSession, type StartRecordingRequest,
} from "../../api/lab.ts";
import { request } from "../api-write.ts";

const Empty = z.object({});
const at = (ref: string) => `/api/lab/${encodeURIComponent(ref)}`;

export const fetchPassages = (token: string, ref: string, signal?: AbortSignal): Promise<LabPassagesResponse> => request("GET", `${at(ref)}/passages`, token, LabPassagesResponseSchema, signal);
export const fetchSessions = async (token: string, ref: string, signal?: AbortSignal): Promise<LabSession[]> =>
  (await request("GET", `${at(ref)}/sessions`, token, LabSessionsResponseSchema, signal)).sessions;
export const startRecording = (token: string, ref: string, body: StartRecordingRequest) => request("POST", `${at(ref)}/recording`, token, RecordingResponseSchema, undefined, body);
export const stopRecording = async (token: string, typedText: string): Promise<LabSession> =>
  (await request("POST", "/api/lab/recording/stop", token, LabSessionResponseSchema, undefined, { typedText })).session;
export const cancelRecording = (token: string) => request("POST", "/api/lab/recording/cancel", token, Empty, undefined, {});
export const fetchReadout = (token: string, id: string): Promise<LabReadoutResponse> => request("GET", `/api/lab/sessions/${encodeURIComponent(id)}`, token, LabReadoutResponseSchema);
export const analyse = (token: string, id: string): Promise<LabReadoutResponse> =>
  request("POST", `/api/lab/sessions/${encodeURIComponent(id)}/analyse`, token, LabReadoutResponseSchema, undefined, {});
export const deleteSession = (token: string, id: string) => request("POST", `/api/lab/sessions/${encodeURIComponent(id)}/delete`, token, Empty, undefined, {});
