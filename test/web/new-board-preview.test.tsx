// A board preview that fails says why and offers Try again, instead of "Reading…" for ever with the next step disabled (R3-08).
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiCandidate } from "../../src/api/detected-keyboards.ts";
import { NewBoardPanel, reviewBackLabel } from "../../src/web/keyboards/NewBoardPanel.tsx";
import { addProblem, reviewStep, type NewBoardStep, type NewKeyboard } from "../../src/web/keyboards/useNewKeyboard.ts";
import { ApiError } from "../../src/web/api.ts";
import type { PreviewResponse } from "../../src/api/keyboards.ts";
import { deriveProblem } from "../../src/web/keyboards/derive-words.ts";

// SAFETY: the Confirm panel reads only the candidate's id, name and firmware.
const candidate = { id: "zmk/corne", name: "Corne", firmware: "zmk" } as ApiCandidate;
// SAFETY: the Confirm panel reads only these fields of the hook's result; the rest of its API is never called while rendering.
const flow = (previewProblem: string | null, extra: Partial<NewKeyboard> = {}): NewKeyboard => ({
  step: { kind: "confirm", keyboard: null, candidate, homeRow: null, controller: null, layout: null },
  preview: null, addBlocked: null, previewProblem, previewProblemCode: null, previewFailure: null, problem: null, retryPreview: () => {}, backToCard: () => {}, notNow: () => {}, review: () => {},
  setHomeRow: () => {}, setController: () => {}, setLayout: () => {}, busy: false, ...extra,
}) as unknown as NewKeyboard;
const render = (f: NewKeyboard) => renderToStaticMarkup(<NewBoardPanel flow={f} sources={[]} onMade={() => {}} />);
const preview = (over: Partial<PreviewResponse> = {}): PreviewResponse => ({
  candidate: { id: "zmk:m60", name: "MakerDiary m60", firmware: "zmk" }, keyCount: 61,
  rows: [{ row: 1, keys: 14 }, { row: 2, keys: 14 }, { row: 3, keys: 13 }, { row: 4, keys: 12 }, { row: 5, keys: 8 }],
  guessedHomeRow: 3, layout: null, layouts: [], guessedLayout: null, needs: ["--home-row"], controllers: [], board: null, boardProblem: null, boardProblemCode: null, displayName: "MakerDiary m60",
  ...over,
});

test("while the preview is read, the panel says so", () => {
  const html = renderToStaticMarkup(<NewBoardPanel flow={flow(null)} sources={[]} onMade={() => {}} />);
  expect(html).toContain("Reading…");
  expect(html).not.toContain("Try again");
});

test("a failed preview stops reading, says why and offers Try again", () => {
  const html = renderToStaticMarkup(<NewBoardPanel flow={flow("keyloom couldn't reach the firmware tree.")} sources={[]} onMade={() => {}} />);
  expect(html).not.toContain("Reading…");
  expect(html).toContain('role="alert"');
  expect(html).toContain("keyloom couldn&#x27;t draw this board. keyloom couldn&#x27;t reach the firmware tree.");
  expect(html).toContain("Try again");
});

// R5-06: a keyboard keyloom can't add yet ends at words and a way on, never at a CLI flag or a Try again that fails the same way.
test("a shield with no controller keyloom knows says so in words, offers the contribution guide and another keyboard, and drops the next step", () => {
  const html = render(flow(null, { preview: preview({ boardProblem: "m60 needs a controller board…; choose one with --controller.", boardProblemCode: "controller_unknown" }) }));
  expect(html).toContain("keyloom doesn&#x27;t know a controller for the MakerDiary m60 yet.");
  expect(html).not.toContain("--controller");
  expect(html).toContain("Open the contribution guide");
  expect(html).toContain("https://github.com/planetaryescape/keyloom/blob/main/CONTRIBUTING.md");
  expect(html).toContain("Pick another keyboard");
  expect(html).not.toContain("Show me the board");
  // Nothing asked would get it added, so the questions wait.
  expect(html).not.toContain("Where do your fingers rest?");
  expect(html).not.toContain("tell keyloom once");
});

test("a preview refused with no_key_positions offers the guide, not Try again", () => {
  const html = render(flow("ZMK's tree gives Glove80 no physical layout… Contribute the board by hand: docs/blueprint/04-boards-and-contributions.md", { previewProblemCode: "no_key_positions" }));
  expect(html).toContain("firmware files don&#x27;t give the position of each key");
  expect(html).not.toContain("docs/blueprint");
  expect(html).not.toContain("Try again");
  expect(html).toContain("Open the contribution guide");
  expect(html).not.toContain("Show me the board");
});

// Atomic: two layouts and no default, so the preview draws keyloom's guess (the one with most keys) until the person picks theirs.
const atomicLayouts = [{ name: "LAYOUT_semi_standard", keys: 66 }, { name: "LAYOUT_ortho_5x15", keys: 75 }];
const board = { keys: [], thumbs: [], hands: { left: [], right: [] }, homeRow: 3, flash: { kind: "manual", manualReason: null, steps: [] } } as unknown as PreviewResponse["board"];
const atomicGuess = preview({ candidate: { id: "qmk:atomic", name: "Atomic", firmware: "qmk" }, displayName: "Atomic", layout: "LAYOUT_ortho_5x15", needs: ["--home-row", "--layout"],
  layouts: atomicLayouts, guessedLayout: "LAYOUT_ortho_5x15", board });
const atomicPicked = { ...atomicGuess, layout: "LAYOUT_semi_standard", keyCount: 66, needs: ["--home-row"] };
const confirm = (layout: string | null): NewBoardStep => ({ kind: "confirm", keyboard: null, candidate: { id: "qmk:atomic", name: "Atomic", firmware: "qmk" } as ApiCandidate, homeRow: null, controller: null, layout });

// #293 review: the CLI refuses to store a guessed layout, so the page can't either. Review is the only way to Add, and it carries no guess.
test("a layout that is only keyloom's guess can't be carried to Add: nothing is preselected and the next step asks for the layout", () => {
  const html = render(flow(null, { step: confirm(null), preview: atomicGuess }));
  expect(html).toMatch(/<button type="button" class="bar-apply" disabled="">Pick your layout<\/button>/);
  expect(html).not.toContain("Show me the board");
  expect(html).not.toMatch(/checked="" value="LAYOUT/);
  expect(reviewStep(confirm(null), atomicGuess)).toBeNull();
  // Picked, the layout is the person's, and the guess stays marked.
  const picked = render(flow(null, { step: confirm("LAYOUT_semi_standard"), preview: atomicPicked }));
  expect(picked).toMatch(/<button type="button" class="bar-apply">Show me the board<\/button>/);
  expect(picked).toContain("LAYOUT_ortho_5x15 · 75 keys · guess");
  expect(picked).toContain("keyloom&#x27;s guess is marked.");
  expect(picked).toMatch(/checked="" value="LAYOUT_semi_standard"/);
  expect(reviewStep(confirm("LAYOUT_semi_standard"), atomicPicked)).toMatchObject({ kind: "review", layout: "LAYOUT_semi_standard", homeRow: 3 });
  // A keyboard with a default layout goes on with it: that is QMK's, not a guess.
  const withDefault = { ...atomicPicked, layout: "LAYOUT", guessedLayout: null, layouts: [{ name: "LAYOUT", keys: 66 }, { name: "LAYOUT_ortho_5x15", keys: 75 }] };
  expect(reviewStep(confirm(null), withDefault)).toMatchObject({ kind: "review", layout: "LAYOUT" });
  expect(render(flow(null, { step: confirm(null), preview: withDefault }))).toMatch(/checked="" value="LAYOUT"/);
});

test("the Review step's way back names each question that was asked", () => {
  expect(reviewBackLabel(false, false)).toBe("Home row");
  expect(reviewBackLabel(true, false)).toBe("Home row and layout");
  expect(reviewBackLabel(false, true)).toBe("Home row and controller");
  expect(reviewBackLabel(true, true)).toBe("Home row, layout and controller");
});

test("a refused add names the keyboard as the page does, and leaves other failures in the server's words", () => {
  const step = { candidate: { id: "zmk:corne", name: "Corne", firmware: "zmk" } as ApiCandidate };
  const refused = new ApiError(400, "corne needs --controller", { code: "controller_unknown" });
  expect(addProblem(refused, step, { displayName: "Corne (new)" })).toContain("a controller for the Corne (new) yet.");
  expect(addProblem(refused, step, null)).toContain("a controller for the Corne yet.");
  expect(addProblem(new ApiError(500, "disk full"), step, null)).toBe("disk full");
});

test("a QMK keyboard with several layouts asks which is yours first, with keyloom's guess marked", () => {
  const html = render(flow(null, {
    preview: atomicGuess,
  }));
  expect(html).toContain("Two things can&#x27;t be read over USB");
  expect(html).toMatch(/<span>1<\/span>Which layout is yours\?/);
  // Picking a layout resets the home row, so it is asked once the layout is picked, not beside it (R6-13).
  expect(html).not.toContain("Where do your fingers rest?");
  const picked = render(flow(null, {
    step: { kind: "confirm", keyboard: null, candidate, homeRow: null, controller: null, layout: "LAYOUT_semi_standard" },
    preview: atomicGuess,
  }));
  expect(picked).toMatch(/<span>2<\/span>Where do your fingers rest\?/);
  expect(html).toContain("LAYOUT_ortho_5x15 · 75 keys · guess");
  expect(html).toContain("LAYOUT_semi_standard · 66 keys");
});

test("every code the server sends has words; one that can be fixed here doesn't block, and an unknown code is left to the caller", () => {
  for (const code of ["controller_unknown", "boot_drive_unknown", "layout_macro_missing", "no_key_positions", "layout_unreadable"]) {
    const words = deriveProblem(code, "Corne");
    expect(words?.blocked).toBe(true);
    expect(words?.text).not.toMatch(/--|`/);
  }
  expect(deriveProblem("home_row_out_of_range", "Corne")).toEqual({ text: "That row isn't on this layout. Pick the home row again.", blocked: false });
  expect(deriveProblem("usage", "Corne")).toBeNull();
  expect(deriveProblem(null, "Corne")).toBeNull();
});

// R5-16: with configs to copy, starting from the board's own keys is still offered, for when none of them maps.
test("the put step offers Start a config beside the configs to copy", () => {
  const put = flow(null, { step: { kind: "put", boardId: "local/atomic", boardName: "Atomic", source: null, choices: {}, origin: "new" }, putPreview: null, activities: [] });
  const withConfigs = renderToStaticMarkup(<NewBoardPanel flow={put} sources={[{ id: "a", name: "Daily", boardName: "Moonlander", note: null }]} onMade={() => {}} />);
  expect(withConfigs).toContain("Or start a config from the Atomic’s own keys.");
  expect(withConfigs).toMatch(/<button[^>]*>Start a config<\/button>/);
  const none = renderToStaticMarkup(<NewBoardPanel flow={put} sources={[]} onMade={() => {}} />);
  expect(none).not.toContain("Or start a config");
  expect(none).toContain("Start a config</button>");
});
