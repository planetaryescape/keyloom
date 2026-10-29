// The refine loop's cards (D-452): the question with its position and considerations, a proposal a revision replaced, the function a proposal
// drops, and the transcript marking the old proposal as the new one streams in.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatEvent, ProposalCard, QuestionCard as Question } from "../../src/api/http.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { QuestionCard } from "../../src/web/chat/QuestionCard.tsx";
import { AssistantMessage } from "../../src/web/chat/Turns.tsx";
import {
  EMPTY, type AssistantTurn, type Turn, type Transcript, openProposalsOnBoard, questionOpen, questionSkipped, transcriptReducer,
} from "../../src/web/chat/transcript.ts";
import { loadFixture } from "../server/fixture.ts";

const fixture = await loadFixture();
const ops: ChangeOp[] = [{ op: "setBinding", at: { layerId: "base", position: 57 }, binding: { kind: "modifier", mods: ["LALT"] } }];
const validation = evaluate(fixture.board, fixture.document, ops).result;
const card = (id: string, over: Partial<ProposalCard> = {}): ProposalCard => ({
  changeSetId: id, proposalGroup: `g_${id}`, title: `Option ${id}`, explanation: "A plain Option on the free key. It keeps every other key where it is.",
  tradeoffs: { gains: ["Option is one press"], costs: ["Nothing else moves"] }, decisionDraft: null, status: "proposed", validation, ops, ...over,
});
const question = (over: Partial<Question> = {}): Question => ({
  toolUseId: "q1", question: "Which hand is free?", options: [{ label: "Right hand", recommended: true }, { label: "Left hand" }], allowOther: false, answer: null, ...over,
});
const turn = (id: string, over: Partial<AssistantTurn> = {}): AssistantTurn => ({
  kind: "assistant", id, text: "", activity: null, proposals: [], priorities: [], question: null, phase: "done", failure: null, ending: "complete", ...over,
});
const renderQuestion = (q: Question, skipped = false) => renderToStaticMarkup(createElement(QuestionCard, { question: q, skipped, onAnswer: () => {} }));
const renderTurn = (t: AssistantTurn, revised: string[] = [], working?: Parameters<typeof AssistantMessage>[0]["working"]) => renderToStaticMarkup(createElement(AssistantMessage, {
  ...(working === undefined ? {} : { working }),
  turn: t, layout: fixture.document, board: fixture.board, pinnedId: t.proposals.at(-1)?.changeSetId ?? null, compact: true, revised: new Set(revised),
  onPreview: () => {}, onPin: () => {}, onApply: async () => {}, onRemovePriority: async () => {}, onAskAgain: () => {}, onOpenRelease: () => {}, onRetry: () => {}, onAnswer: () => {},
}));

describe("the question card", () => {
  test("says which question it is, what matters, and marks only the first option recommended", () => {
    const html = renderQuestion(question({ step: { n: 1, of: 2 }, considerations: ["The other hand presses the letter.", "Nothing you said answers it."] }));
    expect(html).toContain("Question 1 of 2");
    expect(html).toContain("The other hand presses the letter.");
    expect(html).toContain("Nothing you said answers it.");
    expect(html.match(/Recommended/g)).toHaveLength(1);
    expect(html.indexOf("Right hand")).toBeLessThan(html.indexOf("Left hand"));
  });

  test("a lone question has no count, and a question stored before the loop has neither count nor considerations", () => {
    expect(renderQuestion(question({ step: { n: 1, of: 1 }, considerations: ["It matters."] }))).not.toContain("Question 1 of");
    const old = renderQuestion(question());
    expect(old).not.toContain("Question ");
    expect(old).not.toContain("What matters");
    expect(old).toContain("Which hand is free?");
  });

  test("an answered question is a quiet line with no count, and one whose proposal was applied reads as skipped", () => {
    const answered = renderQuestion(question({ step: { n: 1, of: 2 }, answer: "Left hand" }));
    expect(answered).toContain("Left hand");
    expect(answered).not.toContain("Question 1 of 2");
    const skipped = renderQuestion(question({ step: { n: 1, of: 2 } }), true);
    expect(skipped).toContain("Skipped, you applied the proposal");
    expect(skipped).not.toContain("<ol");
  });
});

describe("a question's state in a reply", () => {
  test("is open until it is answered or skipped, and skipped is what the server says, so it holds after a reload", () => {
    expect(questionOpen(turn("a", { question: question(), proposals: [card("p1")] }))).toBe(true);
    const skipped = turn("a", { question: question({ answer: "BK applied the proposal without answering.", skipped: true }), proposals: [card("p1")] });
    expect(questionSkipped(skipped)).toBe(true);
    expect(questionOpen(skipped)).toBe(false);
    expect(questionOpen(turn("a", { question: question({ answer: "x" }), proposals: [card("p1")] }))).toBe(false);
    expect(questionSkipped(turn("a", { question: question({ answer: "x" }) }))).toBe(false);
  });

  test("applying the newest proposal skips the open question even when it was asked in a later reply, and it stays skipped after a message", () => {
    const sentFirst = { type: "sent" as const, userId: "u1", assistantId: "a1", text: "go", selection: null };
    const ev = (event: ChatEvent) => ({ type: "event" as const, event });
    // P1 in reply 1. Reply 2, to a message, has a question and no proposal of its own: the question refines P1 across the turns.
    const outcome = (over: object) => ({ conversationId: "c", messageIds: ["m"], status: "complete" as const, text: "", proposals: [], priorities: [], provider: "anthropic" as const, model: "m", effort: "medium", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, iterations: 1, ...over });
    const t1 = [
      sentFirst, ev({ type: "proposal", proposal: card("p1") }), ev({ type: "done", outcome: outcome({ proposals: [card("p1")] }) }),
      { type: "sent" as const, userId: "u2", assistantId: "a2", text: "and the thumb?", selection: null },
      ev({ type: "done", outcome: outcome({ status: "awaiting_answer", question: question({ toolUseId: "q2", answer: null }) }) }),
    ].reduce(transcriptReducer, EMPTY);
    const applied = transcriptReducer(t1, { type: "applied", changeSetId: "p1" });
    const asked = (t: Transcript) => t.turns.filter((x): x is AssistantTurn => x.kind === "assistant").find((x) => x.question !== null);
    expect(asked(applied)?.question).toMatchObject({ skipped: true });
    expect(questionOpen(asked(applied) as AssistantTurn)).toBe(false);
    // A message afterwards leaves it skipped and does not turn it into "answered in your own words".
    const later = transcriptReducer(applied, { type: "sent", userId: "u3", assistantId: "a3", text: "thanks", selection: null });
    expect(asked(later)?.question).toMatchObject({ skipped: true, answer: "Skipped" });
  });

  test("applying a proposal that is not the newest leaves the question open", () => {
    const sentFirst = { type: "sent" as const, userId: "u1", assistantId: "a1", text: "go", selection: null };
    const ev = (event: ChatEvent) => ({ type: "event" as const, event });
    const t = [sentFirst, ev({ type: "proposal", proposal: card("p1", { proposalGroup: "g1" }) }), ev({ type: "proposal", proposal: card("p2", { proposalGroup: "g2" }) }), ev({ type: "done", outcome: { conversationId: "c", messageIds: ["m"], status: "awaiting_answer", text: "", proposals: [], priorities: [], provider: "anthropic", model: "m", effort: "medium", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, iterations: 1, question: question({ answer: null }) } })].reduce(transcriptReducer, EMPTY);
    const after = transcriptReducer(t, { type: "applied", changeSetId: "p1" });
    expect((after.turns.find((x): x is AssistantTurn => x.kind === "assistant"))?.question?.answer).toBeNull();
  });
});

describe("the work row of a reply with a skipped question", () => {
  test("stops saying it needs an answer once the question is skipped, though the stored run still waits", () => {
    const waiting = { kind: "unavailable", status: "waiting" } as const;
    expect(renderTurn(turn("a", { question: question(), proposals: [card("p1")] }), [], waiting)).toContain("Needs your answer");
    const skipped = turn("a", { question: question({ answer: "BK applied the proposal without answering.", skipped: true }), proposals: [card("p1", { status: "applied" })] });
    expect(renderTurn(skipped, [], waiting)).not.toContain("Needs your answer");
  });
});

describe("a proposal in chat after a revision", () => {
  test("a superseded one is a line that says by what, with Details and no Apply", () => {
    const html = renderTurn(turn("a", { proposals: [card("p1", { status: "superseded" })] }), ["p1"]);
    expect(html).toContain("Superseded by the revised proposal");
    expect(html).toContain("Details");
    expect(html).not.toContain("Apply");
    expect(html).not.toContain("proposal-tabs");
    // One set aside because a sibling was applied is plain "Superseded".
    expect(renderTurn(turn("a", { proposals: [card("p1", { status: "superseded" })] }))).not.toContain("by the revised proposal");
  });

  test("one proposal has no tabs, and a stored group of two still has them", () => {
    expect(renderTurn(turn("a", { proposals: [card("p1")] }))).not.toContain("proposal-tabs");
    expect(renderTurn(turn("a", { proposals: [card("p1", { proposalGroup: "g" }), card("p2", { proposalGroup: "g" })] }))).toContain("proposal-tabs");
  });
});

describe("a proposal that drops a function (docs/issues/compact-card-hides-dropped-functions.md)", () => {
  test("the compact card names each dropped function and its reason at rest", () => {
    const dropping = card("p1", { validation: { ...validation, diff: { ...validation.diff, dropped: [{ function: "key:F16", reason: "you said you barely use it" }, { function: "key:F17", reason: "nothing else uses it" }] } } });
    const html = renderTurn(turn("a", { proposals: [dropping] }));
    expect(html).toContain("Drops F16");
    expect(html).toContain("you said you barely use it");
    expect(html).toContain("Drops F17");
    expect(html).toContain("nothing else uses it");
    // At rest, not inside the collapsed Details.
    expect(html.indexOf("Drops F16")).toBeLessThan(html.indexOf("Details"));
    expect(renderTurn(turn("a", { proposals: [card("p2")] }))).not.toContain("Drops");
  });
});

describe("the transcript as a revision streams in", () => {
  const sent = { type: "sent" as const, userId: "u1", assistantId: "a1", text: "go", selection: null };
  const ev = (event: ChatEvent) => ({ type: "event" as const, event });
  const run = (actions: Parameters<typeof transcriptReducer>[1][], from: Transcript = EMPTY) => actions.reduce(transcriptReducer, from);
  const doneOutcome = (proposals: ProposalCard[]) => ({
    conversationId: "c1", messageIds: ["m1"], status: "complete" as const, text: "", proposals, priorities: [], provider: "anthropic" as const, model: "m", effort: "medium",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, iterations: 1,
  });
  const statuses = (t: Transcript) => t.turns.flatMap((x) => (x.kind === "assistant" ? x.proposals.map((p) => `${p.changeSetId}:${p.status}`) : []));

  test("the new card marks the old one superseded, even in an earlier reply, and the stream's last event does too", () => {
    const first = run([sent, ev({ type: "proposal", proposal: card("p1") }), ev({ type: "done", outcome: doneOutcome([card("p1")]) })]);
    expect(statuses(first)).toEqual(["p1:proposed"]);
    const second = run([
      { type: "sent", userId: "u2", assistantId: "a2", text: "No", selection: null },
      ev({ type: "proposal", proposal: card("p2", { supersedes: "p1" }) }),
    ], first);
    expect(statuses(second)).toEqual(["p1:superseded", "p2:proposed"]);
    // A proposal event that was missed is made good by the outcome.
    const missed = run([
      { type: "sent", userId: "u2", assistantId: "a2", text: "No", selection: null },
      ev({ type: "done", outcome: doneOutcome([card("p2", { supersedes: "p1" })]) }),
    ], first);
    expect(statuses(missed)).toEqual(["p1:superseded", "p2:proposed"]);
  });

  test("a proposal that is not a revision leaves the one beside it open", () => {
    const first = run([sent, ev({ type: "proposal", proposal: card("p1") }), ev({ type: "done", outcome: doneOutcome([card("p1")]) })]);
    const second = run([{ type: "sent", userId: "u2", assistantId: "a2", text: "also", selection: null }, ev({ type: "proposal", proposal: card("p2", { supersedes: null }) })], first);
    expect(statuses(second)).toEqual(["p1:proposed", "p2:proposed"]);
  });
});

describe("the proposals the board shows", () => {
  const done = (id: string, over: Partial<AssistantTurn> = {}) => turn(id, over);
  test("an answer that proposes nothing leaves the earlier open proposal on the board", () => {
    const turns: Turn[] = [done("a1", { proposals: [card("p1")], question: question({ answer: "x" }) }), { kind: "user", id: "u2", text: "ok", selection: null }, done("a2", { text: "That changes nothing." })];
    expect(openProposalsOnBoard(turns).map((p) => p.changeSetId)).toEqual(["p1"]);
  });

  test("a revision is on the board the moment it arrives, while the reply is still streaming", () => {
    const turns: Turn[] = [done("a1", { proposals: [card("p1", { status: "superseded" })] }), done("a2", { phase: "streaming", ending: null, proposals: [card("p2", { supersedes: "p1" })] })];
    expect(openProposalsOnBoard(turns).map((p) => p.changeSetId)).toEqual(["p2"]);
  });

  test("a revision saved in a reply that was then cut off stays on the board, in place of the old preview", () => {
    const failed = done("a2", { phase: "failed", ending: null, failure: { code: "model_connection", message: "gone" }, proposals: [card("p2", { supersedes: "p1" })] });
    const stopped = done("a2", { phase: "stopped", ending: null, proposals: [card("p2", { supersedes: "p1" })] });
    for (const last of [failed, stopped]) {
      expect(openProposalsOnBoard([done("a1", { proposals: [card("p1", { status: "superseded" })] }), last]).map((p) => p.changeSetId)).toEqual(["p2"]);
    }
  });

  test("the newest reply's open proposal wins over an older one, and a reply with none leaves the older one", () => {
    const turns: Turn[] = [done("a1", { proposals: [card("p1")] }), done("a2", { proposals: [card("p2")] })];
    expect(openProposalsOnBoard(turns).map((p) => p.changeSetId)).toEqual(["p2"]);
    expect(openProposalsOnBoard([...turns, done("a3", { phase: "streaming" })]).map((p) => p.changeSetId)).toEqual(["p2"]);
    expect(openProposalsOnBoard([done("a1", { proposals: [card("p1", { status: "applied" })] })])).toEqual([]);
  });
});
