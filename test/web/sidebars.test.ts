import { expect, test } from "bun:test";
import { sidebarAfterUpdate, type Sidebar } from "../../src/web/shell/sidebars.ts";

test("Settings replaces the board review, and closing Settings never reveals the old review", () => {
  const settings = sidebarAfterUpdate("review", "settings", true);
  expect(settings).toBe("settings");
  expect(sidebarAfterUpdate(settings, "settings", false)).toBeNull();
});

test("a delayed close from Hints cannot close the Settings panel that replaced it", () => {
  expect(sidebarAfterUpdate("settings", "review", false)).toBe("settings");
});

test("every panel can replace every other panel without stacking or resurrecting it", () => {
  const panels: Sidebar[] = ["chat", "repeat", "combos", "history", "library", "settings", "lab", "proposals", "review"];
  for (const previous of panels) for (const next of panels) {
    const selected = sidebarAfterUpdate(previous, next, true);
    expect(selected).toBe(next);
    expect(sidebarAfterUpdate(selected, next, false)).toBeNull();
    if (previous !== next) expect(sidebarAfterUpdate(selected, previous, false)).toBe(next);
  }
});
