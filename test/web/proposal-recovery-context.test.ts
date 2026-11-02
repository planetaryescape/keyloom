import { expect, test } from "bun:test";
import { owningRequest } from "../../src/web/chat/recovery-context.ts";
import type { AssistantTurn, Turn } from "../../src/web/chat/transcript.ts";

const reply = (id: string): AssistantTurn => ({ kind: "assistant", id, userMessageId: "canonical-owner", text: "", activity: null, proposals: [], priorities: [], question: null, phase: "done", failure: null, ending: "complete" });
test("original request belongs to its selected reply, not a newer unrelated user", () => {
  const owner = reply("selected");
  const turns: Turn[] = [{ kind: "user", id: "canonical-owner", text: "Original goal", selection: null }, owner, { kind: "user", id: "newer", text: "Unrelated goal", selection: null }];
  expect(owningRequest(turns, owner)).toBe("Original goal");
});
test("only the immediately preceding optimistic user can substitute for a canonical owner", () => {
  const owner = reply("selected");
  const user: Turn = { kind: "user", id: "you-1", text: "Optimistic original", selection: null };
  expect(owningRequest([user, owner], owner)).toBe("Optimistic original");
  expect(owningRequest([{ ...user, id: "foreign-canonical" }, owner], owner)).toBeUndefined();
  expect(owningRequest([user, reply("unrelated"), owner], owner)).toBeUndefined();
});
