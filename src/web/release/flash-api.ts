// The browser side of D-501 and D-502's routes: cancel a waiting flash, check the keyboard again, open a System Settings pane, and
// find the revision a layout that no longer fits its board can go back to.
import { BuildSchema, FittingRevisionResponseSchema, FlashCheckResponseSchema, FlashSchema, type Build, type FittingRevisionResponse, type Flash, type FlashCheckResponse } from "../../api/http.ts";
import { SetupActionResponseSchema, type SettingsPaneName, type SetupActionResponse } from "../../api/system-remapper.ts";
import { request } from "../api-write.ts";

export function cancelFlash(token: string, id: string): Promise<Flash> {
  return request("POST", `/api/flashes/${encodeURIComponent(id)}/cancel`, token, FlashSchema, undefined, {});
}

/** Asks a running build to stop (R3-10); answers at once, and the poll sees it end. A build never flashes. */
export function cancelBuild(token: string, id: string): Promise<Build> {
  return request("POST", `/api/builds/${encodeURIComponent(id)}/cancel`, token, BuildSchema, undefined, {});
}

export function checkFlash(token: string, id: string): Promise<FlashCheckResponse> {
  return request("POST", `/api/flashes/${encodeURIComponent(id)}/check`, token, FlashCheckResponseSchema, undefined, {});
}

export function openSettings(token: string, pane: SettingsPaneName): Promise<SetupActionResponse> {
  return request("POST", "/api/system/open-settings", token, SetupActionResponseSchema, undefined, { pane });
}

export function fetchFittingRevision(token: string, ref: string, signal: AbortSignal): Promise<FittingRevisionResponse["revision"]> {
  return request("GET", `/api/layouts/${encodeURIComponent(ref)}/fitting-revision`, token, FittingRevisionResponseSchema, signal).then((r) => r.revision);
}
