// The board review's calls (src/api/review.ts, D-340).
import { ReviewResponseSchema, type ReviewActivity, type ReviewResponse } from "../../api/review.ts";
import { request } from "../api-write.ts";

const at = (ref: string) => `/api/layouts/${encodeURIComponent(ref)}/review`;

export const fetchReview = (token: string, ref: string, signal?: AbortSignal): Promise<ReviewResponse> => request("GET", at(ref), token, ReviewResponseSchema, signal);
export const runReview = (token: string, ref: string, force = false, activities?: ReviewActivity[]): Promise<ReviewResponse> =>
  request("POST", `${at(ref)}/run`, token, ReviewResponseSchema, undefined, { ...(force ? { force: true } : {}), ...(activities === undefined ? {} : { activities }) });
export const dismissItem = (token: string, ref: string, id: string): Promise<ReviewResponse> =>
  request("POST", `${at(ref)}/items/${encodeURIComponent(id)}/dismiss`, token, ReviewResponseSchema, undefined, {});
export const restoreItem = (token: string, ref: string, id: string): Promise<ReviewResponse> =>
  request("POST", `${at(ref)}/items/${encodeURIComponent(id)}/restore`, token, ReviewResponseSchema, undefined, {});
