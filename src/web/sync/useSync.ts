import { useCallback, useEffect, useRef, useState } from "react";
import { SyncNowResponseSchema, SyncStatusResponseSchema, type BoardSync, type LayoutUpdatedEvent } from "../../api/http.ts";
import { ApiError } from "../api.ts";
import { request } from "../api-write.ts";
import type { DetectedKeyboard } from "../../api/detected-keyboards.ts";
import type { ReviewEvent } from "../../api/review.ts";
import { createEventParser } from "./events.ts";
import { retryWhileBusy } from "./busy-retry.ts";
import { RemapperSetupResponseSchema, SetupActionResponseSchema, type KanataInstallAction, type RemapperSetupResponse, type SettingsPaneName, type SetupActionResponse } from "../../api/system-remapper.ts";

export interface SyncApi {
  boards: readonly BoardSync[];
  /** Keyboards on USB keyloom has no board for, from the engine's reads (D-336). */
  newKeyboards: readonly DetectedKeyboard[];
  /** Known boards on USB with no config yet, so the page can offer to put one on (D-336). */
  setupBoards: readonly DetectedKeyboard[];
  /** The last board review frame (D-340): a review was made or its agent part moved; the page reads that config's review again. */
  lastReview: ReviewEvent | null;
  /** The last layout.updated event received from the server (e.g. CLI write). */
  lastLayoutUpdated: LayoutUpdatedEvent | null;
  /** False until the first state arrives, and while the stream is being reopened. */
  live: boolean;
  /** The server answered the stream with 401: it restarted with another token, and this page can't reconnect (D-494). */
  tokenRejected: boolean;
  /** Why the last action failed, until the next one starts. `code` is the server's (R1-16), which the toast turns into an action. */
  error: { message: string; code: string | undefined } | null;
  syncNow: (layoutId: string) => Promise<void>;
  setAuto: (boardId: string, enabled: boolean) => Promise<void>;
  setPaused: (boardId: string, paused: boolean) => Promise<void>;
  /** "Disable remapping" on a software-remapper board: the identity map, no sudo. */
  disableRemapping: (boardId: string) => Promise<void>;
  /**
   * "Replace it" on a kanata config keyloom didn't write; keyloom keeps a copy (R1-17). Rejects, so its confirm can say why, unless the
   * confirm went stale (kanata no longer runs that config): then it resolves, the confirm closes, and `error` carries the code for the toast.
   */
  replaceForeign: (layoutId: string) => Promise<void>;
  /** The person held kanata's exit chord and saw it stop (R1-18). */
  confirmExitChord: (boardId: string) => Promise<void>;
  /** The layout whose "Replace it" confirm is open, from the pill or a toast; null when none is. */
  replaceAsk: string | null;
  setReplaceAsk: (layoutId: string | null) => void;
  /** Setting kanata up from the popover (D-493) and opening System Settings at a pane (D-492). */
  remapperSetup: {
    status: (boardId: string) => Promise<RemapperSetupResponse>;
    /** Starts `brew install kanata`, `brew upgrade kanata` for Update kanata, or `brew reinstall kanata`; `status` follows it. */
    installKanata: (action?: KanataInstallAction) => Promise<SetupActionResponse>;
    cancelInstall: () => Promise<SetupActionResponse>;
    startKanata: (boardId: string) => Promise<SetupActionResponse>;
    openSettings: (pane: SettingsPaneName) => Promise<SetupActionResponse>;
  };
}

const RETRY_MIN_MS = 1000;
const STALE_REPLACE: ReadonlySet<string> = new Set(["kanata_not_foreign", "kanata_not_running", "keyboard_removed"]);
const RETRY_MAX_MS = 10_000;

const asSyncError = (e: unknown): NonNullable<SyncApi["error"]> => ({ message: e instanceof Error ? e.message : "keyloom couldn't do that.", code: e instanceof ApiError ? e.code : undefined });

// Follows /api/events with fetch, because EventSource can't send the session token. A stream that ends is reopened with a growing
// pause; the first frame of each is a whole snapshot, so nothing missed meanwhile matters.
export function useSync(token: string): SyncApi {
  const [boards, setBoards] = useState<readonly BoardSync[]>([]);
  const [newKeyboards, setNewKeyboards] = useState<readonly DetectedKeyboard[]>([]);
  const [setupBoards, setSetupBoards] = useState<readonly DetectedKeyboard[]>([]);
  const [lastReview, setLastReview] = useState<ReviewEvent | null>(null);
  const [lastLayoutUpdated, setLastLayoutUpdated] = useState<LayoutUpdatedEvent | null>(null);
  const [live, setLive] = useState(false);
  const [tokenRejected, setTokenRejected] = useState(false);
  const [error, setError] = useState<SyncApi["error"]>(null);
  const [replaceAsk, setReplaceAsk] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let delay = RETRY_MIN_MS;
    const open = async () => {
      try {
        const response = await fetch("/api/events", { headers: { "x-keyloom-token": token }, signal: controller.signal });
        // Without the sync side (a server started without it) there is nothing to follow, and asking again will not change that.
        if (response.status === 401) {
          setLive(false);
          setTokenRejected(true);
          return;
        }
        if (response.status === 404 || response.body === null) return;
        if (!response.ok) throw new Error(String(response.status));
        const decoder = new TextDecoder();
        const parser = createEventParser((next, keyboards, setup) => {
          delay = RETRY_MIN_MS;
          setLive(true);
          setBoards(next);
          // A new array each frame; keep the old one while nothing changed, so the card doesn't reset under a choice being made.
          setNewKeyboards((old) => (JSON.stringify(old) === JSON.stringify(keyboards) ? old : keyboards));
          setSetupBoards((old) => (JSON.stringify(old) === JSON.stringify(setup) ? old : setup));
        }, () => setLive(false), (event) => setLastReview(event), (event) => setLastLayoutUpdated(event));
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
  // The Sync now that is waiting for a running build or flash to end (R3-18). A new Sync now, or leaving the page, stops it.
  const waiting = useRef<AbortController | null>(null);
  useEffect(() => () => waiting.current?.abort(), []);
  const syncNow = useCallback(async (layoutId: string) => {
    waiting.current?.abort();
    const controller = new AbortController();
    waiting.current = controller;
    setError(null);
    try {
      const answer = await retryWhileBusy(() => request("POST", "/api/sync", token, SyncNowResponseSchema, undefined, { layoutId }), {
        signal: controller.signal,
        onBusy: (e) => setError({ message: e.message, code: "busy_waiting" }),
      });
      if (answer !== undefined && !liveRef.current) setBoards(answer.boards);
    } catch (e) {
      if (!controller.signal.aborted) setError(asSyncError(e));
    } finally {
      if (waiting.current === controller) waiting.current = null;
    }
  }, [token]);
  const act = useCallback(async (run: () => Promise<readonly BoardSync[]>) => {
    setError(null);
    try {
      const next = await run();
      if (!liveRef.current) setBoards(next);
    } catch (e) {
      setError(asSyncError(e));
    }
  }, []);

  return {
    boards, newKeyboards, setupBoards, lastReview, lastLayoutUpdated, live, tokenRejected, error, replaceAsk, setReplaceAsk,
    syncNow,
    setAuto: (boardId, enabled) => act(async () => (await request("POST", "/api/sync/auto", token, SyncStatusResponseSchema, undefined, { boardId, enabled })).boards),
    disableRemapping: (boardId) => act(async () => (await request("POST", "/api/sync/disable-remapping", token, SyncStatusResponseSchema, undefined, { boardId })).boards),
    remapperSetup: {
      status: (boardId) => request("GET", `/api/system/remapper?board=${encodeURIComponent(boardId)}`, token, RemapperSetupResponseSchema),
      installKanata: (action = "install") => request("POST", "/api/system/remapper/install-kanata", token, SetupActionResponseSchema, undefined, { action }),
      cancelInstall: () => request("POST", "/api/system/remapper/install-kanata/cancel", token, SetupActionResponseSchema, undefined, {}),
      startKanata: (boardId) => request("POST", "/api/system/remapper/start", token, SetupActionResponseSchema, undefined, { boardId }),
      openSettings: (pane) => request("POST", "/api/system/open-settings", token, SetupActionResponseSchema, undefined, { pane }),
    },
    replaceForeign: async (layoutId) => {
      setError(null);
      try {
        const next = (await request("POST", "/api/sync/replace-foreign", token, SyncStatusResponseSchema, undefined, { layoutId })).boards;
        if (!liveRef.current) setBoards(next);
      } catch (e) {
        // The confirm is stale when kanata no longer runs that config: pressing Replace it again can't succeed, so the confirm closes
        // and the toast says what changed. Anything else stays in the confirm, where Replace it can be tried again.
        if (e instanceof ApiError && e.code !== undefined && STALE_REPLACE.has(e.code)) setError({ message: e.message, code: e.code });
        else throw e;
      }
    },
    confirmExitChord: (boardId) => act(async () => (await request("POST", "/api/sync/confirm-exit-chord", token, SyncStatusResponseSchema, undefined, { boardId })).boards),
    setPaused: (boardId, paused) => act(async () => (await request("POST", "/api/sync/pause", token, SyncStatusResponseSchema, undefined, { boardId, paused })).boards),
  };
}
