import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LabStage } from "../../src/web/lab/LabScreens.tsx";
import type { Lab } from "../../src/web/lab/useLab.ts";
import { labApplyFailure, labFixClosed, labFixes, labProblemText } from "../../src/web/lab/lab-words.ts";

const fixes = { onSync: () => {}, onOpenRelease: () => {}, onOpenInputMonitoring: () => {} };
const baseLab = (over: Partial<Lab>): Lab => ({
  token: "t", phase: { kind: "start" }, passages: [], canRecord: { ok: true, why: null }, sessions: [], typed: "", problem: null, problemCode: null, loadFailed: false, reload: () => {},
  setTyped: () => {}, start: async () => {}, retry: async () => {}, stop: async () => {}, cancel: async () => {},
  showSession: async () => {}, remove: async () => {}, openFinding: () => {}, tryFix: () => {}, again: () => {}, readAgain: null, ...over,
});

for (const phone of [false, true]) {
  test(`saved incomplete recording remains visible on ${phone ? "phone" : "desktop"}`, () => {
    const lab = baseLab({ problem: "This recording is incomplete. Start a new recording; the partial recording is still saved." });
    const html = renderToStaticMarkup(<LabStage lab={lab} boardName="Moonlander" phone={phone} onClose={() => {}} onType={() => {}} fixes={fixes} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("This recording is incomplete.");
    expect(html).toContain("partial recording is still saved");
    if (phone) expect(html).not.toContain("Start listening");
    else expect(html).toContain("Start listening");
  });
}

test("a keyboard whose firmware can't stream offers Sync now and Build and flash beside the problem (R1-19)", () => {
  expect(labFixes("needs_sync", false).map((f) => f.label)).toEqual(["Sync now", "Build and flash…"]);
  expect(labFixes("usage", false)).toEqual([]);
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ problem: "the connected ZSA keyboard isn't running a keyloom build", problemCode: "needs_sync" })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(html).toContain("Sync now");
  expect(html).toContain("Build and flash…");
});

test("a lab that failed to load says so with Try again (R1-28)", () => {
  expect(labFixes(null, true)).toEqual([{ id: "reload", label: "Try again" }]);
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ problem: "keyloom couldn't load the typing lab.", loadFailed: true })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(html).toContain("Try again");
});

test("firmware keyloom didn't build offers Build and flash only, never a Sync now that would be refused (R1-19)", () => {
  expect(labFixes("foreign_firmware", false)).toEqual([{ id: "open_release", label: "Build and flash…" }]);
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ problem: "the connected ZSA keyboard isn't running a keyloom build", problemCode: "foreign_firmware" })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(html).toContain("Build and flash…");
  expect(html).not.toContain("Sync now");
});

test("macOS's refusal opens Input Monitoring and offers Try again, in the page's own words (R3-09)", () => {
  expect(labFixes("permission_input_monitoring", false).map((f) => f.label)).toEqual(["Open Input Monitoring settings", "Try again"]);
  const server = "macOS didn't let keyloom read the keyboard. Allow keyloom in System Settings > Privacy & Security > Input Monitoring, then try again.";
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ problem: server, problemCode: "permission_input_monitoring" })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(html).toContain("Open Input Monitoring settings");
  expect(html).not.toContain("System Settings &gt;");
});

test("a failed Apply of a lab fix says why and how to go on (R3-02)", () => {
  expect(labApplyFailure({ code: "stale_base", message: "x" }).next).toBe("again");
  expect(labApplyFailure({ code: "validation_failed", message: "x" }).next).toBe("again");
  expect(labApplyFailure({ message: "Failed to fetch" })).toEqual({ text: "keyloom couldn't apply this fix. Failed to fetch", next: "retry" });
  // The server's sentence names a change-set ID; a fix that is no longer proposed fails the same way every time, so the way on is Type again.
  const closed = labApplyFailure({ code: "usage", message: "change set cs_1 is applied, not proposed" });
  expect(closed.next).toBe("again");
  expect(closed.text).not.toContain("cs_1");
});

test("a past session's fix that is no longer proposed says why instead of offering Apply", () => {
  expect(labFixClosed("proposed")).toBeNull();
  for (const status of ["applied", "superseded", "rejected"] as const) expect(labFixClosed(status)).toContain("Type again");
  expect(labFixClosed("applied")).toContain("applied already");
});

test("a keyboard connection that stopped answering offers Try again, which gets a new one (R4-03)", () => {
  expect(labFixes("connection_lost", false)).toEqual([{ id: "retry", label: "Try again" }]);
});

test("a connection only a restart clears offers Restart keyloom, never Try again (R5-15)", () => {
  expect(labFixes("restart_required", false)).toEqual([{ id: "restart", label: "Restart keyloom" }]);
  expect(labProblemText("restart_required", "Quit keyloom and open it again, then try again.")).toContain("only restarting keyloom clears it");
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ problem: "stuck", problemCode: "restart_required" })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  // Rendered before the server says how keyloom was started: the button waits for that answer.
  expect(html).toContain("Restart keyloom");
  expect(html).not.toContain("Try again");
});

test("an incomplete recording in Earlier sessions says why it can't be read and is no button; a whole one opens (R4-14)", () => {
  const session = (id: string, incomplete: boolean) => ({ id, layoutId: "lay", passageId: "p", startedAt: 1, endedAt: 60_001, eventCount: 3, analysed: false, warnings: [], incomplete });
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ sessions: [session("a", true), session("b", false)] })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(html).toContain("incomplete, so it can&#x27;t be read");
  expect(html).toMatch(/<span class="lab-past-row" data-incomplete="true">/);
  expect(html).toMatch(/<button type="button" class="lab-past-row">/);
});

test("a read-out Docker stopped shows the Docker callout, never \"internal error\" (R6-02)", () => {
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ problem: "Docker is not on this computer.", problemCode: "docker_unavailable", readAgain: () => undefined })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(html).toContain("in Docker, and Docker isn&#x27;t ready on this computer. Your recording is saved.");
  expect(html).not.toContain("internal error");
  // No Try again: the callout's own Install or Start is the way on, and Read it again appears once Docker answers.
  expect(html).not.toContain("Try again");
});

test("any other replay failure says so in words, keeps the recording, and offers Read it again (R6-02)", () => {
  expect(labFixes("replay_failed", false)).toEqual([{ id: "read_again", label: "Read it again" }]);
  expect(labProblemText("replay_failed", "the emulator image didn't download")).toBe("keyloom couldn't play your recording back through the board's firmware. the emulator image didn't download. Your recording is saved.");
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ problem: "the emulator image didn't download", problemCode: "replay_failed", readAgain: () => undefined })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(html).toContain("Read it again");
  // With no session to read again, the button would do nothing, so it isn't offered.
  const none = renderToStaticMarkup(<LabStage lab={baseLab({ problem: "x", problemCode: "replay_failed" })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(none).not.toContain("Read it again");
});

test("a Cancel that failed, or a start refused because a recording runs, offers Stop that recording, never Try again (R6-20)", () => {
  for (const code of ["cancel_failed", "recording_running"]) expect(labFixes(code, false)).toEqual([{ id: "stop_recording", label: "Stop that recording" }]);
  // Another app holding the keyboard is not a recording keyloom can stop: it keeps Try again.
  expect(labFixes("busy", false)).toEqual([{ id: "retry", label: "Try again" }]);
  expect(labProblemText("cancel_failed", "The server didn't answer.")).toBe("keyloom couldn't stop listening, so it may still be recording your keyboard. The server didn't answer.");
  const html = renderToStaticMarkup(<LabStage lab={baseLab({ problem: "A recording is already running. Stop it first.", problemCode: "recording_running" })} boardName="Moonlander" phone={false} onClose={() => {}} onType={() => {}} fixes={fixes} />);
  expect(html).toContain("Stop that recording");
  expect(html).not.toContain("Try again");
});
