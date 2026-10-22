import { describe, expect, test } from "bun:test";
import { CAPTURE_CLOSE_TIMEOUT_MS, CAPTURE_WRITE_TIMEOUT_MS } from "../../../src/firmware/emulate/capture-deadline.ts";
import { CaptureError, type CaptureHooks, type KeyCapture } from "../../../src/firmware/emulate/trace.ts";
import { startQmkCapture } from "../../../src/firmware/qmk/typing-capture.ts";
import { TYPING_ACTION, encodeEventsReport, encodeStatusReport } from "../../../src/firmware/qmk/typing-stream.ts";
import type { HidTransport } from "../../../src/firmware/toolchain/hid.ts";
import type { SerialTransport } from "../../../src/firmware/toolchain/serial.ts";
import { startZmkCapture } from "../../../src/firmware/zmk/typing-capture.ts";
import { moonlanderInterface } from "../../helpers/fake-key-stream.ts";

type Action = "START" | "keepalive" | "STOP";
const never = () => new Promise<void>(() => {});

function keyboard(kind: "QMK" | "ZMK", faults: {
  write?: (action: Action) => void | Promise<void>;
  close?: () => void | Promise<void>;
  /** START lands but the keyboard doesn't answer until the test calls status(true). */
  silentStart?: boolean;
} = {}) {
  const actions: string[] = [];
  let closes = 0, seq = 0;
  let receive: (bytes: Uint8Array) => void = () => {};
  let lost: ((error: Error) => void) | undefined;
  const bytes = (text: string) => new TextEncoder().encode(text);
  const status = (on: boolean) => receive(kind === "QMK"
    ? encodeStatusReport(seq++, on, 1000, 0)
    : bytes(on ? "KLTYPE ON 1000\n" : "KLTYPE OFF 0\n"));
  const write = (action: Action): Promise<void> => {
    actions.push(action);
    return Promise.resolve(faults.write?.(action)).then(() => {
      if (action === "START" && !faults.silentStart) status(true);
      if (action === "STOP") status(false);
    });
  };
  const close = async () => { closes++; actions.push("close"); await faults.close?.(); };
  const hid: HidTransport = {
    list: async () => [moonlanderInterface()],
    write: async () => { throw new Error("not a capture write"); },
    openSession: async (_target, onData, onError) => {
      receive = onData; lost = onError;
      return { close, write: (report) => {
        const action = report[9];
        if (action === TYPING_ACTION.start) return write("START");
        if (action === TYPING_ACTION.keepalive) return write("keepalive");
        if (action === TYPING_ACTION.stop) return write("STOP");
        throw new Error("unexpected HID write");
      } };
    },
  };
  const serial: SerialTransport = {
    list: async () => [],
    touch: async () => { throw new Error("must never touch a keyboard"); },
    open: async (_path, onData, onError) => {
      receive = onData; lost = onError;
      return { close, write: (text) => {
        if (text === "KLTYPE START\n") return write("START");
        if (text === "KLTYPE PING\n") return write("keepalive");
        if (text === "KLTYPE STOP\n") return write("STOP");
        throw new Error("unexpected serial write");
      } };
    },
  };
  return {
    actions, closes: () => closes, status,
    start: (hooks?: CaptureHooks): Promise<KeyCapture> => kind === "QMK"
      ? startQmkCapture(hid, moonlanderInterface(), hooks)
      : startZmkCapture(serial, "/fake/serial", hooks),
    fail: (text: string) => lost?.(new Error(text)),
    malformed: () => receive(Uint8Array.of(0xff)),
    overlong: () => receive(bytes("x".repeat(4097))),
    event: () => receive(kind === "QMK"
      ? encodeEventsReport(seq++, [{ atMs: 1020, position: 2, pressed: true }])
      : bytes("E 2 1 1020 255\n")),
  };
}

for (const kind of ["QMK", "ZMK"] as const) describe(`${kind} capture deadlines`, () => {
  test("a hung START write fails within its deadline and closes once", async () => {
    const kb = keyboard(kind, { write: (action) => action === "START" ? never() : undefined });
    const began = Date.now();
    await expect(kb.start({ keepaliveMs: 5 })).rejects.toThrow(`START write timed out after ${CAPTURE_WRITE_TIMEOUT_MS} ms`);
    expect(Date.now() - began).toBeLessThan(CAPTURE_WRITE_TIMEOUT_MS + 500);
    expect(kb.actions).toEqual(["START", "STOP", "close"]);
    expect(kb.closes()).toBe(1);
  });

  test("finish bounds a hung keepalive, shares cleanup and ignores late completion", async () => {
    const entered = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<void>();
    const kb = keyboard(kind, { write: (action) => {
      if (action === "keepalive") { entered.resolve(); return pending.promise; }
    } });
    const capture = await kb.start({ keepaliveMs: 5 });
    await entered.promise;
    const began = Date.now();
    const [first, second] = await Promise.all([capture.finish(), capture.finish()]);
    expect(Date.now() - began).toBeLessThan(CAPTURE_WRITE_TIMEOUT_MS + 500);
    expect(first).toBe(second);
    expect(first.endedBy).toContain("keepalive write timed out");
    expect(await capture.ended).toBe(first.endedBy);
    expect(first.warnings.join("\n")).toContain("Recording incomplete:");
    pending.resolve();
    kb.event();
    await Bun.sleep(20);
    expect(await capture.finish()).toBe(first);
    expect(capture.snapshot()).toEqual([]);
    expect(kb.actions).toEqual(["START", "keepalive", "close"]);
    expect(kb.closes()).toBe(1);
  });

  test("a keepalive deadline ends an idle capture and close failure stays secondary", async () => {
    const kb = keyboard(kind, {
      write: (action) => action === "keepalive" ? never() : undefined,
      close: () => { throw new Error("synthetic close failure"); },
    });
    const capture = await kb.start({ keepaliveMs: 5 });
    const reason = await capture.ended;
    expect(reason).toContain("keepalive write timed out");
    const trace = await capture.finish();
    expect(trace.endedBy).toBe(reason);
    expect(trace.warnings.join("\n")).toContain("synthetic close failure");
    expect(kb.closes()).toBe(1);
  });

  test("a hung STOP write is incomplete even if OFF arrives first", async () => {
    const kb = keyboard(kind, { write: (action) => {
      if (action === "STOP") { kb.status(false); return never(); }
    } });
    const capture = await kb.start();
    const began = Date.now();
    const [first, second] = await Promise.all([capture.finish(), capture.finish()]);
    expect(Date.now() - began).toBeLessThan(CAPTURE_WRITE_TIMEOUT_MS + 500);
    expect(first).toBe(second);
    expect(first.endedBy).toContain("STOP write timed out");
    expect(first.warnings.join("\n")).toContain("Recording incomplete:");
    expect(kb.actions).toEqual(["START", "STOP", "close"]);
    expect(kb.closes()).toBe(1);
  });

  test("a hung close is bounded and a late rejection cannot close again", async () => {
    const pending = Promise.withResolvers<void>();
    const kb = keyboard(kind, { close: () => pending.promise });
    const capture = await kb.start();
    const began = Date.now();
    const [first, second] = await Promise.all([capture.finish(), capture.finish()]);
    expect(Date.now() - began).toBeLessThan(CAPTURE_CLOSE_TIMEOUT_MS + 500);
    expect(first).toBe(second);
    expect(first.endedBy).toContain("close timed out");
    expect(first.warnings.join("\n")).toContain("Recording incomplete:");
    pending.reject(new Error("late close rejection"));
    kb.event();
    await Bun.sleep(20);
    expect(await capture.finish()).toBe(first);
    expect(capture.snapshot()).toEqual([]);
    expect(kb.closes()).toBe(1);
  });

  for (const cleanup of ["rejected close", "hung close", "hung STOP and close"] as const) {
    test(`a failed start remains primary with ${cleanup}`, async () => {
      const primary = new Error("synthetic START failure");
      const kb = keyboard(kind, {
        write: (action) => {
          if (action === "START") throw primary;
          if (action === "STOP" && cleanup === "hung STOP and close") return never();
        },
        close: () => {
          if (cleanup === "rejected close") throw new Error("synthetic close failure");
          return never();
        },
      });
      let failure: unknown;
      const began = Date.now();
      try { await kb.start({ keepaliveMs: 5 }); } catch (error) { failure = error; }
      expect(Date.now() - began).toBeLessThan(CAPTURE_WRITE_TIMEOUT_MS + CAPTURE_CLOSE_TIMEOUT_MS + 500);
      expect(failure).toBeInstanceOf(CaptureError);
      if (!(failure instanceof CaptureError)) throw new Error("start should have failed");
      expect(failure.message).toStartWith(primary.message);
      expect(failure.cause).toBe(primary);
      expect(failure.message).toContain("cleanup uncertain");
      expect(failure.message).toContain(cleanup === "rejected close" ? "synthetic close failure" : "close timed out");
      if (cleanup === "hung STOP and close") expect(failure.message).toContain("STOP write timed out");
      expect(kb.actions).toEqual(["START", "STOP", "close"]);
      expect(kb.closes()).toBe(1);
    });
  }

  test("the helper's own write error wins before the capture deadline", async () => {
    const primary = new Error("helper write timeout");
    const kb = keyboard(kind, { write: async (action) => {
      if (action === "START") { await Bun.sleep(500); throw primary; }
    } });
    await expect(kb.start()).rejects.toBe(primary);
    expect(kb.closes()).toBe(1);
  });

  test("the helper's own close error wins before the capture deadline", async () => {
    const kb = keyboard(kind, { close: async () => { await Bun.sleep(1000); throw new Error("helper close timeout"); } });
    const capture = await kb.start();
    const trace = await capture.finish();
    expect(trace.endedBy).toContain("helper close timeout");
    expect(trace.warnings.join("\n")).not.toContain("capture close timed out");
    expect(kb.closes()).toBe(1);
  });

  test("a valid pending START gets no competing keepalive or premature close", async () => {
    const entered = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<void>();
    const kb = keyboard(kind, { write: (action) => {
      if (action === "START") { entered.resolve(); return pending.promise; }
    } });
    const starting = kb.start({ keepaliveMs: 5 });
    await entered.promise;
    await Bun.sleep(30);
    expect(kb.actions).toEqual(["START"]);
    pending.resolve();
    const capture = await starting;
    expect((await capture.finish()).endedBy).toBe("host");
    expect(kb.actions).toEqual(["START", "STOP", "close"]);
  });

  test("connection loss during a pending START wins over its earlier ON reply", async () => {
    const kb = keyboard(kind, { write: (action) => {
      if (action === "START") { kb.status(true); kb.fail("lost during START"); }
    } });
    await expect(kb.start()).rejects.toThrow("lost during START");
    expect(kb.actions).toEqual(["START", "STOP", "close"]);
  });
});

for (const framing of ["malformed", "overlong"] as const) {
  test(`ZMK ${framing} input sends STOP before close and keeps the framing error primary`, async () => {
    const kb = keyboard("ZMK", { close: () => { throw new Error("synthetic close failure"); } });
    const capture = await kb.start();
    kb[framing]();
    const primary = await capture.ended;
    expect(primary).toContain(framing === "malformed" ? "invalid UTF-8" : "4096 UTF-8 bytes");
    const trace = await capture.finish();
    expect(trace.endedBy).toBe(primary);
    expect(trace.warnings.join("\n")).toContain("synthetic close failure");
    expect(kb.actions).toEqual(["START", "STOP", "close"]);
  });
}

test("ZMK framing failure still closes once when its best-effort STOP hangs", async () => {
  const kb = keyboard("ZMK", { write: (action) => action === "STOP" ? never() : undefined });
  const capture = await kb.start();
  kb.malformed();
  const primary = await capture.ended;
  const trace = await capture.finish();
  expect(trace.endedBy).toBe(primary);
  expect(trace.warnings.join("\n")).toContain("STOP write timed out");
  expect(kb.actions).toEqual(["START", "STOP", "close"]);
  expect(kb.closes()).toBe(1);
});

for (const kind of ["QMK", "ZMK"] as const) {
  test(`${kind} keeps the stream alive while waiting for START's answer`, async () => {
    // The firmware ends the stream after 3 s without a START or keepalive, so a slow answer must not leave it unpinged.
    const kb = keyboard(kind, { silentStart: true });
    const starting = kb.start({ keepaliveMs: 20, startTimeoutMs: 1000 });
    await Bun.sleep(120);
    expect(kb.actions.filter((a) => a === "keepalive").length).toBeGreaterThan(0);
    kb.status(true);
    const capture = await starting;
    await capture.finish();
  });
}

for (const kind of ["QMK", "ZMK"] as const) {
  test(`${kind} keeps an earlier interruption primary when the START write then times out`, async () => {
    const kb = keyboard(kind, { write: (action) => (action === "START" ? never() : undefined), silentStart: true });
    const starting = kb.start({ keepaliveMs: 10_000 });
    await Bun.sleep(20);
    kb.fail("cable pulled");
    const err = await starting.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaptureError);
    expect((err as Error).message).toContain("cable pulled");
    expect(((err as Error).cause as Error | undefined)?.message).toContain("START write timed out");
  });
}
