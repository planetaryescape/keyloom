// When to say keyloom stopped answering (D-494). The events stream drops for a moment on every reconnect, so the banner waits about
// three seconds of silence, and only after the page has been connected once: a server that never had the sync side says nothing.

export const SERVER_GONE_AFTER_MS = 3000;

export type Connection = { everLive: boolean; downSince: number | null };

export const initialConnection: Connection = { everLive: false, downSince: null };

/** The next state when `live` is read at `now`. */
export function nextConnection(prev: Connection, live: boolean, now: number): Connection {
  if (live) return prev.everLive && prev.downSince === null ? prev : { everLive: true, downSince: null };
  if (!prev.everLive || prev.downSince !== null) return prev;
  return { everLive: true, downSince: now };
}

export function serverGone(c: Connection, now: number): boolean {
  return c.downSince !== null && now - c.downSince >= SERVER_GONE_AFTER_MS;
}

/**
 * Whether this page runs inside the keyloom desktop app, whose webview carries Tauri's internals. When it can't tell, the page says
 * what to do in both places.
 */
export function inDesktopApp(w: object = globalThis): boolean {
  return "__TAURI_INTERNALS__" in w;
}

/** What to do when keyloom is closed, for the banner and the token pages (D-494, R1-22). */
export function restartAdvice(desktop: boolean): { app: string; terminal: string | null } {
  return desktop
    ? { app: "Quit keyloom and open it again.", terminal: null }
    : { app: "In the keyloom app, quit it and open it again.", terminal: "In a terminal, run this again:" };
}
