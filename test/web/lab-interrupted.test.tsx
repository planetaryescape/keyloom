import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LabStage } from "../../src/web/lab/LabScreens.tsx";
import type { Lab } from "../../src/web/lab/useLab.ts";
import { labApplyFailure, labFixClosed, labFixes } from "../../src/web/lab/lab-words.ts";

const fixes = { onSync: () => {}, onOpenRelease: () => {}, onOpenInputMonitoring: () => {} };
const baseLab = (over: Partial<Lab>): Lab => ({
  phase: { kind: "start" }, passages: [], canRecord: { ok: true, why: null }, sessions: [], typed: "", problem: null, problemCode: null, loadFailed: false, reload: () => {},
  setTyped: () => {}, start: async () => {}, retry: async () => {}, stop: async () => {}, cancel: async () => {},
  showSession: async () => {}, remove: async () => {}, openFinding: () => {}, tryFix: () => {}, again: () => {}, ...over,
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
