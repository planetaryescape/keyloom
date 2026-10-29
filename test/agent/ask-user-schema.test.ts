// The two shapes of a question (D-452): the model is held to considerations and a step; what is stored reads without them.
import { describe, expect, test } from "bun:test";
import { AskUserSchema, MAX_QUESTIONS, StoredQuestionSchema } from "../../src/agent/tools/ask-user.ts";
import { recommendedFirst } from "../../src/app/conversations.ts";

const ok = { question: "Which?", considerations: ["It matters."], step: { n: 1, of: 2 }, options: [{ label: "A" }, { label: "B" }] };

describe("what the model must send", () => {
  test("accepts one to three short considerations and a step with n at most of", () => {
    expect(AskUserSchema.safeParse(ok).success).toBe(true);
    expect(AskUserSchema.safeParse({ ...ok, considerations: ["a", "b", "c"] }).success).toBe(true);
    expect(AskUserSchema.safeParse({ ...ok, step: { n: 2, of: 2 } }).success).toBe(true);
  });

  test("refuses missing, empty, too many or too long considerations", () => {
    const { considerations: _dropped, ...without } = ok;
    expect(AskUserSchema.safeParse(without).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, considerations: [] }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, considerations: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, considerations: ["x".repeat(101)] }).success).toBe(false);
  });

  test("refuses a missing step, n above of, a count above the cap and non-integers", () => {
    const { step: _dropped, ...without } = ok;
    expect(AskUserSchema.safeParse(without).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, step: { n: 3, of: 2 } }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, step: { n: 1, of: MAX_QUESTIONS + 1 } }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, step: { n: 0, of: 2 } }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, step: { n: 1.5, of: 2 } }).success).toBe(false);
  });

  test("a refining question has two or three options; the pickers keep their longer lists", () => {
    const four = [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }];
    expect(AskUserSchema.safeParse({ ...ok, options: four }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, kind: "single_choice", options: four }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, options: [{ label: "A" }] }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, options: undefined }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, options: four.slice(0, 3) }).success).toBe(true);
    for (const kind of ["key", "layer", "keyboard_or_config", "multiple_choice"] as const) expect(AskUserSchema.safeParse({ ...ok, kind, options: four }).success).toBe(true);
    expect(AskUserSchema.safeParse({ ...ok, kind: "short_text", options: undefined }).success).toBe(true);
  });

  test("keeps the limits it had", () => {
    expect(AskUserSchema.safeParse({ ...ok, question: "x".repeat(241) }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, options: [{ label: "x".repeat(61) }] }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, options: [{ label: "A", description: "x".repeat(161) }] }).success).toBe(false);
    expect(AskUserSchema.safeParse({ ...ok, kind: "key", options: undefined }).success).toBe(true);
  });
});

describe("what is stored", () => {
  test("a question from before the loop parses, so its card is not lost while the conversation waits for its answer", () => {
    expect(StoredQuestionSchema.safeParse({ question: "Which?", options: [{ label: "A" }] }).success).toBe(true);
    expect(StoredQuestionSchema.safeParse(ok).success).toBe(true);
  });

  test("a stored four-option refining question, which the model schema now refuses, still loads", () => {
    const four = { ...ok, options: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }] };
    expect(AskUserSchema.safeParse(four).success).toBe(false);
    expect(StoredQuestionSchema.safeParse(four).success).toBe(true);
  });
});

describe("recommended first", () => {
  const labels = (options: Array<{ label: string; recommended?: boolean }>) => recommendedFirst(options).map((o) => [o.label, o.recommended]);
  test("moves the marked option to the front and leaves it the only one marked", () => {
    expect(labels([{ label: "A" }, { label: "B", recommended: true }, { label: "C" }])).toEqual([["B", true], ["A", undefined], ["C", undefined]]);
    expect(labels([{ label: "A", recommended: true }, { label: "B", recommended: true }])).toEqual([["A", true], ["B", undefined]]);
  });

  test("with none marked the first is the recommendation, unless it says it is not", () => {
    expect(labels([{ label: "A" }, { label: "B" }])).toEqual([["A", true], ["B", undefined]]);
    expect(labels([{ label: "A", recommended: false }, { label: "B" }])).toEqual([["B", true], ["A", undefined]]);
    expect(labels([{ label: "A", recommended: false }])).toEqual([["A", false]]);
    expect(labels([])).toEqual([]);
  });
});
