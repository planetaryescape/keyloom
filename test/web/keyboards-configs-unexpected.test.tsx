// R9-05 and R9-08: the config dialogs, the import card, the new-keyboard steps, the welcome's reads and the mismatch page keep a failure's
// code, so one that fails the same way every time offers Restart keyloom, never only the button that failed. Later on the Put step doesn't
// bring a setup card straight back.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DetectedKeyboard } from "../../src/api/detected-keyboards.ts";
import { ConfirmProblemNote } from "../../src/web/configs/ConfigDialogs.tsx";
import { CardProblem } from "../../src/web/import/ImportScreen.tsx";
import { FlowProblem } from "../../src/web/keyboards/FlowProblem.tsx";
import { ReadFailed } from "../../src/web/keyboards/KeyboardWelcome.tsx";
import { SetupCard } from "../../src/web/keyboards/SetupCard.tsx";
import { cardToOpen, shownAfterClose, type NewBoardStep, type NewKeyboard } from "../../src/web/keyboards/useNewKeyboard.ts";
import { lookupFailedWords, mismatchUnexpected } from "../../src/web/shell/mismatch-words.ts";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, type PageFailure, UNREADABLE_WORDS, failsAgain } from "../../src/web/shell/unexpected.ts";

const mismatch: PageFailure = { message: NOT_FOUND_WORDS, code: "not_found", generic: true };
const unreadable: PageFailure = { message: UNREADABLE_WORDS, code: "unreadable" };
const internal: PageFailure = { message: INTERNAL_WORDS, code: "internal" };
const lost: PageFailure = { message: "keyloom stopped answering.", code: "unreachable" };
const gone: PageFailure = { message: "keyloom has no config cfg_1.", code: "not_found" };

describe("failsAgain", () => {
  test("is true only for an answer a second identical request meets again", () => {
    expect(failsAgain(mismatch)).toBe(true);
    expect(failsAgain(unreadable)).toBe(true);
    // An exception can pass on a second try, a lost connection may come back, and a route's own not_found is the screen's to say.
    expect(failsAgain(internal)).toBe(false);
    expect(failsAgain(lost)).toBe(false);
    expect(failsAgain(gone)).toBe(false);
    expect(failsAgain(null)).toBe(false);
    expect(failsAgain(undefined)).toBe(false);
  });
});

describe("the config dialogs (R9-05)", () => {
  const note = (problem: Parameters<typeof ConfirmProblemNote>[0]["problem"], token?: string) =>
    renderToStaticMarkup(<ConfirmProblemNote token={token} problem={problem} extraShown={false} />);

  test("a put-on that keyloom's catch-all answers says so with Restart keyloom as the way on", () => {
    const html = note({ message: NOT_FOUND_WORDS, failure: mismatch }, "t");
    expect(html).toContain("Restarting keyloom opens the page that matches it.");
    expect(html).toContain("Restart keyloom");
    expect(html).toContain("button-primary");
    expect(html).not.toContain("Try again");
  });

  test("an exception adds Restart keyloom beside the sentence; the confirm stays the Try again", () => {
    const html = note({ message: INTERNAL_WORDS, failure: internal }, "t");
    expect(html).toContain("Restart keyloom");
    expect(html).not.toContain("button-primary");
  });

  test("a refusal the dialog maps keeps its own words and buttons, with no Restart keyloom", () => {
    const html = note({ message: "This config is archived", detail: "Restore it to put it on the keyboard." }, "t");
    expect(html).toContain("Restore it to put it on the keyboard.");
    expect(html).not.toContain("Restart keyloom");
  });

  test("without a token, the sentence shows alone", () => {
    expect(note({ message: NOT_FOUND_WORDS, failure: mismatch })).not.toContain("Restart keyloom");
  });
});

describe("the import card (R9-05)", () => {
  test("a drop that hits an exception says so with Restart keyloom; a wrong file keeps its words alone", () => {
    const html = renderToStaticMarkup(<CardProblem token="t" problem={internal} />);
    expect(html).toContain("The details are in keyloom&#x27;s log.");
    expect(html).toContain("Restart keyloom");
    // The card's drop zone is its Try again: each drop is a new file.
    expect(html).not.toContain("Try again");
    const wrong = renderToStaticMarkup(<CardProblem token="t" problem={{ message: "notes.txt isn't a .zip file." }} />);
    expect(wrong).toContain("notes.txt isn&#x27;t a .zip file.");
    expect(wrong).not.toContain("Restart keyloom");
  });
});

describe("the new-keyboard steps (R9-05)", () => {
  test("a failed Add, Start blank or Make offers Restart keyloom for a failure no screen planned for", () => {
    const html = renderToStaticMarkup(<FlowProblem flow={{ token: "t", problem: unreadable }} />);
    expect(html).toContain("Restart keyloom");
    expect(renderToStaticMarkup(<FlowProblem flow={{ token: "t", problem: { message: "That name is taken.", code: "name_taken" } }} />)).not.toContain("Restart keyloom");
    expect(renderToStaticMarkup(<FlowProblem flow={{ token: "t", problem: null }} />)).toBe("");
  });

  // SAFETY: the setup card reads only these fields of the hook's result while rendering.
  const setup = (extra: Partial<NewKeyboard>) => renderToStaticMarkup(
    <SetupCard flow={{
      token: "t", step: { kind: "setup", keyboard: null, boardId: "zsa/moonlander", boardName: "Moonlander" }, busy: false, stuck: false, removed: null, problem: null,
      notNow: () => {}, startPut: () => {}, startBlank: async () => null, restoreKeyboard: async () => {}, ...extra,
    } as unknown as NewKeyboard} hasConfigs={false} onImport={() => {}} onMade={() => {}} />,
  );

  test("Start blank goes off once it fails the same way every time, and Restart keyloom is beside it", () => {
    const stuck = setup({ problem: mismatch, stuck: true });
    expect(stuck).toMatch(/<button type="button" class="sheet-action" disabled="">.*Start blank<\/button>/);
    expect(stuck).toContain("Restart keyloom");
    const exception = setup({ problem: internal, stuck: false });
    expect(exception).not.toMatch(/disabled="">.*Start blank/);
    expect(exception).toContain("Restart keyloom");
  });
});

describe("the welcome's reads (R9-05)", () => {
  const read = (failure: PageFailure | null, onRetry: (() => void) | undefined = () => {}) =>
    renderToStaticMarkup(<ReadFailed token="t" words="keyloom couldn't read its keyboard list." failure={failure} onRetry={onRetry} />);

  test("keyloom's catch-all says why and offers Restart keyloom, never a Try again that fails the same way", () => {
    const html = read(mismatch);
    expect(html).toContain("keyloom couldn&#x27;t read its keyboard list. keyloom couldn&#x27;t find what this page asked for.");
    expect(html).toContain("Restart keyloom");
    expect(html).not.toContain("Try again");
  });

  test("an exception offers Try again and Restart keyloom; a lost connection, Try again alone, in the page's own words", () => {
    const exception = read(internal);
    expect(exception).toContain("Try again");
    expect(exception).toContain("Restart keyloom");
    const connection = read(lost);
    expect(connection).toContain("Try again");
    expect(connection).not.toContain("Restart keyloom");
    expect(connection).not.toContain("stopped answering");
    expect(read(null)).toContain("Try again");
  });
});

describe("the mismatch page (R9-05)", () => {
  test("a look for a matching revision that fails the same way says so without offering Look again", () => {
    expect(lookupFailedWords(mismatch)).not.toContain("Look again");
    expect(lookupFailedWords(mismatch)).toContain(NOT_FOUND_WORDS);
    expect(lookupFailedWords(internal)).toContain("Look again");
    expect(lookupFailedWords(lost)).toContain("Look again");
  });

  test("one Restart keyloom: a refused Go back or Archive first, then the look", () => {
    expect(mismatchUnexpected(internal, mismatch)).toBe(internal);
    expect(mismatchUnexpected(null, mismatch)).toBe(mismatch);
    expect(mismatchUnexpected({ message: "Layer 2 has no way in.", code: "validation_failed" }, null)).toBeNull();
    expect(mismatchUnexpected(lost, null)).toBeNull();
    expect(mismatchUnexpected(null, null)).toBeNull();
  });
});

describe("R9-08: Later on the Put step", () => {
  const lily = (knownBoard: { id: string; name: string } | null): DetectedKeyboard => ({
    device: { vendorId: "4653", productId: "0001", product: "Lily58", maker: "x", bcdDevice: null, serial: null },
    status: knownBoard === null ? "candidates" : "known", knownBoard, candidates: [], ambiguous: false, next: "",
  });
  const put = (boardId: string): NewBoardStep => ({ kind: "put", boardId, boardName: "Lily58 (new)", source: null, choices: {}, origin: "new" });

  test("a board just added and left with Later doesn't open its setup card again by itself", () => {
    // The card opened for the keyboard keyloom hadn't met, by its USB key.
    const first = cardToOpen([lily(null)], [], new Set());
    expect(first?.step.kind).toBe("card");
    const shown = new Set([first?.shown ?? ""]);
    // Added: detection now reads it as a known board with no config. Later closes the Put step.
    const after = shownAfterClose(put("derived/lily58"), shown);
    expect(cardToOpen([], [lily({ id: "derived/lily58", name: "Lily58 (new)" })], after)).toBeNull();
    // Before this fix, the setup card opened at once.
    expect(cardToOpen([], [lily({ id: "derived/lily58", name: "Lily58 (new)" })], shown)?.step).toMatchObject({ kind: "setup", boardId: "derived/lily58" });
  });

  test("closing any other step leaves what was shown alone, so another board still opens its card once", () => {
    const shown = new Set(["x"]);
    expect(shownAfterClose({ kind: "idle" }, shown)).toBe(shown);
    expect(cardToOpen([], [lily({ id: "foostan/corne", name: "Corne" })], shownAfterClose(put("derived/lily58"), shown))?.step).toMatchObject({ kind: "setup", boardId: "foostan/corne" });
  });
});
