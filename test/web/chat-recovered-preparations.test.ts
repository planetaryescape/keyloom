import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectAgentRun, startAgentRun, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { emptyUsage } from "../../src/agent/model.ts";
import { getLayout, listLayouts } from "../../src/app/index.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { runCli } from "../../src/cli/main.ts";
import { AssistantMessage } from "../../src/web/chat/Turns.tsx";
import { EMPTY, fromConversation, transcriptReducer } from "../../src/web/chat/transcript.ts";
import { presentationView } from "../../src/web/chat/presentation-view.ts";
import { projectWork } from "../../src/web/chat/work-view.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

test("crash after receipt commit before observation exposes the original config in rendered chat and read-only CLI", async () => {
  const { app, dir, layoutId } = await optionOptionApp();
  try {
    const script = `import {openApp} from ${JSON.stringify(new URL("../../src/app/context.ts", import.meta.url).pathname)};
      import {startAgentRun} from ${JSON.stringify(new URL("../../src/app/agent-runs.ts", import.meta.url).pathname)};
      const app=openApp({dataDir:${JSON.stringify(dir)}});
      const model={provider:'anthropic',model:'synthetic',effort:'medium',classifyError:()=>null,run:async(request)=>{
        await request.tools.find(tool=>tool.name==='get_layout').run({});
        void request.tools.find(tool=>tool.name==='create_config').run({name:'PRIVATE_PREPARATION_NAME',from:'this'});
        process.exit(0);
      }};
      await startAgentRun(app,{version:1,requestId:'actual-crash-gap',layoutRef:${JSON.stringify(layoutId)},input:{message:'Synthetic gap'}},{model});`;
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    const snapshot = inspectAgentRun(app, "actual-crash-gap");
    const detail = await appChatBackend(app).get(snapshot.conversationId);
    if (!detail || !snapshot.presentation) throw new Error("missing saved work");
    const reference = snapshot.preparations[0]?.references[0];
    if (!reference) throw new Error("missing committed reference");
    expect(snapshot.status).toBe("interrupted");
    expect(snapshot.committedPreparations).toBe(1);
    expect(snapshot.presentation.operations.map((operation) => [operation.id, operation.status])).toEqual([["op_1", "succeeded"], ["op_2", "unknown"]]);
    expect(snapshot.preparations[0]?.operationId).toBe("effect_1");
    const projected = transcriptReducer(EMPTY, { type: "saved", snapshot, detail });
    const turn = projected.turns.find((item) => item.kind === "assistant" && item.userMessageId === snapshot.userMessageId);
    if (turn?.kind !== "assistant") throw new Error("missing assistant turn");
    const view = getLayout(app, layoutId);
    const html = renderToStaticMarkup(createElement(AssistantMessage, {
      turn, layout: view.document, board: view.board.definition, pinnedId: null,
      onPreview: () => {}, onPin: () => {}, onApply: async () => {}, onRemovePriority: async () => {}, onAskAgain: () => {}, onOpenRelease: () => {}, onRetry: () => {}, onAnswer: () => {},
    }));
    expect(html).toContain(reference.id);
    expect(html).toContain("Saved preparation receipt");
    expect(html).toContain("Outcome not confirmed");
    expect(html).not.toContain("PRIVATE_PREPARATION_NAME");
    expect(turn.presentation?.operations.at(-1)?.status).toBe("unknown");
    const count = listLayouts(app).length;
    let output = "";
    expect(await runCli(["--data-dir", dir, "--format", "json", "agent", "show", snapshot.id], { isTTY: false, out: (text) => { output += text; }, err: () => {} })).toBe(0);
    expect(JSON.parse(output).preparations).toEqual(turn.preparations);
    expect(listLayouts(app)).toHaveLength(count);
    expect(JSON.stringify(fromConversation(detail).turns)).toContain(reference.id);
    // Reading a later turn must not discard the earlier interrupted run's saved preparation.
    const later = await startAgentRun(app, { version: 1, requestId: "later-read", layoutRef: layoutId, input: { conversationId: snapshot.conversationId, message: "Continue explicitly" } }, { model: {
      provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null,
      async run() { return { messages: [{ role: "assistant", content: [{ type: "text", text: "Later answer" }] }], stopReason: "end_turn", iterations: 1, usage: emptyUsage() }; },
    } });
    await waitForAgentRun(app, later.id);
    const laterDetail = await appChatBackend(app).get(snapshot.conversationId);
    if (!laterDetail) throw new Error("missing later history");
    const after = transcriptReducer(projected, { type: "saved", snapshot: inspectAgentRun(app, later.id), detail: laterDetail });
    expect(JSON.stringify(after.turns.find((item) => item.kind === "assistant" && item.userMessageId === snapshot.userMessageId))).toContain(reference.id);
  } finally { app.db.close(); }
});

test("a validation receipt without a saved reference is not a green recovered preparation", () => {
  const view = presentationView({ version: 1, userMessageId: "request", status: "unobserved", operations: [], messages: [], effectsMayHaveOccurred: true, warning: null, detailsTruncated: false }, [{ operationId: "effect_1", tool: "propose_changes", references: [] }]);
  if (view.kind !== "observed") throw new Error("missing work view");
  expect(projectWork(view).routine).toEqual([]);
  expect(projectWork(view).attention[0]).toMatchObject({ id: "receipt:effect_1", status: "unknown", durationMs: null });
  expect(view.operations[0]?.summary).toContain("Validation may have declined");
});
