import { expect, test } from "bun:test";
import { missingFieldsWords } from "../../src/web/decisions/decision-text.ts";

test("Save says which fields it waits for, by their labels, and nothing once they are filled (R6-24)", () => {
  expect(missingFieldsWords([])).toBeNull();
  expect(missingFieldsWords(["Why"])).toBe("Fill in Why to save.");
  expect(missingFieldsWords(["Goal", "Why"])).toBe("Fill in Goal and Why to save.");
  expect(missingFieldsWords(["Goal", "What was chosen", "Why"])).toBe("Fill in Goal, What was chosen and Why to save.");
});
