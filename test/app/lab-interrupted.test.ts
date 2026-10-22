import { expect, test } from "bun:test";
import { beginRecording, endRecording, analyseSession, sessions, type LabDeps } from "../../src/app/lab.ts";
import { startQmkCapture } from "../../src/firmware/qmk/typing-capture.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { fakeMoonlander, moonlanderInterface } from "../helpers/fake-key-stream.ts";

test("interrupted capture survives persistence and refuses timing analysis before replay", async () => {
  const { app, layoutId } = await commandShiftApp();
  const keyboard = fakeMoonlander();
  let replays = 0;
  const deps: LabDeps = {
    startCapture: (_board, hooks) => startQmkCapture(keyboard.transport, moonlanderInterface(), hooks),
    replay: () => { replays++; throw new Error("incomplete recordings must never reach replay"); },
  };
  try {
    const recording = await beginRecording(app, layoutId, deps, { text: "test" });
    keyboard.press([{ atMs: 1_000_020, position: 2, pressed: true }, { atMs: 1_000_050, position: 2, pressed: false }]);
    await Bun.sleep(5); keyboard.fail("synthetic disconnect");
    const saved = await endRecording(app, recording, "t");
    expect(saved.trace.endedBy).toContain("synthetic disconnect");
    const reloaded = sessions(app, layoutId).find((s) => s.id === saved.session.id);
    expect(reloaded?.warnings.join(" ")).toContain("Recording incomplete:");
    expect(reloaded?.eventCount).toBe(2);
    await expect(analyseSession(app, saved.session.id, deps)).rejects.toThrow("recording is incomplete");
    expect(replays).toBe(0);
  } finally { app.db.close(); }
});

test("a saved legacy loss warning refuses timing analysis before replay", async () => {
  const { app, layoutId } = await commandShiftApp();
  let replays = 0;
  const deps: LabDeps = {
    startCapture: async () => ({
      snapshot: () => [],
      ended: Promise.resolve("host"),
      finish: async () => ({
        events: [{ at: 0, position: 2, action: "press" }, { at: 10, position: 2, action: "release" }],
        warnings: ["2 report(s) from the keyboard never arrived, so some key events are missing"],
        endedBy: "host",
      }),
    }),
    replay: () => { replays++; throw new Error("incomplete recordings must never reach replay"); },
  };
  try {
    const recording = await beginRecording(app, layoutId, deps, { text: "test" });
    const saved = await endRecording(app, recording, "t");
    const reloaded = sessions(app, layoutId).find((session) => session.id === saved.session.id);
    expect(reloaded?.warnings).toEqual(["2 report(s) from the keyboard never arrived, so some key events are missing"]);
    await expect(analyseSession(app, saved.session.id, deps)).rejects.toThrow("This recording is incomplete.");
    expect(replays).toBe(0);
  } finally { app.db.close(); }
});
