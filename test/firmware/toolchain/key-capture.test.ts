// The typing lab's host readers (D-281) against fake keyboards that speak the firmware's protocol: the handshake, decoding, repairs and
// the ways a stream ends. The transports' own reading (a FIFO standing in for a device node) is at the end.
import { describe, expect, test } from "bun:test";
import { WINDOWS_HID_DRIVER_HINT } from "../../../src/firmware/toolchain/platform-support.ts";
import { join } from "node:path";
import { CaptureError, TraceBuilder } from "../../../src/firmware/emulate/trace.ts";
import { findQmkStreamDevice, startQmkCapture } from "../../../src/firmware/qmk/typing-capture.ts";
import { TYPING_ACTION } from "../../../src/firmware/qmk/typing-stream.ts";
import { linuxHid } from "../../../src/firmware/toolchain/hid-linux.ts";
import { openPolled } from "../../../src/firmware/toolchain/polled-file.ts";
import { WINDOWS_COM_DRIVER_HINT } from "../../../src/firmware/toolchain/platform-support.ts";
import { type SerialPort, openWithStty } from "../../../src/firmware/toolchain/serial.ts";
import { findZmkStreamPort, startZmkCapture } from "../../../src/firmware/zmk/typing-capture.ts";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { fakeGlove, fakeMoonlander, glovePort, moonlanderInterface } from "../../helpers/fake-key-stream.ts";
import { SLOW_RUNNER_MS } from "../../helpers/timeouts.ts";
import { tempDir } from "../../helpers/tmp.ts";

const ROOT = `${import.meta.dir}/../../..`;
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const ev = (position: number, pressed: boolean, atMs: number) => ({ position, pressed, atMs });

describe("the trace builder", () => {
  test("measures from the clock at the start, across the 32-bit wrap, and repairs keys that cannot be right", () => {
    const b = new TraceBuilder();
    b.start(0xffff_fff0);
    b.add(0xffff_fff5, 4, true);
    b.add(0x0000_0010, 4, false);
    b.add(0x0000_0012, 9, true);
    b.add(0x0000_0013, 9, true);
    b.add(0x0000_0014, 30, false);
    expect(b.finish()).toEqual([
      { at: 5, position: 4, action: "press" },
      { at: 32, position: 4, action: "release" },
      { at: 34, position: 9, action: "press" },
      { at: 34, position: 9, action: "release" },
    ]);
    expect(b.warnings.join("\n")).toContain("key 10 was reported pressed while already down");
    expect(b.warnings.join("\n")).toContain("key 31 was reported released while not down");
    expect(b.warnings.join("\n")).toContain("key 10 was still down");
  });
});

describe("recording from a Moonlander", () => {
  test("starts the stream, sends keepalives, decodes keys into a trace and stops on finish", async () => {
    const kb = fakeMoonlander();
    const seen: number[] = [];
    const capture = await startQmkCapture(kb.transport, moonlanderInterface(), { keepaliveMs: 20, onEvent: (e) => seen.push(e.position) });
    expect(kb.isOn()).toBe(true);
    kb.press([ev(30, true, 1_000_100), ev(31, true, 1_000_130), ev(30, false, 1_000_160), ev(31, false, 1_000_190)]);
    await tick(70);
    const trace = await capture.finish();
    expect(trace.events).toEqual([
      { at: 100, position: 30, action: "press" },
      { at: 130, position: 31, action: "press" },
      { at: 160, position: 30, action: "release" },
      { at: 190, position: 31, action: "release" },
    ]);
    expect(trace.endedBy).toBe("host");
    expect(trace.warnings).toEqual([]);
    expect(seen).toEqual([30, 31, 30, 31]);
    const actions = kb.stream.written.map((r) => r[9]);
    expect(actions[0]).toBe(TYPING_ACTION.start);
    expect(actions.slice(1, -1).every((a) => a === TYPING_ACTION.keepalive)).toBe(true);
    expect(actions.filter((a) => a === TYPING_ACTION.keepalive).length).toBeGreaterThan(0);
    expect(actions.at(-1)).toBe(TYPING_ACTION.stop);
    expect(kb.isOn()).toBe(false);
    expect(kb.stream.closed()).toBe(1);
  });

  test("finishing twice returns the same trace and sends one stop", async () => {
    const kb = fakeMoonlander();
    const capture = await startQmkCapture(kb.transport, moonlanderInterface());
    kb.press([ev(1, true, 1_000_010), ev(1, false, 1_000_050)]);
    await tick(10);
    const first = await capture.finish();
    const second = await capture.finish();
    expect(second.events).toEqual(first.events);
    expect(kb.stream.written.filter((r) => r[9] === TYPING_ACTION.stop)).toHaveLength(1);
    expect(kb.stream.closed()).toBe(1);
  });

  test("more than five events cross report boundaries in order", async () => {
    const kb = fakeMoonlander();
    const capture = await startQmkCapture(kb.transport, moonlanderInterface());
    const events = Array.from({ length: 12 }, (_, i) => ev(i % 6, i % 2 === 0, 1_000_000 + i * 10));
    kb.press(events.map((e, i) => ({ ...e, position: Math.floor(i / 2), pressed: i % 2 === 0 })));
    await tick(20);
    const trace = await capture.finish();
    expect(trace.events.map((e) => `${e.position}${e.action === "press" ? "d" : "u"}`)).toEqual(["0d", "0u", "1d", "1u", "2d", "2u", "3d", "3u", "4d", "4u", "5d", "5u"]);
    expect(trace.events.map((e) => e.at)).toEqual(events.map((_, i) => i * 10));
  });

  test("a lost report and dropped events are warned about, not hidden", async () => {
    const kb = fakeMoonlander();
    const capture = await startQmkCapture(kb.transport, moonlanderInterface());
    kb.press([ev(1, true, 1_000_010)], { dropped: 3 });
    kb.loseReport();
    kb.press([ev(1, false, 1_000_050)]);
    await tick(20);
    const trace = await capture.finish();
    expect(trace.warnings.join("\n")).toContain("1 report(s) from the keyboard never arrived");
    expect(trace.warnings.join("\n")).toContain("dropped 3 event(s)");
  });

  test("firmware that does not answer is refused with what to do, and the connection is closed after a stop", async () => {
    const kb = fakeMoonlander({ answers: false });
    await expect(startQmkCapture(kb.transport, moonlanderInterface(), { startTimeoutMs: 40 })).rejects.toThrow("predate the typing lab");
    expect(kb.stream.closed()).toBe(1);
    expect(kb.stream.written.at(-1)?.[9]).toBe(TYPING_ACTION.stop);
  });

  test("the keyboard stopping by itself settles `ended` with its reason and the trace says so", async () => {
    const kb = fakeMoonlander();
    const capture = await startQmkCapture(kb.transport, moonlanderInterface());
    kb.press([ev(2, true, 1_000_010)]);
    kb.stopBy(1);
    expect(await capture.ended).toBe("the 10 minute limit");
    const trace = await capture.finish();
    expect(trace.endedBy).toBe("the 10 minute limit");
    expect(trace.warnings.join("\n")).toContain("ended the stream early: the 10 minute limit");
    expect(trace.events.at(-1)).toMatchObject({ position: 2, action: "release" });
  });

  test("a failing connection ends the capture with its message", async () => {
    const kb = fakeMoonlander();
    const capture = await startQmkCapture(kb.transport, moonlanderInterface());
    kb.fail("device gone");
    expect(await capture.ended).toContain("device gone");
    expect((await capture.finish()).endedBy).toContain("device gone");
  });

  test("finds the keyloom Moonlander and says why it can't when there is none, an Oryx build or two", async () => {
    expect((await findQmkStreamDevice(fakeMoonlander().transport)).handle).toBe("fake-hid-1");
    await expect(findQmkStreamDevice(fakeMoonlander({ interfaces: [] }).transport)).rejects.toThrow("no ZSA keyboard");
    await expect(findQmkStreamDevice(fakeMoonlander({ interfaces: [moonlanderInterface("QxKPz/zLQ3Md")] }).transport)).rejects.toThrow("isn't running a keyloom build");
    await expect(findQmkStreamDevice(fakeMoonlander({ interfaces: [moonlanderInterface(), moonlanderInterface("keyloom/ABCDEFGHJKMN")] }).transport)).rejects.toThrow("more than one");
    await expect(findQmkStreamDevice(fakeMoonlander({ interfaces: [{ ...moonlanderInterface(), vendorId: 0x1234 }] }).transport)).rejects.toThrow(CaptureError);
  });

  test("a second ZSA device with a failed raw-HID driver doesn't block the healthy keyloom Moonlander", async () => {
    const failed = { ...moonlanderInterface("QxKPz/zLQ3Md"), handle: "", driverMissing: true as const };
    expect((await findQmkStreamDevice(fakeMoonlander({ interfaces: [failed, moonlanderInterface()] }).transport)).handle).toBe("fake-hid-1");
    // With only the failed one attached, the driver is the answer.
    await expect(findQmkStreamDevice(fakeMoonlander({ interfaces: [failed] }).transport)).rejects.toThrow(WINDOWS_HID_DRIVER_HINT);
  });
});

describe("recording from a Glove80", () => {
  test("asks for the stream, parses lines that arrive in pieces and keeps each key's half", async () => {
    const kb = fakeGlove();
    const capture = await startZmkCapture(kb.transport, "/fake/cu.usbmodem1", { keepaliveMs: 20 });
    kb.say("E 25 1 5100 255\nE 60 1 51", 7);
    kb.say("30 0\nE 25 0 5160 255\nE 60 0 5190 0\n", 5);
    await tick(70);
    const trace = await capture.finish();
    expect(trace.events).toEqual([
      { at: 100, position: 25, action: "press", source: 255 },
      { at: 130, position: 60, action: "press", source: 0 },
      { at: 160, position: 25, action: "release", source: 255 },
      { at: 190, position: 60, action: "release", source: 0 },
    ]);
    expect(kb.stream.written[0]).toBe("KLTYPE START\n");
    expect(kb.stream.written.slice(1, -1).every((w) => w === "KLTYPE PING\n")).toBe(true);
    expect(kb.stream.written.at(-1)).toBe("KLTYPE STOP\n");
    expect(kb.stream.closed()).toBe(1);
    expect(trace.warnings).toEqual([]);
    expect(trace.endedBy).toBe("host");
  });

  test("lines that are not the stream's are ignored, and drops are reported", async () => {
    const kb = fakeGlove();
    const capture = await startZmkCapture(kb.transport, "/fake/p");
    kb.say("garbage\nKLTYPE DROP 4\nE 1 1 5010 255\nE x y\nE 1 0 5020 255\n");
    await tick(10);
    const trace = await capture.finish();
    expect(trace.events).toHaveLength(2);
    expect(trace.warnings.join("\n")).toContain("Recording incomplete: the keyboard dropped 4 event(s)");
  });

  test("a pending ping is singular, and concurrent finish calls share stop and close", async () => {
    const kb = fakeGlove({ pendingWrite: "ping" });
    const capture = await startZmkCapture(kb.transport, "/fake/p", { keepaliveMs: 5 });
    await tick(20);
    expect(kb.stream.written.filter((w) => w === "KLTYPE PING\n")).toHaveLength(1);
    const first = capture.finish();
    const second = capture.finish();
    await tick(5);
    expect(kb.stream.written).not.toContain("KLTYPE STOP\n");
    kb.releasePendingWrite();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(kb.stream.written.filter((w) => w === "KLTYPE STOP\n")).toHaveLength(1);
    expect(kb.stream.closed()).toBe(1);
  }, 5000);

  test("transport loss during start fails promptly and closes the session", async () => {
    const kb = fakeGlove({ answers: false });
    const transport = {
      ...kb.transport,
      async open(path: string, onData: (bytes: Uint8Array) => void, onError?: (error: Error) => void) {
        const session = await kb.transport.open!(path, onData, onError);
        return {
          close: () => session.close(),
          async write(text: string) {
            if (text === "KLTYPE START\n") onError?.(new Error("synthetic start loss"));
            else await session.write(text);
          },
        };
      },
    };
    await expect(startZmkCapture(transport, "/fake/p", { startTimeoutMs: 1000 })).rejects.toThrow("synthetic start loss");
    expect(kb.stream.closed()).toBe(1);
  }, 5000);

  test("a rejected start write preserves its error after awaited stop and close", async () => {
    const kb = fakeGlove({ rejectWrite: "start" });
    await expect(startZmkCapture(kb.transport, "/fake/p")).rejects.toThrow("synthetic start write failure");
    expect(kb.stream.written).toEqual(["KLTYPE START\n", "KLTYPE STOP\n"]);
    expect(kb.stream.closed()).toBe(1);
  });

  test("finish after a transport error reports loss without another stop", async () => {
    const kb = fakeGlove();
    const capture = await startZmkCapture(kb.transport, "/fake/p");
    kb.fail("synthetic disconnect");
    await capture.ended;
    const trace = await capture.finish();
    expect(trace.warnings.some((warning) => warning.startsWith("Recording incomplete:"))).toBe(true);
    expect(trace.endedBy).toContain("synthetic disconnect");
    expect(kb.stream.written).not.toContain("KLTYPE STOP\n");
  });

  test("silent firmware is refused, and a keyboard-side stop is reported", async () => {
    await expect(startZmkCapture(fakeGlove({ answers: false }).transport, "/fake/p", { startTimeoutMs: 40 })).rejects.toThrow("predate the typing lab");
    const kb = fakeGlove();
    const capture = await startZmkCapture(kb.transport, "/fake/p");
    kb.press([{ position: 3, pressed: true, ms: 10 }]);
    kb.stopBy(2);
    expect(await capture.ended).toBe("the host stopped answering");
    const trace = await capture.finish();
    expect(trace.endedBy).toBe("the host stopped answering");
    expect(trace.events.at(-1)).toMatchObject({ position: 3, action: "release" });
  });

  test("a failed peripheral driver does not block a healthy central or misdiagnose its absence", async () => {
    const board = (await loadBoardDir(`${ROOT}/boards/moergo/glove80`)).definition;
    const central = glovePort("keyloom/NPQRSTVWXYZ0-L:GLV80-TEST", "COM12");
    const right: SerialPort = { ...glovePort("keyloom/NPQRSTVWXYZ0-R:GLV80-TEST", ""), productId: 0x27d9, driverMissing: true };
    expect(await findZmkStreamPort(board, fakeGlove({ ports: [right, central] }).transport)).toEqual({ path: "COM12" });
    await expect(findZmkStreamPort(board, fakeGlove({ ports: [right] }).transport)).rejects.toThrow("running keyloom's firmware is connected");
    await expect(findZmkStreamPort(board, fakeGlove({ ports: [right, central, { ...central, path: "COM13" }] }).transport)).rejects.toThrow("more than one");
  });

  test("a missing central driver is diagnosed only when no usable central is available", async () => {
    const board = (await loadBoardDir(`${ROOT}/boards/moergo/glove80`)).definition;
    const central = glovePort("keyloom/NPQRSTVWXYZ0-L:GLV80-TEST", "COM12");
    const failed: SerialPort = { ...central, path: "", driverMissing: true };
    await expect(findZmkStreamPort(board, fakeGlove({ ports: [failed] }).transport)).rejects.toThrow(WINDOWS_COM_DRIVER_HINT);
    expect(await findZmkStreamPort(board, fakeGlove({ ports: [failed, central] }).transport)).toEqual({ path: "COM12" });
  });

  test("picks the central half's port and refuses the peripheral's, other boards' and several", async () => {
    const board = (await loadBoardDir(`${ROOT}/boards/moergo/glove80`)).definition;
    const central = glovePort("keyloom/NPQRSTVWXYZ0-L:GLV80-0123456789ABCDEF", "/fake/left");
    const right = glovePort("keyloom/NPQRSTVWXYZ0-R:GLV80-0123456789ABCDEF", "/fake/right");
    expect(await findZmkStreamPort(board, fakeGlove({ ports: [right, central] }).transport)).toEqual({ path: "/fake/left" });
    await expect(findZmkStreamPort(board, fakeGlove({ ports: [right] }).transport)).rejects.toThrow("running keyloom's firmware is connected");
    await expect(findZmkStreamPort(board, fakeGlove({ ports: [] }).transport)).rejects.toThrow("running keyloom's firmware is connected");
    await expect(findZmkStreamPort(board, fakeGlove({ ports: [central, { ...central, path: "/fake/other" }] }).transport)).rejects.toThrow("more than one");
  });
});

describe("reading a device node", () => {
  const mkfifo = async (path: string) => {
    const r = await Bun.$`mkfifo ${path}`.quiet().nothrow();
    if (r.exitCode !== 0) throw new Error("mkfifo failed");
  };

  test("openPolled delivers what is written to the node, writes back, and closes without a hang", async () => {
    const dir = tempDir();
    const node = join(dir, "node");
    await mkfifo(node);
    const got: number[][] = [];
    const file = openPolled(node, (c) => got.push([...c]), { chunkSize: 4 });
    file.write(Uint8Array.of(1, 2, 3, 4));
    await tick(30);
    expect(got.flat()).toEqual([1, 2, 3, 4]);
    file.close();
    file.close();
    expect(() => file.write(Uint8Array.of(1))).toThrow("is closed");
  }, SLOW_RUNNER_MS);

  test("a Linux hidraw node opens as a session whose reports are the 32-byte reads", async () => {
    const dir = tempDir();
    const node = join(dir, "hidraw3");
    await mkfifo(node);
    const hid = linuxHid(join(dir, "sys"), dir);
    const reports: number[] = [];
    const session = await (hid.openSession as NonNullable<typeof hid.openSession>)({ vendorId: 1, productId: 2, handle: node }, (r) => reports.push(r.length));
    await session.write(new Uint8Array(32).fill(7));
    await tick(30);
    expect(reports).toEqual([32]);
    await session.close();
  }, SLOW_RUNNER_MS);

  test("a serial port is put in raw mode at 115200 first (never 1200) and then read as bytes", async () => {
    const dir = tempDir();
    const node = join(dir, "ttyfake");
    await mkfifo(node);
    const bin = fakeBinDir({ stty: `echo "$@" >> "${join(dir, "stty.calls")}"` });
    const bytes: number[] = [];
    const session = await withPath(bin, () => openWithStty(node, (chunk) => bytes.push(...chunk), undefined, "darwin"));
    await session.write("KLTYPE START\n");
    await tick(30);
    await session.close();
    await expect(session.write("late write\n")).rejects.toThrow("closed");
    expect(new TextDecoder().decode(Uint8Array.from(bytes))).toBe("KLTYPE START\n");
    expect(await Bun.file(join(dir, "stty.calls")).text()).toBe(`-f ${node} raw -echo 115200\n`);
  }, SLOW_RUNNER_MS);

  test("a real device node is refused in tests, so a test can never start a stream on BK's keyboard", () => {
    expect(() => openPolled("/dev/hidraw0", () => {}, { chunkSize: 32 })).toThrow("tests must flash into a temporary directory");
  });
});
