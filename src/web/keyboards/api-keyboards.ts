// The new-keyboard calls (src/api/keyboards.ts, D-336), and the config page's open proposals (src/api/configs.ts).
import { ProposalsResponseSchema } from "../../api/configs.ts";
import {
  AddResponseSchema, DetectResponseSchema, PreviewResponseSchema, PutPreviewResponseSchema, PutResponseSchema, type AddRequest, type AddResponse, type DetectResponse,
  type PreviewRequest, type PreviewResponse, type PutPreviewResponse, type PutRequest, type PutResponse,
} from "../../api/keyboards.ts";
import type { ProposalCard } from "../../api/http.ts";
import { request } from "../api-write.ts";

export const searchKeyboards = (token: string, text: string, signal?: AbortSignal): Promise<DetectResponse> =>
  request("GET", `/api/keyboards/detect?search=${encodeURIComponent(text)}`, token, DetectResponseSchema, signal);
export const previewKeyboard = (token: string, body: PreviewRequest, signal?: AbortSignal): Promise<PreviewResponse> =>
  request("POST", "/api/keyboards/preview", token, PreviewResponseSchema, signal, body);
export const addKeyboard = (token: string, body: AddRequest): Promise<AddResponse> => request("POST", "/api/keyboards/add", token, AddResponseSchema, undefined, body);
export const previewPut = (token: string, body: PutRequest, signal?: AbortSignal): Promise<PutPreviewResponse> =>
  request("POST", "/api/keyboards/put/preview", token, PutPreviewResponseSchema, signal, body);
export const putConfig = (token: string, body: PutRequest): Promise<PutResponse> => request("POST", "/api/keyboards/put", token, PutResponseSchema, undefined, body);
export const fetchOpenProposals = async (token: string, ref: string, signal?: AbortSignal): Promise<ProposalCard[]> =>
  (await request("GET", `/api/configs/${encodeURIComponent(ref)}/proposals`, token, ProposalsResponseSchema, signal)).proposals;
