import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openApp, importLayout, getLayout, sendMessage, showConversation, proposalRecovery, proposeChange, applyChange, applyOps } from "../../src/app/index.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { draft, setKey } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";
import { fromConversation } from "../../src/web/chat/transcript.ts";
import { owningRequest, proposalContext } from "../../src/web/chat/recovery-context.ts";
import { ProposalCard } from "../../src/web/chat/ProposalCard.tsx";
import { toCard } from "../../src/app/proposal-card.ts";
import { findChangeSet } from "../../src/persistence/change-sets.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { runCli } from "../../src/cli/main.ts";

const goal = "Distinctive original F17 goal: put F17 on my index finger";
const question = { blocks: [{ tool: "ask_user", input: { question: "Which hand do you prefer?", considerations: ["The target should be comfortable."], step: { n: 1, of: 1 }, options: [{ label: "Left" }, { label: "Right" }] } }] };
const props = { pinned: false, onPreview: () => {}, onPin: () => {}, onApply: async () => {}, onAskAgain: () => {}, onOpenRelease: () => {} };

test("an actual answer-owned refusal retains its original request after reload in web and CLI, without later unrelated text", async () => {
  const dataDir = tempDir(); let app = openApp({ dataDir });
  try {
    const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
    const fake = fakeAnthropic([question, { blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Refused after answer", ops: setKey(33, "F17", "missing"), explanation: "Use the preferred hand.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() }] } }] }, { blocks: [{ text: "The target was refused." }] }, { blocks: [{ text: "Unrelated request acknowledged." }] }]);
    const model = anthropicModel(fake.client);
    const first = await sendMessage(app, layoutId, { message: goal, model });
    expect(first.question).toBeDefined();
    const refused = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: first.question!.toolUseId, text: "Left" }, model });
    expect(refused.proposals).toHaveLength(0);
    await sendMessage(app, layoutId, { conversationId: first.conversationId, message: "Unrelated later request about colors", model });
    app.db.close(); app = openApp({ dataDir });
    const before = app.db.serialize();
    const turns = fromConversation(showConversation(app, first.conversationId)).turns;
    const owner = turns.find((turn) => turn.kind === "assistant" && turn.userMessageId === refused.messageIds[0]);
    expect(owner?.kind).toBe("assistant");
    const web = owner?.kind === "assistant" ? owningRequest(turns, owner) : undefined;
    const cli = proposalRecovery(app, layoutId, { conversation: first.conversationId, turn: refused.messageIds[0]! });
    for (const request of [web, cli.context.goal]) {
      expect(request).toContain(goal);
      expect(request).toContain("Answer to “Which hand do you prefer?”: Left");
      expect(request).not.toContain("Unrelated later request");
      expect(request?.split(goal)).toHaveLength(2);
    }
    let output = "";
    const code = await runCli(["agent", "replan", layoutId, "--conversation", first.conversationId, "--turn", refused.messageIds[0]!, "--draft", "--json", "--data-dir", dataDir], { out: (text) => { output += text; }, err: () => {}, isTTY: false });
    expect(code).toBe(0); expect(JSON.parse(output).context.goal).toBe(cli.context.goal);
    expect(app.db.serialize()).toEqual(before);
  } finally { app.db.close(); }
});

test("a real saved revised proposal retains root goal and refining answer, not the later request", async () => {
  const app = openApp({ dataDir: tempDir() });
  try {
    const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
    let originalId = "";
    const alternative = { title: "Index F17", ops: setKey(33, "F17"), explanation: "Give the index finger F17.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() };
    const fake = fakeAnthropic([{ blocks: [{ tool: "propose_changes", input: { alternatives: [alternative] } }] }, question, () => ({ blocks: [{ tool: "propose_changes", input: { alternatives: [{ ...alternative, title: "Revised index F17" }], supersedes: originalId } }] }), { blocks: [{ text: "Revised for the selected hand." }] }, { blocks: [{ text: "Unrelated request acknowledged." }] }]);
    const model = anthropicModel(fake.client);
    const first = await sendMessage(app, layoutId, { message: goal, model }); originalId = first.proposals[0]!.changeSetId;
    const revised = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: first.question!.toolUseId, text: "Left" }, model });
    expect(revised.proposals).toHaveLength(1);
    await sendMessage(app, layoutId, { conversationId: first.conversationId, message: "Unrelated later request about colors", model });
    applyOps(app, layoutId, { baseRevisionId: getLayout(app, layoutId).revision.id, ops: setKey(33, "F19"), summary: "Synthetic conflict" });
    const turns = fromConversation(showConversation(app, first.conversationId)).turns;
    const card = revised.proposals[0]!;
    const web = proposalContext(card, ["Synthetic conflict"], turns);
    const cli = proposalRecovery(app, layoutId, { proposal: card.changeSetId });
    for (const context of [web, cli.context]) {
      expect(context.goal).toContain(goal); expect(context.goal).toContain("Answer to “Which hand do you prefer?”: Left");
      expect(context.goal).not.toContain("Unrelated later request"); expect(context.goal.split(goal)).toHaveLength(2);
    }
  } finally { app.db.close(); }
});

test("a second refining answer keeps the ordered original question chain in both surfaces", async () => {
  const app = openApp({ dataDir: tempDir() });
  try {
    const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
    const fake = fakeAnthropic([question, { blocks: [{ tool: "ask_user", input: { question: "Which finger should receive F17?", considerations: ["Keep the selected hand."], step: { n: 2, of: 2 }, options: [{ label: "Index" }, { label: "Thumb" }] } }] }, { blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Refused after two answers", ops: setKey(33, "F17", "missing"), explanation: "Use the selected finger.", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() }] } }] }, { blocks: [{ text: "Validation refused the target." }] }]);
    const model = anthropicModel(fake.client);
    const first = await sendMessage(app, layoutId, { message: goal, model });
    const second = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: first.question!.toolUseId, text: "Left" }, model });
    const refused = await sendMessage(app, layoutId, { conversationId: first.conversationId, answer: { toolUseId: second.question!.toolUseId, text: "Index" }, model });
    expect(refused.proposals).toHaveLength(0);
    const turns = fromConversation(showConversation(app, first.conversationId)).turns;
    const owner = turns.find((turn) => turn.kind === "assistant" && turn.userMessageId === refused.messageIds[0]);
    const expected = `${goal}\n\nAnswer to “Which hand do you prefer?”: Left\n\nAnswer to “Which finger should receive F17?”: Index`;
    expect(owner?.kind === "assistant" ? owningRequest(turns, owner) : undefined).toBe(expected);
    expect(proposalRecovery(app, layoutId, { conversation: first.conversationId, turn: refused.messageIds[0]! }).context.goal).toBe(expected);
  } finally { app.db.close(); }
});

test("actual applied non-idempotent addLayer history uses its saved validation in compact and full cards", async () => {
  const app = openApp({ dataDir: tempDir() });
  try {
    const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
    const before = getLayout(app, layoutId);
    const proposal = proposeChange(app, layoutId, { source: "agent", proposalGroup: "recovery-history", title: "Add a synthetic layer", explanation: "Add a new layer for later editing.", ops: [{ op: "addLayer", layer: { id: "recovery-added", name: "Recovery added" }, afterLayerId: before.document.layers.at(-1)!.id }] });
    const sibling = proposeChange(app, layoutId, { source: "agent", proposalGroup: "recovery-history", title: "Alternative synthetic layer", explanation: "Another way to request the same unused layer.", ops: proposal.ops });
    applyChange(app, proposal.id);
    const after = getLayout(app, layoutId); const card = toCard(findChangeSet(app.db, proposal.id)!);
    expect(card.status).toBe("applied"); expect(card.validation.ok).toBe(true);
    expect(evaluate(after.board.definition, after.document, card.ops).result.ok).toBe(false);
    const superseded = toCard(findChangeSet(app.db, sibling.id)!); expect(superseded.status).toBe("superseded");
    for (const history of [card, superseded]) for (const compact of [true, false]) {
      const html = renderToStaticMarkup(createElement(ProposalCard, { ...props, proposal: history, layout: after.document, board: after.board.definition, compact }));
      expect(html).toContain(history.status === "applied" ? "Applied" : "Superseded"); expect(html).not.toContain('data-tone="error"'); expect(html).not.toContain("Plan a revised proposal");
    }
  } finally { app.db.close(); }
});

test("a saved-valid proposal whose target layer was actually removed disables every Apply variant", async () => {
  const app = openApp({ dataDir: tempDir() });
  try {
    const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
    const before = getLayout(app, layoutId);
    applyOps(app, layoutId, { baseRevisionId: before.revision.id, ops: [{ op: "addLayer", layer: { id: "recovery-target", name: "Recovery target" }, afterLayerId: before.document.layers.at(-1)!.id }], summary: "Add unused synthetic target" });
    const proposal = proposeChange(app, layoutId, { source: "agent", title: "F17 on target", explanation: "Give the unused target F17.", ops: setKey(33, "F17", "recovery-target") });
    const valid = getLayout(app, layoutId);
    const validHtml = renderToStaticMarkup(createElement(ProposalCard, { ...props, proposal: toCard(findChangeSet(app.db, proposal.id)!), layout: valid.document, board: valid.board.definition, compact: true }));
    const validApply = validHtml.match(/<button[^>]*class="bar-apply"[^>]*>/)?.[0];
    expect(validApply).toBeDefined(); expect(validApply).not.toContain("disabled");
    applyOps(app, layoutId, { baseRevisionId: getLayout(app, layoutId).revision.id, ops: [{ op: "removeLayer", layerId: "recovery-target" }], summary: "Remove unused synthetic target" });
    const after = getLayout(app, layoutId); const card = toCard(findChangeSet(app.db, proposal.id)!);
    expect(card.validation.ok).toBe(true); expect(evaluate(after.board.definition, after.document, card.ops).result.ok).toBe(false);
    for (const variant of [{ compact: true }, { compact: true, line: true }, { compact: false }]) {
      const html = renderToStaticMarkup(createElement(ProposalCard, { ...props, ...variant, proposal: card, layout: after.document, board: after.board.definition }));
      const apply = html.match(/<button[^>]*>(?:Apply(?:<|$))[\s\S]*?<\/button>/)?.[0];
      expect(html).toContain("Plan a revised proposal"); expect(apply).toBeDefined(); expect(apply).toContain('disabled=""');
    }
  } finally { app.db.close(); }
});
