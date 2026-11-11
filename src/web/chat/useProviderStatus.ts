import { useCallback, useEffect, useState } from "react";
import type { ChatProviderStatus } from "../../api/http.ts";
import { fetchProviderStatus } from "./api-chat.ts";

/** How often the page asks whether `codex login` has finished. */
const SIGN_IN_POLL_MS = 1_500;

/** Which provider the next conversation uses. The line it feeds is context, so a failed fetch just leaves it out. */
export function useProviderStatus(token: string) {
  const [status, setStatus] = useState<ChatProviderStatus | null>(null);

  const reload = useCallback(() => {
    const controller = new AbortController();
    fetchProviderStatus(token, controller.signal).then(setStatus, () => {});
    return () => controller.abort();
  }, [token]);

  useEffect(() => reload(), [reload]);

  // While `codex login` waits on the browser, ask again until it ends (D-496). Each ask waits for the last answer, so a slow
  // `codex login status` on the server never piles up.
  const waiting = status?.codexSignIn.state === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    let timer = 0;
    const ask = () => {
      timer = window.setTimeout(() => {
        fetchProviderStatus(token, controller.signal).then(setStatus, () => {}).finally(() => {
          if (!controller.signal.aborted) ask();
        });
      }, SIGN_IN_POLL_MS);
    };
    ask();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [waiting, token]);

  return { status, reload, replace: setStatus };
}
