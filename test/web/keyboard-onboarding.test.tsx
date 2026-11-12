// Round 7 (R7-10, R7-11, R7-13): the first-run keyboard steps offer only what can be done, and say what happens to each kind of
// keyboard in its own words.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiCandidate } from "../../src/api/detected-keyboards.ts";
import type { BoardChoice } from "../../src/api/http.ts";
import type { PreviewResponse } from "../../src/api/keyboards.ts";
import { ApiError } from "../../src/web/api.ts";
import { guideFor } from "../../src/web/import/export-steps.ts";
import { cardsFor } from "../../src/web/import/ImportScreen.tsx";
import { deriveProblem } from "../../src/web/keyboards/derive-words.ts";
import { NewBoardPanel, type PutSource } from "../../src/web/keyboards/NewBoardPanel.tsx";
import { setupFoot, setupWrites, welcomeLead } from "../../src/web/keyboards/onboarding-words.ts";
import { SetupCard } from "../../src/web/keyboards/SetupCard.tsx";
import { blankBoardFor, blockedAdd, type NewKeyboard } from "../../src/web/keyboards/useNewKeyboard.ts";

const candidate = { id: "qmk:zsa/moonlander", name: "Moonlander Mark I", firmware: "qmk" } as ApiCandidate;
// SAFETY: the panels read only these fields of the hook's result while rendering; the rest of its API is never called.
const flow = (extra: Partial<NewKeyboard>): NewKeyboard => ({
  step: { kind: "confirm", keyboard: null, candidate, homeRow: null, controller: null, layout: null },
  preview: null, addBlocked: null, previewProblem: null, previewProblemCode: null, previewProblemBoard: null, putPreview: null, putFailure: null, problem: null,
  removed: null, searchProblem: null, activities: [], busy: false, ...extra,
}) as unknown as NewKeyboard;
const daily: PutSource = { id: "a", name: "Daily", boardName: "Glove80", boardId: "moergo/glove80", note: null };
const onMoonlander: PutSource = { id: "b", name: "Moon", boardName: "Moonlander", boardId: "zsa/moonlander", note: null };
const render = (f: NewKeyboard, sources: PutSource[], onImport?: (board: string | null) => void) =>
  renderToStaticMarkup(<NewBoardPanel flow={f} sources={sources} onMade={() => {}} onImport={onImport} />);
const known = flow({ previewProblem: "already a board", previewProblemCode: "board_known", previewProblemBoard: { id: "zsa/moonlander", name: "Moonlander" } });

describe("R7-10: a keyboard keyloom has, on a first run", () => {
  test("with no config to put on it, offers Start a config and Import one, not Put a config on it", () => {
    const html = render(known, [], () => {});
    expect(html).toContain("keyloom knows this keyboard, so there is nothing to add. Start a config for it, or import one.");
    expect(html).toMatch(/Start a config<\/button>/);
    expect(html).toMatch(/Import one<\/button>/);
    expect(html).toMatch(/Pick another keyboard<\/button>/);
    expect(html).not.toContain("Put a config on it");
    expect(html).not.toContain("Put one of your configs");
  });

  test("configs on that board alone can't be put on it, so they count as none", () => {
    expect(render(known, [onMoonlander], () => {})).toContain("Start a config for it, or import one.");
    const html = render(known, [daily, onMoonlander], () => {});
    expect(html).toContain("Put one of your configs on it, or start one of its own.");
    expect(html).toMatch(/Put a config on it<\/button>/);
    expect(html).not.toContain("Import one");
  });

  // PR #302 review: a preview read again on the Review step can be refused as board_known too, and its Start a config must work there.
  test("Start a config makes the config on the board keyloom has, from Confirm and Review alike", () => {
    const moonlander = { id: "zsa/moonlander", name: "Moonlander" };
    const confirm = { kind: "confirm" as const, keyboard: null, candidate, homeRow: null, controller: null, layout: null };
    expect(blankBoardFor(confirm, moonlander)).toBe("zsa/moonlander");
    expect(blankBoardFor({ ...confirm, kind: "review", homeRow: 2 }, moonlander)).toBe("zsa/moonlander");
    expect(blankBoardFor(confirm, null)).toBeNull();
    expect(blankBoardFor({ kind: "put", boardId: "local/atomic", boardName: "Atomic", source: null, choices: {}, origin: "new" }, moonlander)).toBe("local/atomic");
    expect(blankBoardFor({ kind: "idle" }, moonlander)).toBeNull();
  });

  test("the Put step with no config to pick is Start a config, with no disabled Pick a config", () => {
    const put = flow({ step: { kind: "put", boardId: "local/atomic", boardName: "Atomic", source: null, choices: {}, origin: "new" } });
    const none = render(put, []);
    expect(none).toContain("<h2>Start a config for the Atomic</h2>");
    expect(none).toMatch(/<button[^>]*class="bar-apply"[^>]*>Start a config<\/button>/);
    expect(none).not.toContain("Pick a config");
    expect(none).not.toContain("keyloom maps it key by key");
    const some = render(put, [daily]);
    expect(some).toContain("<h2>Put a config on the Atomic</h2>");
    expect(some).toMatch(/disabled="">Pick a config<\/button>/);
  });
});

describe("R7-11: a derived board that fails the boards check", () => {
  const step = { candidate: { id: "qmk:atomic", name: "Atomic", firmware: "qmk" } as ApiCandidate };
  test("is blocked by its code, named as the page names it; a refusal Add again can pass is not", () => {
    const refused = new ApiError(400, "the derived Atomic board fails `keyloom boards check`: geometry.json differs", { code: "board_check_failed" });
    const words = blockedAdd(refused, step, { displayName: "Atomic (new)" });
    expect(words?.text).toBe("keyloom drew the Atomic (new), but the board it made fails the checks every keyboard in keyloom must pass, so keyloom can't add it yet.");
    expect(words?.text).not.toMatch(/`|--|geometry/);
    expect(deriveProblem("board_check_failed", "Atomic")?.blocked).toBe(true);
    expect(blockedAdd(new ApiError(400, "x", { code: "home_row_out_of_range" }), step, null)).toBeNull();
    expect(blockedAdd(new ApiError(400, "x", { code: "firmware_unreachable" }), step, null)).toBeNull();
    expect(blockedAdd(new ApiError(500, "x", { code: "internal" }), step, null)).toBeNull();
  });

  test("replaces Add with the contribution guide and another keyboard, and keeps Back to change the answers", () => {
    const board = { name: "Atomic", keys: [], hands: { left: [], right: [] }, fingers: {}, thumbs: [], rows: 5, homeRow: 3, flash: { kind: "manual", manualReason: null, steps: [] }, assumedController: null };
    const review = flow({
      step: { kind: "review", keyboard: null, candidate: step.candidate, homeRow: 3, controller: null, layout: null },
      preview: { displayName: "Atomic", layouts: [], controllers: [], rows: [], board } as unknown as PreviewResponse,
    });
    expect(render(review, [])).toMatch(/Add the Atomic\s*<\/button>|Add the Atomic<\/button>/);
    const html = render({ ...review, addBlocked: deriveProblem("board_check_failed", "Atomic") }, []);
    expect(html).toContain("fails the checks every keyboard in keyloom must pass");
    expect(html).toContain("Open the contribution guide");
    expect(html).toMatch(/Pick another keyboard<\/button>/);
    expect(html).toMatch(/>Back<\/button>/);
    expect(html).not.toContain("Add the Atomic");
  });
});

const board = (id: string, name: string, firmware: BoardChoice["firmware"], importers: string[], extra: Partial<BoardChoice> = {}): BoardChoice =>
  ({ id, name, vendor: "v", firmware, keyCount: 42, importers, ...extra });
const macbook = board("apple/macbook-ansi", "MacBook", "kanata", ["karabiner-json"]);
const corne = board("foostan/corne", "Corne", "zmk", ["zmk-keymap"], { keymapFile: "config/corne.keymap" });
const keebart = board("keebart/corne-choc-pro-bt", "Corne Choc Pro BT", "zmk", ["zmk-keymap"], { keymapFile: "config/corne_choc_pro.keymap" });
const moonlander = board("zsa/moonlander", "Moonlander", "qmk", ["oryx-source"]);

describe("R7-13: the MacBook's onboarding words", () => {
  test("the welcome talks about flashing only for a USB keyboard", () => {
    expect(welcomeLead("kanata")).not.toMatch(/Connect|flash/);
    expect(welcomeLead("kanata")).toContain("kanata");
    expect(welcomeLead(null)).not.toContain("flash");
    expect(welcomeLead("zmk")).toBe("Connect a keyboard or choose it below. Setup never flashes it.");
  });

  test("the setup card's lead and footer are true for kanata", () => {
    expect(setupFoot("kanata", false)).toBe("Nothing changes on your MacBook from here. Your changes reach it through kanata, which keyloom helps you set up.");
    expect(setupWrites("kanata")).not.toContain("written to the keyboard");
    expect(setupFoot("qmk", true)).toBe("keyloom only reads the keyboard. Nothing is written to it.");
    // Chosen from the list, keyloom never read it over USB.
    expect(setupFoot("zmk", false)).not.toContain("reads");
    const setup = flow({ step: { kind: "setup", keyboard: null, boardId: macbook.id, boardName: "MacBook" } });
    const html = renderToStaticMarkup(<SetupCard flow={setup} boards={[macbook]} hasConfigs={false} onImport={() => {}} onMade={() => {}} />);
    expect(html).toContain("Your changes reach it through kanata");
    expect(html).not.toContain("Nothing is written to the keyboard");
    expect(html).not.toContain("only reads the keyboard");
  });

  test("Import from a board's setup card shows that board's card, with a way to every card", () => {
    expect(cardsFor([moonlander, corne, macbook], macbook.id)).toEqual([macbook]);
    expect(cardsFor([moonlander, corne, macbook], null).map((b) => b.id)).toEqual(["zsa/moonlander", "foostan/corne", "apple/macbook-ansi"]);
    // A board the list doesn't have shows every card, never an empty screen.
    expect(cardsFor([moonlander, corne], "local/gone")).toHaveLength(2);
  });

  test("a zmk-config card names the board's own keymap file", () => {
    expect(guideFor(keebart).steps).toBe("Drop config/corne_choc_pro.keymap from your zmk-config repository.");
    expect(guideFor(corne).steps).toBe("Drop config/corne.keymap from your zmk-config repository.");
    expect(guideFor(board("local/x", "X", "zmk", ["zmk-keymap"])).steps).not.toContain("corne");
  });
});
