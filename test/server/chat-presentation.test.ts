import { expect, test } from "bun:test";
import { z } from "zod";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { ChatEventSchema, ChatRequestSchema, ConversationDetailSchema, ObservedChatEventSchema } from "../../src/api/http.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { handleChatRoute } from "../../src/server/chat-routes.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

const request = (path: string, body?: object) => new Request(`http://localhost${path}`, { method: body ? "POST" : "GET", headers: { "x-keyloom-token": "synthetic", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
const frames = (text: string) => text.split("\n\n").filter(Boolean).map((frame) => JSON.parse(frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "null"));

test("legacy strict SSE remains valid by default; negotiated snapshots and additive detail agree", async () => {
  const { app, layoutId } = await optionOptionApp();
  const path = `/api/layouts/${layoutId}/chat`;
  const fake = fakeAnthropic([
    { blocks: [{ text: "Legacy." }] },
    { blocks: [{ text: "Checking." }, { tool: "list_layouts", input: {} }] },
    { blocks: [{ text: "Finished." }] },
  ]);
  const backend = appChatBackend(app, { model: anthropicModel(fake.client) });
  const old = await handleChatRoute(request(path, { message: "Legacy" }), path, backend, "synthetic");
  if (!old) throw new Error("no response");
  const oldFrames = frames(await old.text()).map((event) => ChatEventSchema.parse(event));
  expect(oldFrames.map((e) => e.type)).toEqual(["start", "text", "text", "done"]);
  const observed = await handleChatRoute(request(path, { message: "Inspect", presentationVersion: 1 }), path, backend, "synthetic");
  if (!observed) throw new Error("no response");
  const events = frames(await observed.text()).map((event) => ObservedChatEventSchema.parse(event));
  const snapshots = events.filter((event) => event.type === "presentation");
  expect(snapshots[0]?.presentation.status).toBe("running");
  const final = snapshots.at(-1)?.presentation;
  if (!final) throw new Error("missing terminal snapshot");
  expect(final?.status).toBe("completed");
  expect(final?.operations[0]?.status).toBe("succeeded");
  expect(final?.messages.map((message) => message.kind)).toEqual(["working_note", "answer"]);
  const start = events[0];
  if (start?.type !== "start") throw new Error("no start");
  const getPath = `/api/conversations/${start.conversationId}`;
  const response = await handleChatRoute(request(getPath), getPath, backend, "synthetic");
  if (!response) throw new Error("no detail");
  const detail = ConversationDetailSchema.parse(await response.json());
  expect(detail.presentations).toEqual([final]);
  const { presentations: _ignored, ...legacyDetail } = detail;
  expect(ConversationDetailSchema.parse(legacyDetail).presentations).toBeUndefined();
  // An old server strips the new optional request property and sends only the readable legacy stream.
  const { presentationVersion: _version, ...legacyShape } = ChatRequestSchema.shape;
  expect(z.object(legacyShape).parse({ message: "Inspect", presentationVersion: 1 })).toEqual({ message: "Inspect" });
  app.db.close();
});

test("unsupported major presentation version refuses writes before storage or provider execution", async () => {
  const { app, layoutId } = await optionOptionApp();
  const fake = fakeAnthropic([]);
  const path = `/api/layouts/${layoutId}/chat`;
  const response = await handleChatRoute(request(path, { message: "Do not execute", presentationVersion: 2 }), path, appChatBackend(app, { model: anthropicModel(fake.client) }), "synthetic");
  expect(response?.status).toBe(400);
  const body = await response?.json();
  expect(body.error).toMatchObject({ code: "usage", message: expect.stringContaining("omit presentationVersion") });
  expect(fake.requests).toHaveLength(0);
  expect(app.db.query("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
  app.db.close();
});
