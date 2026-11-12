import { useCallback, useEffect, useState } from "react";
import type { ChatProviderStatus } from "../../api/http.ts";
import { fetchProviderStatus } from "./api-chat.ts";

/** How often the page asks whether `codex login` has finished. */
const SIGN_IN_POLL_MS = 1_500;

const SHARED = "keyloom:provider-status";

/**
 * Tells every other reader on the page about a status one of them changed. Chat and the review each read the status, and both write the
 * same provider choice, so a switch in one shows in the other without a reload (R6-01 review).
 */
export function shareProviderStatus(next: ChatProviderStatus, target: EventTarget = window): void {
  target.dispatchEvent(new CustomEvent<ChatProviderStatus>(SHARED, { detail: next }));
}

/** Calls `on` with each status shared on the page; returns the unsubscribe. */
export function onSharedProviderStatus(on: (next: ChatProviderStatus) => void, target: EventTarget = window): () => void {
  const listener = (event: Event) => on((event as CustomEvent<ChatProviderStatus>).detail);
  target.addEventListener(SHARED, listener);
  return () => target.removeEventListener(SHARED, listener);
}

/** Which provider the next conversation uses. Chat's line is context, so a failed read just leaves it out there; the review says so (R7-05). */
export function useProviderStatus(token: string) {
  const [status, setStatus] = useState<ChatProviderStatus | null>(null);
  // Whether the last read failed, so a screen that needs the status (the review's switch after a usage limit) says so with Check again
  // instead of waiting for it in silence (R7-05). It stays set while Check again reads, so the words don't flicker; `reading` shows that.
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState(true);
  const settle = useCallback((next: ChatProviderStatus) => {
    setStatus(next);
    setFailed(false);
  }, []);
  // A status another reader saved (a switch, a key, a sign-in) is the page's status too.
  useEffect(() => onSharedProviderStatus(settle), [settle]);
  const replace = useCallback((next: ChatProviderStatus) => {
    settle(next);
    shareProviderStatus(next);
  }, [settle]);

  const reload = useCallback(() => {
    const controller = new AbortController();
    setReading(true);
    fetchProviderStatus(token, controller.signal).then(settle, () => {
      if (!controller.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setReading(false);
    });
    return () => controller.abort();
  }, [token, settle]);

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

  return { status, failed, reading, reload, replace };
}
