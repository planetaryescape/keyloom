import { expect, test } from "bun:test";
import { startQmkCapture } from "../../../src/firmware/qmk/typing-capture.ts";
import { TYPING_ACTION } from "../../../src/firmware/qmk/typing-stream.ts";
import { fakeMoonlander, moonlanderInterface } from "../../helpers/fake-key-stream.ts";
import type { HidTransport } from "../../../src/firmware/toolchain/hid.ts";

for (const mode of ["write-failure", "no-ack", "close-failure"] as const) {
  test(`${mode} cannot become a complete Moonlander recording`, async () => {
    const kb = fakeMoonlander();
    let stops = 0, closes = 0;
    const transport: HidTransport = { ...kb.transport, async openSession(...args) {
      const session = await kb.transport.openSession!(...args);
      return {
        async write(report) {
          if (report[9] === TYPING_ACTION.stop) {
            stops++;
            if (mode === "write-failure") throw new Error("synthetic stop write failed");
            if (mode === "no-ack") return;
          }
          await session.write(report);
        },
        async close() { closes++; await session.close(); if (mode === "close-failure") throw new Error("synthetic close failed"); },
      };
    } };
    const capture = await startQmkCapture(transport, moonlanderInterface());
    kb.press([{ atMs: 1_000_020, position: 2, pressed: true }]);
    const [first, second] = await Promise.all([capture.finish(), capture.finish()]);
    expect(first).toBe(second);
    expect(first.endedBy).not.toBe("host");
    expect(first.warnings.some((w) => w.startsWith("Recording incomplete:"))).toBe(true);
    expect(stops).toBe(1); expect(closes).toBe(1);
    expect(first.events[0]).toEqual({ at: 20, position: 2, action: "press" });
  });
}

test("slow keepalive writes never accumulate and finish waits before its single stop", async () => {
  const kb = fakeMoonlander();
  let pending = 0, peak = 0, release: (() => void) | undefined;
  const transport: HidTransport = { ...kb.transport, async openSession(...args) {
    const session = await kb.transport.openSession!(...args);
    return { close: () => session.close(), async write(report) {
      if (report[9] === TYPING_ACTION.keepalive) {
        pending++; peak = Math.max(peak, pending);
        await new Promise<void>((resolve) => { release = resolve; }); pending--;
      }
      await session.write(report);
    } };
  } };
  const capture = await startQmkCapture(transport, moonlanderInterface(), { keepaliveMs: 5 });
  await Bun.sleep(35);
  const done = capture.finish();
  release?.();
  expect((await done).endedBy).toBe("host");
  expect(peak).toBe(1);
});
