import { useCallback, useEffect, useState } from "react";
import type { ChatProviderStatus } from "../../api/http.ts";
import { fetchProviderStatus } from "./api-chat.ts";

/** Which provider the next conversation uses. The line it feeds is context, so a failed fetch just leaves it out. */
export function useProviderStatus(token: string) {
  const [status, setStatus] = useState<ChatProviderStatus | null>(null);

  const reload = useCallback(() => {
    const controller = new AbortController();
    fetchProviderStatus(token, controller.signal).then(setStatus, () => {});
    return () => controller.abort();
  }, [token]);

  useEffect(() => reload(), [reload]);
  return { status, reload, replace: setStatus };
}
