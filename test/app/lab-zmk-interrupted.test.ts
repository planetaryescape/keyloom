import { expect, test } from "bun:test";
import { analyseSession, beginRecording, endRecording, sessions, type LabDeps } from "../../src/app/lab.ts";
import { UsageError } from "../../src/app/errors.ts";
import { startZmkCapture } from "../../src/firmware/zmk/typing-capture.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { fakeGlove } from "../helpers/fake-key-stream.ts";

const failures = [
  { name: "serial transport error", run: (kb: ReturnType<typeof fakeGlove>) => kb.fail("synthetic disconnect") },
  { name: "rejected ping write", run: () => {}, options: { rejectWrite: "ping" as const }, waitMs: 10 },
  { name: "rejected STOP write", run: () => {}, options: { rejectWrite: "stop" as const } },
  { name: "missing OFF reply", run: () => {}, options: { neverOff: true } },
  { name: "rejected close", run: () => {}, options: { rejectClose: true } },
  { name: "invalid UTF-8", run: (kb: ReturnType<typeof fakeGlove>) => kb.sayBytes(Uint8Array.of(0xff)) },
  { name: "unterminated line", run: (kb: ReturnType<typeof fakeGlove>) => kb.say("E 1 1 5010 255") },
  { name: "overlong line", run: (kb: ReturnType<typeof fakeGlove>) => kb.say(`${"x".repeat(4097)}\n`) },
  { name: "firmware DROP", run: (kb: ReturnType<typeof fakeGlove>) => kb.say("KLTYPE DROP 2\n") },
] as const;

for (const failure of failures) {
  test(`ZMK ${failure.name} is saved and refused by timing analysis`, async () => {
    const { app, layoutId } = await commandShiftApp();
    const keyboard = fakeGlove("options" in failure ? failure.options : {});
    const deps: LabDeps = {
      startCapture: (_board, hooks) => {
        const captureHooks = { ...hooks };
        if (failure.name === "rejected ping write") captureHooks.keepaliveMs = 5;
        return startZmkCapture(keyboard.transport, "/fake/serial", captureHooks);
      },
      replay: () => { throw new Error("incomplete recordings must never reach replay"); },
    };
    try {
      const recording = await beginRecording(app, layoutId, deps, { text: "test" });
      keyboard.press([{ position: 2, pressed: true, ms: 10 }, { position: 2, pressed: false, ms: 20 }]);
      await Bun.sleep(1);
      if ("waitMs" in failure) await Bun.sleep(failure.waitMs);
      failure.run(keyboard);
      const saved = await endRecording(app, recording, "t");
      const reloaded = sessions(app, layoutId).find((session) => session.id === saved.session.id);
      expect(reloaded?.warnings.some((warning) => warning.startsWith("Recording incomplete:"))).toBe(true);
      let refusal: unknown;
      try { await analyseSession(app, saved.session.id, deps); } catch (error) { refusal = error; }
      expect(refusal).toBeInstanceOf(UsageError);
      expect(refusal).toMatchObject({ message: expect.stringContaining("recording is incomplete") });
    } finally {
      app.db.close();
    }
  }, 5000);
}
