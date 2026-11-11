// When the page says keyloom stopped answering (D-494): after about three seconds of a dropped stream, never on the first load, and
// gone the moment the stream is back.
import { describe, expect, test } from "bun:test";
import { SERVER_GONE_AFTER_MS, inDesktopApp, initialConnection, nextConnection, restartAdvice, serverGone } from "../../src/web/shell/server-gone.ts";

describe("serverGone", () => {
  test("a page that was never connected says nothing, however long it waits", () => {
    const c = nextConnection(initialConnection, false, 0);
    expect(serverGone(c, 60_000)).toBe(false);
  });

  test("a drop says nothing for three seconds, then says it, and a return clears it at once", () => {
    let c = nextConnection(initialConnection, true, 0);
    c = nextConnection(c, false, 1000);
    expect(serverGone(c, 1000 + SERVER_GONE_AFTER_MS - 1)).toBe(false);
    expect(serverGone(c, 1000 + SERVER_GONE_AFTER_MS)).toBe(true);
    // A second "down" read keeps the first time, so the wait is from the drop, not from the last render.
    c = nextConnection(c, false, 3500);
    expect(c.downSince).toBe(1000);
    c = nextConnection(c, true, 5000);
    expect(serverGone(c, 5000)).toBe(false);
  });

  test("a reconnect blip shorter than the wait never shows", () => {
    let c = nextConnection(initialConnection, true, 0);
    c = nextConnection(c, false, 100);
    c = nextConnection(c, true, 1100);
    expect(serverGone(c, 10_000)).toBe(false);
  });
});

describe("restart advice", () => {
  test("the desktop app gets its own line only; a browser gets both, with the terminal command", () => {
    expect(restartAdvice(true)).toEqual({ app: "Quit keyloom and open it again.", terminal: null });
    expect(restartAdvice(false).terminal).not.toBeNull();
    expect(inDesktopApp({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(inDesktopApp({})).toBe(false);
  });
});
