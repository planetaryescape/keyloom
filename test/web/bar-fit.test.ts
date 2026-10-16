import { describe, expect, test } from "bun:test";
import { conversationTitle } from "../../src/app/conversations.ts";
import { fitBar, FULL_BAR_PX, LINE_BAR_PX, MIN_FULL_BAR_PX } from "../../src/web/chat/bar-fit.ts";
import { optionLabels, shortTitle } from "../../src/web/chat/proposal-facts.ts";

describe("the bar shares the stage without shrinking the board (P3 review)", () => {
  const caption = { bottom: 180, right: 200 };
  test("with room below the board, nothing moves and the bar takes it", () => {
    const fit = fitBar({ stage: { top: 60, bottom: 900 }, board: { top: 200, bottom: 520, left: 300 }, caption });
    expect(fit).toEqual({ lift: 0, room: 900 - 16 - 520 - 12, collapsed: false });
  });

  test("short of room, the board moves up beside the caption to make it, as comp d does", () => {
    const fit = fitBar({ stage: { top: 60, bottom: 900 }, board: { top: 212, bottom: 710, left: 250 }, caption });
    expect(fit.collapsed).toBe(false);
    expect(fit.room).toBeGreaterThanOrEqual(FULL_BAR_PX - 1);
    expect(fit.lift).toBeGreaterThan(0);
  });

  test("under the caption, the board stops at the caption's foot", () => {
    const fit = fitBar({ stage: { top: 60, bottom: 900 }, board: { top: 212, bottom: 710, left: 100 }, caption });
    expect(fit.lift).toBeLessThanOrEqual(212 - 188);
  });

  test("when even that can't make room, the bar folds to one line and the board stays whole", () => {
    const fit = fitBar({ stage: { top: 60, bottom: 577 }, board: { top: 144, bottom: 470, left: 250 }, caption: { bottom: 130, right: 120 } });
    expect(fit.collapsed).toBe(true);
    expect(fit.room).toBeGreaterThanOrEqual(LINE_BAR_PX);
    expect(fit.room).toBeLessThan(MIN_FULL_BAR_PX);
  });
});

describe("titles cut at words, never mid-word", () => {
  test("a tab's short label", () => {
    expect(shortTitle("Swap Backspace and Nav one-shot", 22)).toBe("Swap Backspace and Nav…");
    expect(shortTitle("Red thumb key", 22)).toBe("Red thumb key");
  });

  test("option tabs drop the words every option starts with, so they read apart", () => {
    expect(optionLabels(["Plain Option on the left outer thumb key", "Plain Option on the right thumb key"])).toEqual(["Left outer thumb key", "Right thumb key"]);
    expect(optionLabels(["Swap with D", "Red thumb key"])).toEqual(["Swap with D", "Red thumb key"]);
  });

  test("a conversation's title", () => {
    const title = conversationTitle("Option is a hold on my S key and I keep firing it by accident when I type fast words");
    expect(title.endsWith("…")).toBe(true);
    expect(title).toBe("Option is a hold on my S key and I keep firing it by…");
    expect(conversationTitle("  short   one ")).toBe("short one");
  });
});
