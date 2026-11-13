import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { SwitchFailed } from "../../src/web/chat/ChatStates.tsx";
import { OpenProposals } from "../../src/web/keyboards/OpenProposals.tsx";
import { CONFIG_GONE } from "../../src/web/chat/proposals-read.ts";
import { OtherLayoutsContext } from "../../src/web/editor/LayoutGone.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, type PageFailure, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
const noop = () => {};

describe("a failed read is not an empty list (R4-08)", () => {
  const lost: PageFailure = { message: "Can't reach keyloom.", code: "unreachable" };
  const panel = (readFailure: PageFailure | null, showOthers: (() => void) | null = noop) => renderToStaticMarkup(createElement(OtherLayoutsContext.Provider, { value: showOthers }, createElement(OpenProposals, {
    proposals: [], readFailure, onReadAgain: noop, layout, board: board.definition, configName: "Daily", firstFlash: false, pinnedId: null,
    onPin: noop, onPreview: noop, onApply: async () => {}, onClose: noop, onOpenRelease: noop, onPlanRecovery: noop, token: "t",
  })));

  test("it says the proposals couldn't be read and offers Try again", () => {
    const html = panel(lost);
    expect(html).toContain("couldn&#x27;t read this config&#x27;s proposals");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Restart keyloom");
    expect(html).not.toContain("Nothing is waiting");
  });

  test("a read that worked and found nothing still says nothing is waiting", () => {
    expect(panel(null)).toContain("Nothing is waiting");
  });

  // R11-05: the panel kept only a boolean, so a read that fails the same way every time kept its Try again for ever.
  test("a read that fails the same way offers Restart keyloom, not Try again", () => {
    for (const failure of [{ message: UNREADABLE_WORDS, code: "unreadable" }, { message: NOT_FOUND_WORDS, code: "not_found", generic: true }]) {
      const html = panel(failure);
      expect(html).toContain("Restart keyloom");
      expect(html).not.toContain("Try again");
    }
  });

  test("a server exception offers Try again and Restart keyloom, with keyloom's sentence", () => {
    const html = panel({ message: INTERNAL_WORDS, code: "internal" });
    expect(html).toContain("Try again");
    expect(html).toContain("Restart keyloom");
    expect(html).toContain("The details are in keyloom&#x27;s log.");
  });

  test("a config deleted in another window says so and offers the other layouts, never a restart (D-534)", () => {
    const html = panel({ message: "no config \"Daily\"", code: "not_found" });
    expect(html).toContain(CONFIG_GONE.replaceAll("'", "&#x27;"));
    expect(html).toContain("Show your other layouts");
    expect(html).not.toContain("Restart keyloom");
    expect(html).not.toContain("Try again");
  });

  test("outside a layout page, a gone config falls back to Restart keyloom, which opens the page on what keyloom has", () => {
    const html = panel({ message: "no config", code: "not_found" }, null);
    expect(html).toContain("Restart keyloom");
    expect(html).not.toContain("Show your other layouts");
  });
});

test("a provider switch that fails says so, keeps the conversation, and can be tried again (R4-18)", () => {
  const html = renderToStaticMarkup(createElement(SwitchFailed, { token: "t", to: "codex", failure: { message: "Can't reach keyloom.", code: "unreachable" }, onRetry: noop, onDismiss: noop }));
  expect(html).toContain("keyloom couldn&#x27;t switch to Codex");
  expect(html).toContain("Your conversation and its model are unchanged.");
  expect(html).toContain("Try again");
});
