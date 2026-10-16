// The typing lab on the real firmware (D-282): recordings replayed through QMK's own core and ZMK's own build in Docker. Gated: Docker, the
// pinned checkouts and images, and about 15 to 25 seconds per emulator run.
//   KEYLOOM_DOCKER_TESTS=lab-qmk bun test test/lab/emulator.docker.test.ts      (or lab-zmk, or 1 for both)
//
// S53: an emulator-generated "typing" of a passage is recorded through the firmware's own wire format (raw HID reports for the Moonlander,
// serial lines for ZMK), decoded by the host readers, prepared the way the lab prepares a trace and replayed; what comes back must be what
// the firmware did with the original keys, report for report. The other half of S53, a real keyboard's output against its own replay, is the
// hardware runbook (docs/research/spikes/S53.md).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { applyOps, getLayout, importLayout, openApp } from "../../src/app/index.ts";
import { realLabDeps } from "../../src/app/lab.ts";
import type { LayoutView } from "../../src/app/layouts.ts";
import type { TraceEvent } from "../../src/firmware/emulate/trace.ts";
import type { EmulatorEvent } from "../../src/firmware/emulate/types.ts";
import { startQmkCapture } from "../../src/firmware/qmk/typing-capture.ts";
import { LogSink } from "../../src/firmware/toolchain/run.ts";
import { startZmkCapture } from "../../src/firmware/zmk/typing-capture.ts";
import { type Analysis, analyse } from "../../src/lab/analyse.ts";
import { intentSteps } from "../../src/lab/intent.ts";
import type { Passage } from "../../src/lab/passage-types.ts";
import { prepareEvents } from "../../src/lab/replay-input.ts";
import { applyOps as applyLayoutOps } from "../../src/layout/apply-ops.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { fakeGlove, fakeMoonlander, moonlanderInterface } from "../helpers/fake-key-stream.ts";
import { type Stroke, eventsOf, letterPositions, syntheticTyping } from "../helpers/typing-lab.ts";
import { tempDir } from "../helpers/tmp.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";

const which = process.env.KEYLOOM_DOCKER_TESTS ?? "";
const qmk = ["1", "lab-qmk"].includes(which) ? describe : describe.skip;
const zmk = ["1", "lab-zmk"].includes(which) ? describe : describe.skip;
const TIMEOUT = 290_000;
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

type World = { app: ReturnType<typeof openApp>; view: LayoutView; replay: ReturnType<ReturnType<typeof realLabDeps>["replay"]>; log: LogSink };

function worldOf(app: ReturnType<typeof openApp>, layoutId: string): World {
  const view = getLayout(app, layoutId);
  const log = new LogSink(join(tempDir(), "lab.log"));
  const boardRevision = (view.board.definition.revisions[0] as { id: string }).id;
  return { app, view, log, replay: realLabDeps().replay(app, view, boardRevision, { log }) };
}

/** What the firmware sent for these keys, and the same recording after a trip over the wire. */
async function s53(w: World, passage: Passage, wire: (events: EmulatorEvent[]) => Promise<TraceEvent[]>) {
  const doc = w.view.document;
  const { steps } = intentSteps(passage, doc, w.view.board.definition);
  const original = eventsOf(syntheticTyping(steps));
  const recorded = await w.replay(doc, original);
  const trace = await wire(original);
  const prepared = prepareEvents(trace);
  expect(prepared).toEqual(prepareEvents(original));
  const replayed = await w.replay(doc, prepared);
  return { original, recorded, trace, replayed, prepared };
}

qmk("the Moonlander on QMK's real core", () => {
  async function moonlander() {
    const fixture = (await import("../helpers/command-shift.ts")).commandShiftApp;
    const { app, layoutId } = await fixture();
    return { app, layoutId };
  }

  const wireQmk = async (events: EmulatorEvent[]) => {
    const kb = fakeMoonlander();
    const capture = await startQmkCapture(kb.transport, moonlanderInterface(), { keepaliveMs: 1000 });
    kb.press(events.map((e) => ({ position: e.position, pressed: e.action === "press", atMs: 1_000_000 + e.at })));
    await tick(30);
    return (await capture.finish()).events;
  };

  test("S53: the raw HID round trip and the replay reproduce the firmware's reports exactly", async () => {
    const { app, layoutId } = await moonlander();
    const w = worldOf(app, layoutId);
    const passage: Passage = {
      id: "s53", title: "s53", why: "",
      steps: [{ kind: "text", text: "sd fj sd" }, { kind: "hold", key: "s", then: "k" }, { kind: "text", text: " as" }, { kind: "hold", key: "f", then: "k" }],
    };
    const r = await s53(w, passage, wireQmk);
    expect(r.recorded.reports.length).toBeGreaterThan(10);
    expect(r.replayed.reports).toEqual(r.recorded.reports);
    expect(r.replayed.text).toBe(r.recorded.text);
    // The S-then-K holds put Option and Command on K: the recording is not just letters.
    expect(r.recorded.reports.some((rep) => rep.kind === "keyboard" && rep.mods.includes("LALT") && rep.keys.includes("K"))).toBe(true);
    // And the analysis agrees with what the keyboard typed here: no differing characters.
    const a = await analyse({ board: w.view.board.definition, layout: w.view.document, passage, events: r.trace, typedText: r.recorded.text, replay: w.replay, suggest: false });
    expect(a.fidelity?.differing).toBe(0);
    console.log(`S53 QMK: ${r.original.length} events, ${r.recorded.reports.length} reports, text ${JSON.stringify(r.recorded.text)}`);
  }, TIMEOUT);

  test("rolls held past the tapping term misfire on the real core, the search finds a setting that fixes them, and the fix holds when replayed", async () => {
    const { app, layoutId } = await moonlander();
    const view = getLayout(app, layoutId);
    // BK's chordal and permissive hold off, and every hold-tap profile back to QMK's 200 ms, so a roll that outlasts the term is a hold.
    applyOps(app, layoutId, {
      baseRevisionId: view.revision.id, summary: "plain tap-hold",
      ops: [
        { op: "removeFirmwareSetting", firmware: "qmk", key: "CHORDAL_HOLD" },
        { op: "removeFirmwareSetting", firmware: "qmk", key: "PERMISSIVE_HOLD" },
        ...view.document.holdTapProfiles.map((p) => ({ op: "upsertHoldTapProfile" as const, profile: { ...p, options: {} } })),
      ],
    });
    const w = worldOf(app, layoutId);
    const at = letterPositions(w.view.document);
    const strokes: Stroke[] = Array.from({ length: 4 }, (_, i) => [
      { position: at.s as number, down: i * 450, up: i * 450 + 260 },
      { position: at.d as number, down: i * 450 + 150, up: i * 450 + 190 },
    ]).flat();
    const passage: Passage = { id: "rolls", title: "rolls", why: "", steps: [{ kind: "text", text: "sdsdsdsd" }] };
    const a: Analysis = await analyse({ board: w.view.board.definition, layout: w.view.document, passage, events: eventsOf(strokes), replay: w.replay, maxRuns: 4 });
    expect(a.counts.misfireHold).toBe(4);
    expect(a.findings[0]?.sentence).toContain("Option fired 4 times when you meant to type S");
    expect(a.suggestions.length).toBeGreaterThan(0);
    const best = a.suggestions[0];
    expect(best?.evidence).toMatchObject({ before: 4, after: 0, removed: 4, introduced: 0 });
    // The proof: change the layout the way the suggestion says and replay the same keys through the real core.
    const fixed = applyLayoutOps(w.view.document, best?.ops ?? []);
    if (!fixed.ok) throw new Error("the suggestion's ops did not apply");
    const again = await analyse({ board: w.view.board.definition, layout: fixed.layout, passage, events: eventsOf(strokes), replay: w.replay, suggest: false });
    expect(again.counts.misfireHold).toBe(0);
    console.log(`QMK search: ${a.emulatorRuns} emulator runs, best "${best?.candidate.title}", ${a.suggestions.length} suggestion(s); notes ${JSON.stringify(a.notes)}`);
  }, TIMEOUT);
});

zmk("the Glove80 on ZMK's real build", () => {
  async function glove() {
    const app = openApp({ dataDir: tempDir() });
    const { layoutId } = await importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "style" });
    return { app, layoutId };
  }

  const wireZmk = (right: readonly number[]) => async (events: EmulatorEvent[]) => {
    const kb = fakeGlove();
    const capture = await startZmkCapture(kb.transport, "/fake/cu.usbmodem1", { keepaliveMs: 1000 });
    // The right half's keys arrive from the peripheral (source 0); the left half's are the central's own (255).
    kb.press(events.map((e) => ({ position: e.position, pressed: e.action === "press", ms: e.at, source: right.includes(e.position) ? 0 : 255 })));
    await tick(30);
    return (await capture.finish()).events;
  };

  test("S53: the serial round trip and the replay reproduce the firmware's reports exactly", async () => {
    const { app, layoutId } = await glove();
    const w = worldOf(app, layoutId);
    const passage: Passage = {
      id: "s53", title: "s53", why: "",
      steps: [{ kind: "text", text: "sd fj sd" }, { kind: "hold", key: "s", then: "k" }, { kind: "text", text: " as" }, { kind: "hold", key: "f", then: "j" }],
    };
    const r = await s53(w, passage, wireZmk(w.view.board.definition.hands.right));
    expect(r.recorded.reports.length).toBeGreaterThan(10);
    expect(r.replayed.reports).toEqual(r.recorded.reports);
    expect(r.replayed.text).toBe(r.recorded.text);
    expect(r.trace.some((e) => e.source === 0)).toBe(true);
    expect(r.trace.some((e) => e.source === 255)).toBe(true);
    const a = await analyse({ board: w.view.board.definition, layout: w.view.document, passage, events: r.trace, typedText: r.recorded.text, replay: w.replay, suggest: false });
    expect(a.fidelity?.differing).toBe(0);
    console.log(`S53 ZMK: ${r.original.length} events, ${r.recorded.reports.length} reports, text ${JSON.stringify(r.recorded.text)}`);
  }, TIMEOUT);

  test("a hold-preferred home row mod misfires in rolls on the real build, and the positional hold the search proposes removes them", async () => {
    const { app, layoutId } = await glove();
    const view = getLayout(app, layoutId);
    applyOps(app, layoutId, {
      baseRevisionId: view.revision.id, summary: "untuned home row mods",
      ops: view.document.holdTapProfiles.filter((p) => p.id === "hm").map((p) => ({ op: "upsertHoldTapProfile" as const, profile: { ...p, options: { bindings: "&kp &kp", flavor: "hold-preferred", "tapping-term-ms": 200 } } })),
    });
    const w = worldOf(app, layoutId);
    const at = letterPositions(w.view.document);
    const strokes: Stroke[] = Array.from({ length: 4 }, (_, i) => [
      { position: at.s as number, down: i * 450, up: i * 450 + 260 },
      { position: at.d as number, down: i * 450 + 150, up: i * 450 + 190 },
    ]).flat();
    const passage: Passage = { id: "rolls", title: "rolls", why: "", steps: [{ kind: "text", text: "sdsdsdsd" }] };
    const a = await analyse({ board: w.view.board.definition, layout: w.view.document, passage, events: eventsOf(strokes), replay: w.replay, maxRuns: 4 });
    expect(a.counts.misfireHold).toBe(4);
    const best = a.suggestions[0];
    expect(best?.evidence).toMatchObject({ before: 4, after: 0, removed: 4, introduced: 0 });
    const fixed = applyLayoutOps(w.view.document, best?.ops ?? []);
    if (!fixed.ok) throw new Error("the suggestion's ops did not apply");
    const again = await analyse({ board: w.view.board.definition, layout: fixed.layout, passage, events: eventsOf(strokes), replay: w.replay, suggest: false });
    expect(again.counts.misfireHold).toBe(0);
    console.log(`ZMK search: ${a.emulatorRuns} emulator runs, best "${best?.candidate.title}", ${a.suggestions.length} suggestion(s); notes ${JSON.stringify(a.notes)}`);
  }, TIMEOUT);
});
