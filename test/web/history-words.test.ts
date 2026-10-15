import { describe, expect, test } from "bun:test";
import { formatWhen, sourceLabel } from "../../src/web/history/words.ts";

// A fixed "now" in local time (a Thursday), so the weekday and the day count are the ones a person would say.
const now = new Date(2026, 9, 15, 14, 30).getTime();
const at = (day: number, hour: number, minute = 0, month = 9, year = 2026) => new Date(year, month, day, hour, minute).getTime();

describe("formatWhen", () => {
  test("says just now for the last minute, and today for the rest of the day", () => {
    expect(formatWhen(now - 20_000, now)).toBe("Just now");
    expect(formatWhen(at(15, 9, 5), now)).toMatch(/^Today /);
  });

  test("counts calendar days, so 23:50 yesterday is yesterday and not today", () => {
    expect(formatWhen(at(14, 23, 50), now)).toMatch(/^Yesterday /);
    expect(formatWhen(at(14, 0, 5), now)).toMatch(/^Yesterday /);
  });

  test("names the weekday for the rest of the last week: last Tuesday is Tuesday", () => {
    expect(formatWhen(at(13, 18, 32), now)).toMatch(/^Tuesday /);
    expect(formatWhen(at(9, 18, 32), now)).toMatch(/^Friday /);
  });

  test("a week or more back is a date, with the year only when it isn't this one", () => {
    // Day-and-month order follows the browser's locale, so only what is the same everywhere is asserted.
    expect(formatWhen(at(8, 10), now)).not.toMatch(/Today|Yesterday|day /);
    expect(formatWhen(at(8, 10), now)).not.toContain("2026");
    expect(formatWhen(at(8, 10, 0, 11, 2025), now)).toContain("2025");
  });

  test("a time from the future (clock skew) is not 'just now'", () => {
    expect(formatWhen(now + 120_000, now)).toMatch(/^Today /);
  });
});

describe("sourceLabel", () => {
  test("uses the words BK knows: the chat, not the agent", () => {
    expect(sourceLabel("agent")).toBe("Chat");
    expect(sourceLabel("editor")).toBe("Editor");
    expect(sourceLabel("import")).toBe("Import");
    expect(sourceLabel("undo")).toBe("Undo");
  });
});
