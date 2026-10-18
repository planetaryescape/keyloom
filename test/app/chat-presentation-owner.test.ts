import { expect, test } from "bun:test";
import { join } from "node:path";
import type { AgentModel } from "../../src/agent/model.ts";
import { emptyUsage } from "../../src/agent/model.ts";
import { chatPresentation } from "../../src/app/chat-presentation.ts";
import { sendMessage, showConversation } from "../../src/app/index.ts";
import { insertConversation, insertMessage } from "../../src/persistence/conversations.ts";
import { ChatPresentationSchema } from "../../src/api/http.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

test("only the current user message owns live work; an older orphan stays unobserved", async () => {
  const { app, dir, layoutId } = await optionOptionApp();
  const conversation = insertConversation(app.db, { layoutId, title: "Ownership regression" });
  const oldUser = insertMessage(app.db, { conversationId: conversation.id, role: "user", content: [{ type: "text", text: "Earlier interrupted work" }] });
  chatPresentation(app, conversation.id, oldUser.id);
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const model: AgentModel = {
    provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null,
    async run() {
      entered.resolve();
      await gate.promise;
      return { messages: [{ role: "assistant", content: [{ type: "text", text: "New work finished." }] }], stopReason: "end_turn", iterations: 1, usage: emptyUsage() };
    },
  };
  let currentUserId = "";
  const pending = sendMessage(app, layoutId, {
    conversationId: conversation.id, message: "Do new work", model,
    onEvent(event) { if (event.type === "start") currentUserId = event.messageId; },
  });
  try {
    await entered.promise;
    const presentations = showConversation(app, conversation.id).presentations;
    expect(presentations.find((item) => item.userMessageId === oldUser.id)?.status).toBe("unobserved");
    expect(presentations.find((item) => item.userMessageId === currentUserId)?.status).toBe("running");
    await expect(sendMessage(app, layoutId, { conversationId: conversation.id, message: "Racing request", model })).rejects.toThrow(/still answering/);

    // A separate reader cannot borrow this process's live owner, even for the current message.
    const script = `import { openApp, showConversation } from ${JSON.stringify(join(import.meta.dir, "../../src/app/index.ts"))};
      const app = openApp({ dataDir: ${JSON.stringify(dir)} });
      try { console.log(JSON.stringify(showConversation(app, ${JSON.stringify(conversation.id)}).presentations)); }
      finally { app.db.close(); }`;
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const separate = ChatPresentationSchema.array().parse(JSON.parse(stdout));
    expect(separate.find((item) => item.userMessageId === oldUser.id)?.status).toBe("unobserved");
    expect(separate.find((item) => item.userMessageId === currentUserId)?.status).toBe("unobserved");

    gate.resolve();
    await pending;
    const completed = showConversation(app, conversation.id).presentations;
    expect(completed.find((item) => item.userMessageId === oldUser.id)?.status).toBe("unobserved");
    expect(completed.find((item) => item.userMessageId === currentUserId)?.status).toBe("completed");

    // Completion releases the same conversation-level exclusion for the next request.
    await sendMessage(app, layoutId, { conversationId: conversation.id, message: "Next request", model });
    expect(showConversation(app, conversation.id).presentations.find((item) => item.userMessageId === oldUser.id)?.status).toBe("unobserved");
  } finally {
    gate.resolve();
    await pending;
    app.db.close();
  }
});
