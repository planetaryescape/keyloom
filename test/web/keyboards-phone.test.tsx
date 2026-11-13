// Round 8 (R8-02, R8-03, R8-06 to R8-08, R8-15, R8-18): the new-keyboard steps fit a phone, unexpected failures on the keyboard screens
// offer Restart keyloom, and the first-run words say only what is true.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiCandidate, DetectedKeyboard } from "../../src/api/detected-keyboards.ts";
import type { BoardChoice } from "../../src/api/http.ts";
import type { PreviewResponse } from "../../src/api/keyboards.ts";
import { isOnePiece } from "../../src/boards/one-piece.ts";
import { listBoards } from "../../src/boards/registry.ts";
import { ApiError } from "../../src/web/api.ts";
import { importIntro } from "../../src/web/import/export-steps.ts";
import { BoardsFailed } from "../../src/web/import/ImportScreen.tsx";
import { canvasAround } from "../../src/web/keyboard/canvas.ts";
import { caseParts } from "../../src/web/keyboard/case-shape.ts";
import { applyDisplayRotation } from "../../src/web/keyboard/geometry.ts";
import { MIN_UNIT, fitUnit } from "../../src/web/keyboard/useFitUnit.ts";
import { firstFlashLine } from "../../src/web/keyboards/first-flash-words.ts";
import { CollectionProblem, rowWayIn } from "../../src/web/keyboards/KeyboardCollection.tsx";
import { PluggedIn } from "../../src/web/keyboards/KeyboardWelcome.tsx";
import { NewBoardKeyboard } from "../../src/web/keyboards/NewBoardKeyboard.tsx";
import { NewBoardPanel } from "../../src/web/keyboards/NewBoardPanel.tsx";
import { deriveProblem } from "../../src/web/keyboards/derive-words.ts";
import { unexpectedCodeOf } from "../../src/web/keyboards/unexpected-code.ts";
import type { NewKeyboard } from "../../src/web/keyboards/useNewKeyboard.ts";

// The new-keyboard stage's content box on a 390 x 844 phone, measured in the first-run screen: the well is 318 px wide and 300 px tall
// (collection.css), with 12 px of padding each side.
const PHONE_STAGE = { width: 294, height: 276 };

describe("R8-02: the new-keyboard drawing on a phone", () => {
  for (const { definition: d, geometry } of listBoards()) {
    const keys = applyDisplayRotation(geometry.keys, d.display);
    const views = isOnePiece(d, keys) ? ([null] as const) : (["left", "right"] as const);
    for (const half of views) {
      test(`${d.id}${half === null ? "" : `, ${half} half`} shows whole at 390 px, where a fingertip's 44 px key cut it off`, () => {
        const shown = half === null ? keys : keys.filter((_, p) => d.hands[half].includes(p));
        const canvas = canvasAround(shown, caseParts(keys, d.hands, d.display, half));
        expect(fitUnit(canvas, PHONE_STAGE, MIN_UNIT.preview).overflowing).toBe(false);
        expect(fitUnit(canvas, PHONE_STAGE, MIN_UNIT.touch).overflowing).toBe(true);
      });
    }
  }

  test("Review prints each key's finger, which a blank key's tone would hide", () => {
    const board = {
      keys: [{ x: 0, y: 0, w: 1, h: 1, r: 0, rx: 0, ry: 0 }, { x: 1, y: 0, w: 1, h: 1, r: 0, rx: 0, ry: 0 }],
      hands: { left: [0], right: [1] }, fingers: { "0": "left-pinky", "1": "right-index" }, rows: [{ name: "1", positions: [0, 1] }],
    };
    const html = renderToStaticMarkup(<NewBoardKeyboard board={board} mode="review" homeRow={1} mapped={null} placed={new Set()} onPickRow={() => {}} />);
    expect(html).toContain(">pinky<");
    expect(html).toContain(">index<");
    expect(html).not.toContain('data-tone="none"');
    // Confirming, the caps stay blank: the home row is the only thing marked.
    expect(renderToStaticMarkup(<NewBoardKeyboard board={board} mode="confirm" homeRow={1} mapped={null} placed={new Set()} onPickRow={() => {}} />)).not.toContain(">pinky<");
  });
});

describe("R8-03: failures no screen planned for", () => {
  test("only an exception, an unreadable answer and the catch-all not_found count; a route's own not_found is the screen's", () => {
    expect(unexpectedCodeOf(new ApiError(500, "x", { code: "internal" }))).toBe("internal");
    expect(unexpectedCodeOf(new ApiError(400, "x", { code: "unreadable" }))).toBe("unreadable");
    expect(unexpectedCodeOf(new ApiError(404, "x", { code: "not_found", generic: true }))).toBe("not_found");
    expect(unexpectedCodeOf(new ApiError(404, "no keyboard", { code: "not_found" }))).toBeUndefined();
    expect(unexpectedCodeOf(new ApiError(400, "x", { code: "board_known" }))).toBeUndefined();
    expect(unexpectedCodeOf(new Error("x"))).toBeUndefined();
  });

  const candidate = { id: "qmk:lily58", name: "Lily58", firmware: "qmk" } as ApiCandidate;
  // SAFETY: the panel reads only these fields of the hook's result while rendering; the rest of its API is never called.
  const reading = (extra: Partial<NewKeyboard>): string => renderToStaticMarkup(<NewBoardPanel sources={[]} onMade={() => {}} flow={{
    token: "t", step: { kind: "confirm", keyboard: null, candidate, homeRow: null, controller: null, layout: null },
    preview: null, addBlocked: null, previewProblem: "keyloom couldn't find what this page asked for.", previewProblemCode: "not_found", previewProblemBoard: null,
    previewUnexpected: undefined, putPreview: null, putFailure: null, problem: null, removed: null, searchProblem: null, activities: [], busy: false,
    retryPreview: () => {}, backToCard: () => {}, notNow: () => {}, ...extra,
  } as unknown as NewKeyboard} />);

  test("the new-keyboard Reading step offers Restart keyloom, and Try again only for an exception", () => {
    const mismatch = reading({ previewUnexpected: "not_found" });
    expect(mismatch).toContain("Restart keyloom");
    expect(mismatch).not.toContain("Try again");
    const exception = reading({ previewProblemCode: "internal", previewUnexpected: "internal" });
    expect(exception).toContain("Restart keyloom");
    expect(exception).toContain("Try again");
    // A failure the screen knows, such as GitHub not answering, keeps its own Try again.
    const own = reading({ previewProblemCode: "firmware_unreachable" });
    expect(own).toContain("Try again");
    expect(own).not.toContain("Restart keyloom");
  });

  test("Your keyboards and the import screen's board list do the same", () => {
    const collection = (code?: "internal" | "not_found") => renderToStaticMarkup(<CollectionProblem token="t" busy={false} problem={{ text: "x", retry: () => {}, code }} />);
    expect(collection()).toContain("Try again");
    expect(collection()).not.toContain("Restart keyloom");
    expect(collection("not_found")).toContain("Restart keyloom");
    expect(collection("not_found")).not.toContain("Try again");
    expect(collection("internal")).toContain("Try again");
    const boards = (code?: "unreadable") => renderToStaticMarkup(<BoardsFailed token="t" message="x" code={code} onRetry={() => {}} />);
    expect(boards()).toContain("Try again");
    expect(boards("unreadable")).toContain("Restart keyloom");
    expect(boards("unreadable")).not.toContain("Try again");
  });
});

describe("R8-06: a keyboard left with Later", () => {
  test("Your keyboards offers Set up for a keyboard with no config, and Open for one with a config", () => {
    expect(rowWayIn({ layoutId: "l1", configCount: 1 }, true)).toBe("open");
    expect(rowWayIn({ layoutId: null, configCount: 0 }, true)).toBe("set_up");
    expect(rowWayIn({ layoutId: null, configCount: 0 }, false)).toBeNull();
  });
});

describe("R8-07 and R8-08: the first flash on Review", () => {
  test("keeps key names as written and says a two-sentence step as written, without a second 'when it asks'", () => {
    expect(firstFlashLine(["Press the QK_BOOT key, press the RESET button on the PCB, or short RST to GND."]))
      .toBe("Build and flash, then press the QK_BOOT key, press the RESET button on the PCB, or short RST to GND when it asks.");
    const caterina = "Press the QK_BOOT key or the RESET button, or short RST to GND (some boards need it twice within 750 ms). The bootloader only waits about 7 seconds, so keyloom is ready first.";
    expect(firstFlashLine([caterina])).toBe(`Build and flash, then do this when it asks: ${caterina}`);
    expect(firstFlashLine(["Plug in the left half and double-tap reset.", "Plug in the right half and double-tap reset."])).toBe("Build and flash, then on each half, double-tap reset when it asks.");
    expect(firstFlashLine([])).toBe("Build and flash, then put the keyboard in its bootloader when it asks.");
    expect(firstFlashLine(["RST to GND twice."])).toBe("Build and flash, then RST to GND twice when it asks.");
  });

  test("a board keyloom can't add doesn't also promise to sync it", () => {
    const candidate = { id: "qmk:atomic", name: "Atomic", firmware: "qmk" } as ApiCandidate;
    const board = { name: "Atomic", keys: [], hands: { left: [], right: [] }, fingers: {}, thumbs: [], rows: 5, homeRow: 3, flash: { kind: "dfu-tool", manualReason: null, steps: ["Press the QK_BOOT key."] }, assumedController: null };
    const review = (addBlocked: NewKeyboard["addBlocked"]) => renderToStaticMarkup(<NewBoardPanel sources={[]} onMade={() => {}} flow={{
      token: "t", step: { kind: "review", keyboard: null, candidate, homeRow: 3, controller: null, layout: null },
      preview: { displayName: "Atomic", layouts: [], controllers: [], rows: [], board } as unknown as PreviewResponse,
      addBlocked, previewProblem: null, previewProblemCode: null, previewProblemBoard: null, putPreview: null, putFailure: null, problem: null, removed: null,
      searchProblem: null, activities: [], busy: false,
    } as unknown as NewKeyboard} />);
    expect(review(null)).toContain("keyloom can sync your Atomic for you");
    const blocked = review(deriveProblem("board_check_failed", "Atomic"));
    expect(blocked).toContain("can&#x27;t add it yet");
    expect(blocked).not.toContain("keyloom can sync");
    expect(blocked).not.toContain("won&#x27;t flash from here");
  });
});

describe("R8-15: a plugged-in keyboard put off on first run", () => {
  test("stays one press away under the search", () => {
    const keyboard = { device: { vendorId: "4653", productId: "0001", product: "Lily58", maker: "x", bcdDevice: null, serial: null }, status: "candidates", knownBoard: null, candidates: [], ambiguous: false, next: "" } satisfies DetectedKeyboard;
    expect(renderToStaticMarkup(<PluggedIn waiting={[keyboard]} onReopen={() => {}} />)).toContain("Set up the keyboard you plugged in (Lily58)");
    expect(renderToStaticMarkup(<PluggedIn waiting={[]} onReopen={() => {}} />)).toBe("");
  });
});

describe("R8-18: the import intro", () => {
  const board = (id: string, firmware: BoardChoice["firmware"], importers: string[], extra: Partial<BoardChoice> = {}): BoardChoice => ({ id, name: id, vendor: "v", firmware, keyCount: 42, importers, ...extra });
  const macbook = board("apple/macbook-ansi", "kanata", ["karabiner-json"]);
  const corne = board("foostan/corne", "zmk", ["zmk-keymap"], { keymapFile: "config/corne.keymap" });
  const moonlander = board("zsa/moonlander", "qmk", ["oryx-source"]);
  const glove = board("moergo/glove80", "zmk", ["zmk-layout-editor-keymap"]);

  test("says where the one card shown gets its layout, and only an editor's card says Export", () => {
    expect(importIntro([moonlander])).toStartWith("Export your layout from Oryx and drop the file on its card.");
    expect(importIntro([glove])).toStartWith("Export your layout from the Layout Editor");
    expect(importIntro([corne])).toStartWith("Drop the file from your ZMK config on its card.");
    expect(importIntro([macbook])).toStartWith("Read your Karabiner-Elements settings from this Mac");
    expect(importIntro([macbook])).toContain("nothing changes on your MacBook until you apply a change");
    for (const one of [corne, macbook]) expect(importIntro([one])).not.toContain("own editor");
  });

  test("with every card shown, says each card says where its layout comes from", () => {
    const all = importIntro([moonlander, glove, corne, macbook]);
    expect(all).toStartWith("Each card says where that keyboard's layout comes from");
    expect(all).not.toContain("own editor");
  });
});
