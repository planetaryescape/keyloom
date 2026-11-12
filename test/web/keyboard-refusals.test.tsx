// Round 6 (R6-04 to R6-25): each refusal on the keyboards and import screens says what happened and carries the button that fixes it,
// from the server's code and the board it names, never from its sentence.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiCandidate } from "../../src/api/detected-keyboards.ts";
import type { BoardChoice } from "../../src/api/http.ts";
import { ApiError } from "../../src/web/api.ts";
import { newConfigWaits, renameWaits } from "../../src/web/configs/dialog-words.ts";
import { importLine } from "../../src/web/import/export-steps.ts";
import { activitiesFor, importRefusal, otherBoardWords, restoreFor, retryFor, type Refused } from "../../src/web/import/import-words.ts";
import { BoardCard } from "../../src/web/import/ImportScreen.tsx";
import { catalogueNote } from "../../src/web/keyboards/catalogue-words.ts";
import { deriveProblem } from "../../src/web/keyboards/derive-words.ts";
import { NewBoardPanel } from "../../src/web/keyboards/NewBoardPanel.tsx";
import { putProblem } from "../../src/web/keyboards/put-words.ts";
import { RestoreKeyboard, keyboardRemoved, removedWords } from "../../src/web/keyboards/RestoreKeyboard.tsx";
import { SearchFailed } from "../../src/web/keyboards/SearchFailed.tsx";
import { knownBoardOf, type NewKeyboard } from "../../src/web/keyboards/useNewKeyboard.ts";

const board = (id: string, name: string, importers: string[], firmware: BoardChoice["firmware"] = "zmk"): BoardChoice => ({ id, name, vendor: "v", firmware, keyCount: 42, importers });
const glove = board("moergo/glove80", "Glove80", ["zmk-layout-editor-keymap"]);
const macbook = board("apple/macbook", "MacBook", ["karabiner-json"], "kanata");
const moonlander = board("zsa/moonlander", "Moonlander", ["oryx-source"], "qmk");

// SAFETY: the panel reads only these fields of the hook's result while rendering; the rest of its API is never called.
const flow = (extra: Partial<NewKeyboard>): NewKeyboard => ({
  step: { kind: "confirm", keyboard: null, candidate: { id: "zmk:corne", name: "Corne", firmware: "zmk" } as ApiCandidate, homeRow: null, controller: null, layout: null },
  preview: null, previewProblem: null, previewProblemCode: null, previewProblemBoard: null, putPreview: null, putFailure: null, problem: null, removed: null,
  searchProblem: null, activities: [], busy: false, retryPreview: () => {}, backToCard: () => {}, notNow: () => {}, review: () => {}, putOnKnown: () => {},
  retryPut: () => {}, clearSource: () => {}, retrySearch: () => {}, close: () => {}, ...extra,
}) as unknown as NewKeyboard;
const render = (f: NewKeyboard) => renderToStaticMarkup(<NewBoardPanel flow={f} sources={[{ id: "a", name: "Daily", boardName: "Moonlander", boardId: "zsa/moonlander", note: null }]} onMade={() => {}} />);

describe("R6-04: the first-run keyboard list before it has rows", () => {
  test("says it is reading, or that it couldn't, and says no board matches only once both reads came back", () => {
    expect(catalogueNote("loading", "ready", 0, false)).toBe("boards_loading");
    expect(catalogueNote("failed", "ready", 0, false)).toBe("boards_failed");
    expect(catalogueNote("failed", "loading", 0, false)).toBe("boards_failed");
    expect(catalogueNote("ready", "failed", 0, false)).toBe("collection_failed");
    expect(catalogueNote("ready", "loading", 0, false)).toBe("collection_loading");
    expect(catalogueNote("ready", "ready", 0, false)).toBe("none");
    expect(catalogueNote("ready", "ready", 0, true)).toBeNull();
    expect(catalogueNote("ready", "ready", 3, false)).toBeNull();
  });
});

describe("R6-05: a Put step map that failed", () => {
  test("no answer and a server failure offer Try again; a refusal says why and doesn't", () => {
    expect(putProblem(new ApiError(0, "gone", { code: "unreachable" }), "Corne")).toEqual({ text: "keyloom stopped answering, so it couldn't map this config onto the Corne.", retry: true });
    expect(putProblem(new ApiError(500, "internal error", { code: "internal" }), "Corne")).toEqual({ text: "keyloom couldn't map this config onto the Corne.", retry: true });
    expect(putProblem(new ApiError(404, "no layout", { code: "not_found" }), "Corne").retry).toBe(false);
    expect(putProblem(new ApiError(400, "the base layer has no key 3.", { code: "validation" }), "Corne")).toEqual({ text: "keyloom can't put this config on the Corne: the base layer has no key 3.", retry: false });
  });

  test("replaces Mapping it… with the words, Try again where it can work, another config, and still one of its own", () => {
    const put = { kind: "put" as const, boardId: "local/corne", boardName: "Corne", source: "a", choices: {}, origin: "new" as const };
    const retry = render(flow({ step: put, putFailure: { text: "keyloom couldn't map this config onto the Corne.", retry: true } }));
    expect(retry).not.toContain("Mapping it…");
    expect(retry).toContain("keyloom couldn&#x27;t map this config onto the Corne.");
    expect(retry).toMatch(/Try again<\/button>/);
    expect(retry).toMatch(/Pick another config<\/button>/);
    expect(retry).toMatch(/Start a config<\/button>/);
    expect(retry).toContain("Can&#x27;t map this config");
    const refused = render(flow({ step: put, putFailure: { text: "keyloom can't put this config on the Corne: no.", retry: false } }));
    expect(refused).not.toMatch(/Try again<\/button>/);
    expect(refused).toMatch(/Pick another config<\/button>/);
    // While it maps, the button says so instead of "Pick a config", which was already done.
    expect(render(flow({ step: put }))).toContain("Mapping it…</button>");
  });

  test("leaves out the configs already on the board, which a put can't copy", () => {
    const put = { kind: "put" as const, boardId: "zsa/moonlander", boardName: "Moonlander", source: null, choices: {}, origin: "matched" as const };
    const html = render(flow({ step: put }));
    expect(html).not.toContain(">Daily<");
    expect(html).toContain("keyloom already has the Moonlander");
  });
});

describe("R6-07: a keyboard keyloom already has", () => {
  test("offers Put a config on it and Pick another keyboard, and no Show me the board", () => {
    const html = render(flow({ previewProblem: "Corne is already a board", previewProblemCode: "board_known", previewProblemBoard: { id: "foostan/corne", name: "Corne" } }));
    expect(html).toContain("<h2>keyloom already has the Corne</h2>");
    expect(html).toContain("keyloom knows this keyboard, so there is nothing to add.");
    expect(html).not.toContain("as ZMK draws it");
    expect(html).toMatch(/Put a config on it<\/button>/);
    expect(html).toMatch(/Pick another keyboard<\/button>/);
    expect(html).not.toContain("Show me the board");
    expect(html).not.toContain("keyboard put");
  });

  // #299 review: a search result named "Moonlander Mark I" that is keyloom's "Moonlander" is named as keyloom names the board.
  test("names the board by keyloom's own name, not the search result's", () => {
    const refusal = new ApiError(400, "Moonlander Mark I is already a board: zsa/moonlander", { code: "board_known", board: "zsa/moonlander", boardName: "Moonlander" });
    expect(knownBoardOf(refusal, "Moonlander Mark I")).toEqual({ id: "zsa/moonlander", name: "Moonlander" });
    expect(knownBoardOf(new ApiError(400, "x", { code: "board_known", board: "zsa/moonlander" }), "Moonlander Mark I")).toEqual({ id: "zsa/moonlander", name: "Moonlander Mark I" });
    expect(knownBoardOf(new ApiError(500, "x", { code: "internal" }), "Moonlander Mark I")).toBeNull();
    const step = { kind: "confirm" as const, keyboard: null, candidate: { id: "qmk:zsa/moonlander", name: "Moonlander Mark I", firmware: "qmk" } as ApiCandidate, homeRow: null, controller: null, layout: null };
    const html = render(flow({ step, previewProblem: "x", previewProblemCode: "board_known", previewProblemBoard: { id: "zsa/moonlander", name: "Moonlander" } }));
    expect(html).toContain("<h2>keyloom already has the Moonlander</h2>");
    expect(html).not.toContain("Mark I");
  });
});

describe("R6-08: a config refused because its keyboard was removed", () => {
  test("is recognised by its code and offers Restore {board}, saying what Restore goes on to do", () => {
    expect(keyboardRemoved(new ApiError(400, "restore this keyboard … `keyloom keyboard restore x`", { code: "keyboard_removed" }))).toBe(true);
    expect(keyboardRemoved(new ApiError(400, "nope", { code: "usage" }))).toBe(false);
    const html = renderToStaticMarkup(<RestoreKeyboard restore={() => new Promise(() => {})} boardName="Glove80" doing="import this layout" onRestored={() => {}} />);
    expect(html).toContain(removedWords("Glove80", "import this layout"));
    expect(html).toMatch(/Restore Glove80<\/button>/);
    expect(html).not.toContain("keyloom keyboard restore");
  });

  test("on the Put step offers Restore, which makes the config again", () => {
    const put = { kind: "put" as const, boardId: "local/corne", boardName: "Corne", source: "a", choices: {}, origin: "new" as const };
    const html = render(flow({ step: put, removed: "make" }));
    expect(html).toContain("Restore it to make this config.");
    expect(html).toMatch(/Restore Corne<\/button>/);
  });
});

describe("R6-11: the setup card's import line", () => {
  test("comes from the board's own guide", () => {
    expect(importLine(macbook)).toBe("Bring in what you set up in Karabiner-Elements.");
    expect(importLine(moonlander)).toBe("Drop the file from Oryx.");
    expect(importLine(glove)).toBe("Drop the file from the Layout Editor.");
    expect(importLine(undefined)).not.toMatch(/Oryx|MoErgo|zmk-config/);
  });
});

describe("R6-14: layout codes", () => {
  test("a layout file keyloom can't read is blocked; GitHub not answering is not", () => {
    expect(deriveProblem("layout_unreadable", "Corne")?.blocked).toBe(true);
    expect(deriveProblem("firmware_unreachable", "Corne")).toEqual({ text: "keyloom couldn't get the Corne's layout from GitHub. Check that this computer is online, then try again.", blocked: false });
    for (const code of ["layout_unreadable", "firmware_unreachable"]) expect(deriveProblem(code, "Corne")?.text).not.toMatch(/cache|\/|--|`/);
  });

  test("the reading panel says GitHub didn't answer in words, with Try again, not the server's sentence with its cache path", () => {
    const html = render(flow({ previewProblem: "couldn't read Corne's layout … keeps it in /Users/x/.cache/keyloom", previewProblemCode: "firmware_unreachable" }));
    expect(html).toContain("from GitHub");
    expect(html).not.toContain(".cache");
    expect(html).toMatch(/Try again<\/button>/);
  });
});

describe("R6-18 and R6-25: the import cards", () => {
  test("a keyloom export for another board names it, and a board keyloom doesn't have says so", () => {
    const refusal = importRefusal(new ApiError(400, "pass --board moergo/glove80", { code: "layout_for_other_board", board: "moergo/glove80" }), [glove, moonlander], moonlander);
    expect(refusal).toEqual({ kind: "other_board", boardId: "moergo/glove80", board: glove });
    if (refusal?.kind !== "other_board") throw new Error("expected an other-board refusal");
    expect(otherBoardWords("glove.json", refusal, moonlander)).toBe("glove.json is a layout for the Glove80, not the Moonlander.");
    const unknown = importRefusal(new ApiError(400, "x", { code: "layout_for_other_board", board: "local/odd" }), [moonlander], moonlander);
    expect(unknown).toEqual({ kind: "other_board", boardId: "local/odd", board: null });
    expect(importRefusal(new ApiError(400, "x", { code: "usage" }), [], moonlander)).toBeNull();
  });

  // #299 review: the person removed the Glove80, then chose "Import it as a Glove80 config" on the Moonlander card.
  test("a removed keyboard is the one the server refused, so Restore restores it and the retry imports to it", () => {
    const refusal = importRefusal(new ApiError(400, "restore moergo/glove80", { code: "keyboard_removed", board: "moergo/glove80" }), [glove, moonlander], glove);
    expect(refusal).toEqual({ kind: "removed", boardId: "moergo/glove80", board: glove });
    if (refusal?.kind !== "removed") throw new Error("expected a removed refusal");
    const file = new File(["{}"], "glove.json");
    const refused: Refused = { refusal, file, as: glove };
    expect(restoreFor({ ...refused, refusal })).toEqual({ boardId: "moergo/glove80", boardName: "Glove80", doing: "import this layout" });
    expect(retryFor(refused)).toEqual({ kind: "import", file, as: glove });
    const html = renderToStaticMarkup(<RestoreKeyboard restore={() => new Promise(() => {})} boardName={restoreFor({ ...refused, refusal }).boardName} doing="import this layout" onRestored={() => {}} />);
    expect(html).toContain("You removed the Glove80");
    expect(html).toMatch(/Restore Glove80<\/button>/);
    expect(html).not.toContain("Moonlander");
  });

  test("a removed refusal that names no board is the board the request went to, and a blank start is started again", () => {
    const refusal = importRefusal(new ApiError(400, "x", { code: "keyboard_removed" }), [moonlander], moonlander);
    expect(refusal).toEqual({ kind: "removed", boardId: "zsa/moonlander", board: moonlander });
    if (refusal?.kind !== "removed") throw new Error("expected a removed refusal");
    const blank: Refused = { refusal, file: null, as: moonlander };
    expect(restoreFor({ ...blank, refusal })).toEqual({ boardId: "zsa/moonlander", boardName: "Moonlander", doing: "start a config" });
    expect(retryFor(blank)).toEqual({ kind: "blank" });
  });

  test("the MacBook takes no activity tests, whatever is ticked", () => {
    expect(activitiesFor(macbook, ["prose"])).toEqual([]);
    expect(activitiesFor(glove, ["prose"])).toEqual(["prose"]);
  });

  // #299 review: each card gets what is ticked, unfiltered, so Import it as a Glove80 config from the MacBook card keeps the tests.
  test("each card filters the ticked tests for its own board, so another board's import keeps them", () => {
    const card = (b: BoardChoice) => renderToStaticMarkup(<BoardCard board={b} boards={[macbook, glove]} token="t" onImported={() => {}} onStartedBlank={() => {}} activities={["prose"]} />);
    expect(card(macbook)).toContain("keyloom import --board apple/macbook &lt;file&gt;");
    expect(card(glove)).toContain("keyloom import --board moergo/glove80 --activities prose &lt;file&gt;");
  });
});

describe("R6-19: a failed QMK and ZMK search", () => {
  test("says so with Search again", () => {
    const html = renderToStaticMarkup(<SearchFailed flow={{ searchProblem: "keyloom stopped answering.", retrySearch: () => {} }} />);
    expect(html).toContain("keyloom couldn&#x27;t search QMK and ZMK. keyloom stopped answering.");
    expect(html).toMatch(/Search again<\/button>/);
  });
});

describe("R6-24: the config dialogs say what to fill in", () => {
  test("Rename waits for a new name", () => {
    expect(renameWaits("", "Daily")).toBe("Type a name to rename it.");
    expect(renameWaits(" Daily ", "Daily")).toBe("Type the new name to rename it.");
    expect(renameWaits("Colemak", "Daily")).toBeNull();
  });

  test("Make it waits for a name, and for a version when it starts from one", () => {
    expect(newConfigWaits("copy", "", "")).toBe("Type a name for the new config.");
    expect(newConfigWaits("version", "Colemak", "")).toBe("Pick the version to start from.");
    expect(newConfigWaits("version", "Colemak", "rev_1")).toBeNull();
    expect(newConfigWaits("file", "", "")).toBeNull();
  });
});
