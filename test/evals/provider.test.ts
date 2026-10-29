// The shared key-naming check of the live evals (evals/provider.ts, D-279) reads a question as well as a reply, so every scenario that
// uses it catches "key 43" said in an ask_user card.
import { describe, expect, test } from "bun:test";
import type { ChatOutcome } from "../../src/app/index.ts";
import { namesNoKeyNumbers } from "../../evals/provider.ts";

// SAFETY: namesNoKeyNumbers reads only text, proposals and question; the other fields of a ChatOutcome are not looked at.
const outcome = (over: Partial<ChatOutcome>): ChatOutcome => ({ text: "", proposals: [], ...over }) as ChatOutcome;
const question = (over: Partial<NonNullable<ChatOutcome["question"]>>): NonNullable<ChatOutcome["question"]> =>
  ({ toolUseId: "q", question: "Which hand?", options: [{ label: "Right" }], allowOther: false, answer: null, ...over });

describe("namesNoKeyNumbers", () => {
  test("passes a reply and a question that name keys by legend and place", () => {
    expect(namesNoKeyNumbers([outcome({ text: "Done.", question: question({ question: "Should the Tab key on the left pinky move?" }) })])).toBe(true);
  });

  test("fails a number in the question, its considerations or an option", () => {
    expect(namesNoKeyNumbers([outcome({ question: question({ question: "Should key 43 move?" }) })])).toBe(false);
    expect(namesNoKeyNumbers([outcome({ question: question({ considerations: ["Position 30 is a pinky key."] }) })])).toBe(false);
    expect(namesNoKeyNumbers([outcome({ question: question({ options: [{ label: "Keep", description: "Leaves key 12 alone" }] }) })])).toBe(false);
  });
});
