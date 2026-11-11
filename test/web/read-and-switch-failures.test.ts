import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { SwitchFailed } from "../../src/web/chat/ChatStates.tsx";
import { OpenProposals } from "../../src/web/keyboards/OpenProposals.tsx";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
const noop = () => {};

describe("a failed read is not an empty list (R4-08)", () => {
  const panel = (readFailed: boolean) => renderToStaticMarkup(createElement(OpenProposals, {
    proposals: [], readFailed, onReadAgain: noop, layout, board: board.definition, configName: "Daily", firstFlash: false, pinnedId: null,
    onPin: noop, onPreview: noop, onApply: async () => {}, onClose: noop, onOpenRelease: noop, onPlanRecovery: noop,
  }));

  test("it says the proposals couldn't be read and offers Try again", () => {
    const html = panel(true);
    expect(html).toContain("couldn&#x27;t read this config&#x27;s proposals");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Nothing is waiting");
  });

  test("a read that worked and found nothing still says nothing is waiting", () => {
    expect(panel(false)).toContain("Nothing is waiting");
  });
});

test("a provider switch that fails says so, keeps the conversation, and can be tried again (R4-18)", () => {
  const html = renderToStaticMarkup(createElement(SwitchFailed, { to: "codex", message: "Can't reach keyloom.", onRetry: noop, onDismiss: noop }));
  expect(html).toContain("keyloom couldn&#x27;t switch to Codex");
  expect(html).toContain("Your conversation and its model are unchanged.");
  expect(html).toContain("Try again");
});
