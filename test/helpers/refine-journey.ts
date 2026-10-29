// The refine loop (D-452) as a scripted model plays it, over BK's Moonlander fixture: one proposal on the board, a question, an answer that
// revises it, a second question, and the final proposal. Shared by the journey tests and `scripts/dev-command-shift.ts`, so the demo shows
// what the tests check. The ids a revision names are read from the earlier tool results, as a real model would.
import type { ScriptStep, SeenRequest } from "./fake-anthropic.ts";
import { draft } from "./ops.ts";

const at = (position: number) => ({ layerId: "layer-0", position });
const cmdShift = { kind: "modifier", mods: ["LGUI", "LSFT"] };

export const REQUEST = "I want one key for Command–Shift. I barely use F16, and keep Backspace where it is.";
export const ANSWER_1 = "No, keep them where they are";
export const ANSWER_2 = "Yes, F16's key is fine";
export const QUICK_REQUEST = "Make F16 Command–Shift, I never use it.";

const tab = {
  title: "Command–Shift where Tab is",
  ops: [
    { op: "setBinding", at: at(42), binding: cmdShift },
    { op: "swapBindings", a: at(44), b: at(45) },
    { op: "swapBindings", a: at(45), b: at(46) },
  ],
  explanation: "Command–Shift takes the Tab key under your left pinky. Tab is still on your left thumb, and X, C and V each move one place left to close the gap.",
  tradeoffs: { gains: ["Command–Shift under the pinky, next to Z", "Backspace and the home row stay put"], costs: ["Cut, copy and paste each move one key"] },
  decisionDraft: draft({ goal: "A Command–Shift key I can press with my left pinky", choice: "Command–Shift where Tab is, with X, C and V each one place left", reason: "It keeps Backspace where it is." }),
};

const f16 = (reason: string) => ({
  title: "Command–Shift on the F16 key",
  ops: [
    { op: "dropFunction", function: "key:F16", reason: "you said you barely use it" },
    { op: "setBinding", at: at(6), binding: cmdShift },
  ],
  explanation: "The F16 key on the top row becomes Command–Shift, and nothing else moves.",
  tradeoffs: { gains: ["Nothing you use moves"], costs: ["A stretch from the home row"] },
  decisionDraft: draft({ goal: "A Command–Shift key I can press with my left pinky", choice: "Command–Shift on the F16 key", reason }),
});

/** The newest change set id a tool result in the conversation so far said it saved. */
export const lastSaved = (seen: SeenRequest): string => {
  const ids = [...JSON.stringify(seen.body.messages).matchAll(/saved as (cs_[A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const id = ids.at(-1);
  if (id === undefined) throw new Error("no saved proposal in the conversation so far");
  return id;
};

/** The script only makes sense after BK's answer: the demo and the journey fail loudly if the answer did not come back as the call's result. */
const answered = (seen: SeenRequest, answer: string) => {
  if (seen.toolResults.length !== 1 || seen.toolResults[0] !== answer) throw new Error(`expected the answer "${answer}" as the tool result, got ${JSON.stringify(seen.toolResults)}`);
};

const question = (n: number, input: object) => ({ tool: "ask_user", input: { step: { n, of: 2 }, ...input } });

/** One conversation, three turns, seven model requests. */
export function refineScript(): ScriptStep[] {
  return [
    // Turn 1: look, remember what he said, put the best proposal on the board, then ask in a reply of its own.
    { blocks: [
      { tool: "get_layout", input: { layers: ["layer-0"] } },
      { tool: "find_function", input: { function: "mod:LGUI+LSFT" } },
      { tool: "record_priority", input: { priorityKind: "pinned", statement: "keep Backspace where it is", subject: { functions: ["key:BACKSPACE"] } } },
      { tool: "record_priority", input: { priorityKind: "rarely_used", statement: "I barely use F16", subject: { functions: ["key:F16"] } } },
    ] },
    { blocks: [{ text: "Command–Shift can go where Tab is, under your left pinky. Backspace stays put." }, { tool: "propose_changes", input: tab }] },
    { blocks: [question(1, {
      question: "Can X, C and V move one place left?",
      considerations: ["Cut, copy and paste sit under the same hand as the new key.", "Moving them is the cost of using Tab's place."],
      // Sent with the recommended option second: the card draws it first.
      options: [
        { label: "No, keep them where they are", description: "Command–Shift goes on a key nothing else needs." },
        { label: "Yes, they can move", description: "Keeps this proposal.", recommended: true },
      ],
    })] },
    // Turn 2: the answer revises the proposal and the old one is superseded.
    (seen) => {
      answered(seen, ANSWER_1);
      return { blocks: [{ tool: "propose_changes", input: { ...f16("You want X, C and V to stay where they are, and you barely use F16."), supersedes: lastSaved(seen) } }] };
    },
    { blocks: [question(2, {
      question: "Is a reach to the top row acceptable?",
      considerations: ["F16 is a long way from the home row.", "Nothing else is as free as it is."],
      options: [{ label: "Yes, F16's key is fine", recommended: true }, { label: "No, find me something closer" }],
    })] },
    // Turn 3: the last answer gives the final proposal, which carries both answers into the decision.
    (seen) => {
      answered(seen, ANSWER_2);
      return { blocks: [{ tool: "propose_changes", input: { ...f16("You want X, C and V to stay where they are, you barely use F16, and a reach to the top row is fine."), supersedes: lastSaved(seen) } }] };
    },
    { blocks: [{ text: "Command–Shift is on the F16 key, and nothing else moves." }] },
  ];
}

/** A request with nothing to ask: one proposal, no question, no supersede. Three requests. */
export function quickScript(): ScriptStep[] {
  return [
    { blocks: [{ tool: "get_layout", input: { layers: ["layer-0"] } }] },
    { blocks: [{ tool: "propose_changes", input: f16("You never use F16, so Command–Shift went on its key.") }] },
    { blocks: [{ text: "F16 is now Command–Shift. I dropped F16, as you said." }] },
  ];
}
