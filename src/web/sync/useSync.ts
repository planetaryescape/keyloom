import { useCallback, useEffect, useRef, useState } from "react";
import { SyncNowResponseSchema, SyncStatusResponseSchema, type BoardSync } from "../../api/http.ts";
import { request } from "../api-write.ts";
import type { DetectedKeyboard } from "../../api/detected-keyboards.ts";
import { createEventParser } from "./events.ts";

export interface SyncApi {
  boards: readonly BoardSync[];
  /** Keyboards on USB keyloom has no board for, from the engine's reads (D-336). */
  newKeyboards: readonly DetectedKeyboard[];
  /** False until the first state arrives, and while the stream is being reopened. */
  live: boolean;
  /** Why the last action failed, until the next one starts. */
  error: string | null;
  syncNow: (layoutId: string) => Promise<void>;
  setAuto: (boardId: string, enabled: boolean) => Promise<void>;
  setPaused: (boardId: string, paused: boolean) => Promise<void>;
  /** "Disable remapping" on a software-remapper board: the identity map, no sudo. */
  disableRemapping: (boardId: string) => Promise<void>;
}

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10_000;

// Follows /api/events with fetch, because EventSource can't send the session token. A stream that ends is reopened with a growing
// pause; the first frame of each is a whole snapshot, so nothing missed meanwhile matters.
export function useSync(token: string): SyncApi {
  const [boards, setBoards] = useState<readonly BoardSync[]>([]);
  const [newKeyboards, setNewKeyboards] = useState<readonly DetectedKeyboard[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let delay = RETRY_MIN_MS;
    const open = async () => {
      try {
        const response = await fetch("/api/events", { headers: { "x-keyloom-token": token }, signal: controller.signal });
        // Without the sync side (a server started without it) there is nothing to follow, and asking again will not change that.
        if (response.status === 404 || response.status === 401 || response.body === null) return;
        if (!response.ok) throw new Error(String(response.status));
        const decoder = new TextDecoder();
        const parser = createEventParser((next, keyboards) => {
          delay = RETRY_MIN_MS;
          setLive(true);
          setBoards(next);
          // A new array each frame; keep the old one while nothing changed, so the card doesn't reset under a choice being made.
          setNewKeyboards((old) => (JSON.stringify(old) === JSON.stringify(keyboards) ? old : keyboards));
        }, () => setLive(false));
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (controller.signal.aborted) return;
      setLive(false);
      timer = window.setTimeout(open, delay);
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    };
    void open();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [token]);

  // The stream carries every change an action makes, in order, so its answer is used only when there is no stream: an answer that arrives
  // after a newer frame would otherwise put an old state back on screen.
  const liveRef = useRef(false);
  liveRef.current = live;
  const act = useCallback(async (run: () => Promise<readonly BoardSync[]>) => {
    setError(null);
    try {
      const next = await run();
      if (!liveRef.current) setBoards(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "keyloom couldn't do that.");
    }
  }, []);

  return {
    boards, newKeyboards, live, error,
    syncNow: (layoutId) => act(async () => (await request("POST", "/api/sync", token, SyncNowResponseSchema, undefined, { layoutId })).boards),
    setAuto: (boardId, enabled) => act(async () => (await request("POST", "/api/sync/auto", token, SyncStatusResponseSchema, undefined, { boardId, enabled })).boards),
    disableRemapping: (boardId) => act(async () => (await request("POST", "/api/sync/disable-remapping", token, SyncStatusResponseSchema, undefined, { boardId })).boards),
    setPaused: (boardId, paused) => act(async () => (await request("POST", "/api/sync/pause", token, SyncStatusResponseSchema, undefined, { boardId, paused })).boards),
  };
}
