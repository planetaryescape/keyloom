// The mismatch page's Archive (R3-06): hidden for the config on its keyboard, with the reason and another config to put on first.
import { expect, test } from "bun:test";
import type { ApiConfig } from "../../src/api/configs.ts";
import { archiveChoice } from "../../src/web/configs/archive-choice.ts";

const config = (id: string, over: Partial<ApiConfig> = {}): ApiConfig => ({
  id, name: id, boardId: "zsa/moonlander", boardName: "Moonlander", headRevisionId: "rev", createdAt: 1, updatedAt: 1, onKeyboard: false, archivedAt: null, copiedFrom: null, ...over,
});

test("a config that isn't on the keyboard can be archived", () => {
  expect(archiveChoice([config("a", { onKeyboard: true }), config("b")], "b")).toEqual({ kind: "archive" });
  // Not in the list (stale or failed read): the server has the last word.
  expect(archiveChoice([], "b")).toEqual({ kind: "archive" });
});

test("the config on the keyboard offers the most recent other config to put on first", () => {
  const choice = archiveChoice([config("a", { onKeyboard: true }), config("old", { updatedAt: 2 }), config("new", { updatedAt: 9 }), config("gone", { updatedAt: 20, archivedAt: 5 })], "a");
  expect(choice).toMatchObject({ kind: "on_keyboard", boardName: "Moonlander", putOn: { id: "new" } });
  if (choice.kind === "on_keyboard") expect(choice.reason).toBe("It is the config on your Moonlander, so it can't be archived until another is on it. Put new on it first.");
});

test("with no other config, it says why and offers nothing it can't do", () => {
  expect(archiveChoice([config("a", { onKeyboard: true }), config("x", { archivedAt: 3 })], "a")).toEqual({
    kind: "on_keyboard", boardName: "Moonlander", putOn: null, reason: "It is the config on your Moonlander, so it can't be archived until another config is on it.",
  });
});
