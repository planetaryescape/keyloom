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
import { tapsFit } from "../../src/web/keyboard/fit.ts";
import { tapWidth } from "../../src/web/keyboard/Keyboard.tsx";
import { qmkFlash, zmkFlash } from "../../src/boards/derive/flash-recipe.ts";
import type { FlashRecipe } from "../../src/boards/recipes.ts";
import type { GeometryKey } from "../../src/boards/schema.ts";
import { firstFlashLine } from "../../src/web/keyboards/first-flash-words.ts";
import { CollectionProblem, rowWayIn } from "../../src/web/keyboards/KeyboardCollection.tsx";
import { PluggedIn } from "../../src/web/keyboards/KeyboardWelcome.tsx";
import { FINGER_LETTERS, NewBoardKeyboard, newBoardHalf } from "../../src/web/keyboards/NewBoardKeyboard.tsx";
import { NewBoardPanel } from "../../src/web/keyboards/NewBoardPanel.tsx";
import { deriveProblem } from "../../src/web/keyboards/derive-words.ts";
import { pageFailure, wayOutFor } from "../../src/web/shell/unexpected.ts";
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
    // Rendered without a stage to measure, the board is drawn at its smallest unit, where the words don't fit: each cap shows the letter,
    // and its accessible name keeps the whole word.
    const html = renderToStaticMarkup(<NewBoardKeyboard board={board} mode="review" homeRow={1} mapped={null} placed={new Set()} onPickRow={() => {}} />);
    expect(html).toContain(">P<");
    expect(html).toContain(">I<");
    expect(html).toContain("left pinky finger");
    expect(html).not.toContain('data-tone="none"');
    // Confirming, the caps stay blank: the home row is the only thing marked.
    const confirm = renderToStaticMarkup(<NewBoardKeyboard board={board} mode="confirm" homeRow={1} mapped={null} placed={new Set()} onPickRow={() => {}} />);
    expect(confirm).not.toContain(">pinky<");
    expect(confirm).not.toContain(">P<");
  });
});

describe("R8-03: failures no screen planned for", () => {
  test("only an exception, an unreadable answer and the catch-all not_found count; a route's own not_found is the screen's", () => {
    // The shared rule these screens now use (D-540): pageFailure keeps the code, wayOutFor picks the buttons.
    const way = (error: unknown) => wayOutFor(pageFailure(error, "x"), true);
    expect(way(new ApiError(500, "x", { code: "internal" }))).toEqual({ retry: true, restart: true });
    expect(way(new ApiError(400, "x", { code: "unreadable" }))).toEqual({ retry: false, restart: true });
    expect(way(new ApiError(404, "x", { code: "not_found", generic: true }))).toEqual({ retry: false, restart: true });
    expect(way(new ApiError(404, "no keyboard", { code: "not_found" }))).toBeNull();
    expect(way(new ApiError(400, "x", { code: "board_known" }))).toBeNull();
    expect(way(new Error("x"))).toBeNull();
  });

  const candidate = { id: "qmk:lily58", name: "Lily58", firmware: "qmk" } as ApiCandidate;
  // SAFETY: the panel reads only these fields of the hook's result while rendering; the rest of its API is never called.
  const reading = (extra: Partial<NewKeyboard>): string => renderToStaticMarkup(<NewBoardPanel sources={[]} onMade={() => {}} flow={{
    token: "t", step: { kind: "confirm", keyboard: null, candidate, homeRow: null, controller: null, layout: null },
    preview: null, addBlocked: null, previewProblem: "keyloom couldn't find what this page asked for.", previewProblemCode: "not_found", previewProblemBoard: null,
    previewFailure: null, putPreview: null, putFailure: null, problem: null, removed: null, searchProblem: null, activities: [], busy: false,
    retryPreview: () => {}, backToCard: () => {}, notNow: () => {}, ...extra,
  } as unknown as NewKeyboard} />);

  test("the new-keyboard Reading step offers Restart keyloom, and Try again only for an exception", () => {
    const mismatch = reading({ previewFailure: { message: "x", code: "not_found", generic: true } });
    expect(mismatch).toContain("Restart keyloom");
    expect(mismatch).not.toContain("Try again");
    const exception = reading({ previewProblemCode: "internal", previewFailure: { message: "x", code: "internal" } });
    expect(exception).toContain("Restart keyloom");
    expect(exception).toContain("Try again");
    // A failure the screen knows, such as GitHub not answering, keeps its own Try again.
    const own = reading({ previewProblemCode: "firmware_unreachable", previewFailure: { message: "x", code: "firmware_unreachable" } });
    expect(own).toContain("Try again");
    expect(own).not.toContain("Restart keyloom");
  });

  test("Your keyboards and the import screen's board list do the same", () => {
    const collection = (code?: string, generic?: true) => renderToStaticMarkup(<CollectionProblem token="t" busy={false} problem={{ text: "x", retry: () => {}, failure: { message: "x", code, generic } }} />);
    expect(collection()).toContain("Try again");
    expect(collection()).not.toContain("Restart keyloom");
    expect(collection("not_found", true)).toContain("Restart keyloom");
    expect(collection("not_found", true)).not.toContain("Try again");
    // A keyboard removed elsewhere is the screen's own not_found: its Try again (and the row's Restore) stay.
    expect(collection("not_found")).toContain("Try again");
    expect(collection("not_found")).not.toContain("Restart keyloom");
    expect(collection("internal")).toContain("Try again");
    const boards = (code?: "unreadable") => renderToStaticMarkup(<BoardsFailed token="t" failure={{ message: "x", code }} onRetry={() => {}} />);
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

describe("PR #307 review", () => {
  // A Planck-style one-piece board: 12 columns, 4 rows, cut between the hands at column 6 with no gap, so a phone shows it whole.
  const FINGER_COLUMNS = ["pinky", "ring", "middle", "index", "index", "index"];
  const grid = {
    keys: Array.from({ length: 48 }, (_, i): GeometryKey => ({ x: i % 12, y: Math.floor(i / 12), w: 1, h: 1, r: 0, rx: 0, ry: 0 })),
    hands: { left: Array.from({ length: 48 }, (_, i) => i).filter((i) => i % 12 < 6), right: Array.from({ length: 48 }, (_, i) => i).filter((i) => i % 12 >= 6) },
    fingers: Object.fromEntries(Array.from({ length: 48 }, (_, i) => {
      const column = i % 12;
      return [String(i), column < 6 ? `left-${FINGER_COLUMNS[column]}` : `right-${FINGER_COLUMNS[11 - column]}`];
    })),
  };
  const word = (finger: string) => finger.replace(/^(left|right)-/, "");
  // What Review's caps would print at this stage: the whole word on every key, or the first letter on every key (NewBoardKeyboard).
  const review = (keys: readonly GeometryKey[], hands: { left: readonly number[]; right: readonly number[] }, fingers: Record<string, string>, display: Parameters<typeof caseParts>[2], half: "left" | "right" | null, stage: { width: number; height: number }) => {
    const positions = half === null ? keys.map((_, p) => p) : [...hands[half]];
    const canvas = canvasAround(positions.flatMap((p) => keys[p] ?? []), caseParts(keys, hands, display, half));
    const { unit } = fitUnit(canvas, stage, MIN_UNIT.preview);
    const taps = (form: (finger: string) => string) => positions.flatMap((p) => {
      const finger = fingers[String(p)];
      const key = keys[p];
      return finger === undefined || key === undefined ? [] : [{ text: form(finger), width: tapWidth(key, canvas) }];
    });
    // Under 44 px a key's legend floor is 10 px (Keyboard.tsx).
    const px = { unit, floor: unit < 44 ? 10 : 11 };
    return { words: tapsFit(taps(word), px), letters: tapsFit(taps((finger) => word(finger).charAt(0).toUpperCase()), px) };
  };

  test("Review never cuts a finger word on a phone: a 12 x 4 one-piece board shows letters, which fit", () => {
    expect(isOnePiece({ hands: grid.hands, display: undefined }, grid.keys)).toBe(true);
    expect(review(grid.keys, grid.hands, grid.fingers, undefined, null, PHONE_STAGE)).toEqual({ words: false, letters: true });
    // On a laptop the same board has room for the words.
    expect(review(grid.keys, grid.hands, grid.fingers, undefined, null, { width: 840, height: 400 }).words).toBe(true);
  });

  for (const { definition: d, geometry } of listBoards()) {
    const keys = applyDisplayRotation(geometry.keys, d.display);
    const views = isOnePiece(d, keys) ? ([null] as const) : (["left", "right"] as const);
    for (const half of views) {
      test(`${d.id}${half === null ? "" : `, ${half} half`}: Review's finger marks fit their caps at 390 px, as words or as letters`, () => {
        expect(review(keys, d.hands, d.fingers, d.display, half, PHONE_STAGE).letters).toBe(true);
      });
    }
  }

  test("Review's lead says what each letter means", () => {
    expect(FINGER_LETTERS).toContain("P pinky, R ring, M middle, I index, T thumb");
  });

  test("a phone halves the new board by the new board's own shape, not the open config's", () => {
    const corne = listBoards().find(({ definition }) => definition.id === "foostan/corne");
    if (corne === undefined) throw new Error("foostan/corne is not shipped");
    const split = { keys: applyDisplayRotation(corne.geometry.keys, corne.definition.display), hands: corne.definition.hands };
    expect(newBoardHalf(true, grid, undefined, "left")).toBeNull();
    expect(newBoardHalf(true, split, undefined, "right")).toBe("right");
    expect(newBoardHalf(false, split, undefined, "right")).toBeNull();
    expect(newBoardHalf(true, null, undefined, "left")).toBeNull();
  });

  test("every flash recipe reads as one sentence, central and peripheral halves included", () => {
    // As the preview route turns a recipe into steps (src/app/keyboard-add.ts, `flash.steps`).
    const steps = (flash: FlashRecipe | undefined): string[] => flash?.kind === "uf2-drives" ? flash.steps.map((step) => step.enter) : flash?.kind === "dfu-tool" ? [flash.enter] : [];
    const qmk = ["rp2040", "stm32-dfu", "caterina", "atmel-dfu"].map((bootloader) => qmkFlash(bootloader, undefined, "atmega32u4").flash);
    const zmk = ["nice_nano//zmk", "rpi_pico//zmk"].flatMap((controller) => [["corne_left", "corne_right"], ["dongle_central", "dongle_peripheral"], ["kb_lh", "kb_rh"], ["one"]].map((siblings) => zmkFlash(controller, siblings)));
    const lines = [...qmk, ...zmk].map((flash) => firstFlashLine(steps(flash)));
    expect(lines.length).toBe(12);
    for (const line of lines) {
      expect(line).toStartWith("Build and flash, then ");
      expect(line).not.toMatch(/each half, plug in/i);
      expect(line).not.toMatch(/\b(left|right|central|peripheral) half and\b/);
    }
    expect(firstFlashLine(steps(zmkFlash("nice_nano//zmk", ["dongle_central", "dongle_peripheral"]))))
      .toBe("Build and flash, then on each half, double-tap its reset button when it asks.");
    expect(firstFlashLine(steps(zmkFlash("rpi_pico//zmk", ["one"])))).toBe("Build and flash, then plug it in and hold BOOTSEL while plugging in the USB cable when it asks.");
  });

  test("Your keyboards' Try again beside Restart keyloom is off while another action runs", () => {
    const html = (busy: boolean) => renderToStaticMarkup(<CollectionProblem token="t" busy={busy} problem={{ text: "x", retry: () => {}, failure: { message: "x", code: "internal" } }} />);
    expect(html(true)).toMatch(/<button[^>]*disabled=""[^>]*>.*Try again/);
    expect(html(false)).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Try again/);
  });
});
