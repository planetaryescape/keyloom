import { describe, expect, test } from "bun:test";
import { assembleSystemPrompt } from "../../src/agent/prompt.ts";
import { getLayout } from "../../src/app/index.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

describe("the prompt teaches the reply's markers (D-468)", () => {
  test("the assembled prompt holds the section and the four forms, id by id", async () => {
    const { app, layoutId } = await optionOptionApp();
    const view = getLayout(app, layoutId);
    const prompt = assembleSystemPrompt(view.board, view.document);
    expect(prompt).toContain("# Naming what your reply points at");
    // The four markers exactly as a client reads them, and no fifth.
    for (const form of ["{config:<config id>}", "{proposal:<change set id>}", "{layer:<layer id>}", "{key:<layer id>:<position>}"]) {
      expect(prompt).toContain(form);
    }
    // Where the ids come from, and that a marker naming nothing is words rather than a link.
    expect(prompt).toContain("`get_layout`, positions from `get_layout` and `find_function`");
    expect(prompt).toContain("a marker naming nothing keyloom still holds reads as plain words");
    // A screen has no marker: rung D owns that, and the prompt says so instead of promising it.
    expect(prompt).toContain("A screen (History, the typing lab, Decisions), a setting, a menu or a command has no marker");
    // No URL scheme is offered to the model.
    expect(prompt).toContain("Never write a URL, a link or HTML");
    // The reply rules it belongs beside are still there.
    expect(prompt).toContain("BK sees the highlighted keys beside your reply, so keep the text short.");
    app.db.close();
  });
});
