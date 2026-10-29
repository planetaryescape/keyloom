// Actual useChat regression fixture. Only synthetic HTTP data; no application data or provider.
import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { useChat } from "../../src/web/chat/useChat.ts";
import type { AgentRunSnapshot } from "../../src/api/agent-runs.ts";
import type { ConversationDetail } from "../../src/api/http.ts";

const posts: string[] = [];
const redirects: unknown[] = [];
const failed = new Set<string>();
const runs = new Map<string, { snapshot: AgentRunSnapshot; text: string }>();
let releaseSlow: (() => void) | undefined;
let slowWaiting = false;
let deferred: { stage: "conversation" | "latest-run"; entered: boolean; release?: () => void } | undefined;
async function deferOpen(stage: "conversation" | "latest-run", path: string) {
  if (deferred?.stage !== stage || !path.includes("deferred")) return;
  deferred.entered = true;
  await new Promise<void>((resolve) => { if (deferred) deferred.release = resolve; });
}
let current: ReturnType<typeof useChat> | undefined;
const storageKey = "keyloom.agent.current.synthetic-handoff";
localStorage.removeItem(storageKey);
const detail = (id: string, text: string): ConversationDetail => ({
  conversation: { id, layoutId: "synthetic-handoff", title: text, createdAt: 1, provider: "anthropic", model: "synthetic" },
  messages: [{ id: "user", role: "user", text, toolCalls: [], selection: null, createdAt: 1 }, { id: "reply", role: "assistant", text: "Synthetic reply", toolCalls: [], selection: null, createdAt: 2 }], proposals: [], priorities: [],
});
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), location.origin).pathname;
  if (path === "/api/agent/v1/runs" && init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    const text = String(body.input.message);
    posts.push(text);
    if (text.startsWith("fail") && !failed.has(text)) { failed.add(text); throw new TypeError("Synthetic network failure before acceptance"); }
    const id = `run-${posts.length}`;
    const snapshot: AgentRunSnapshot = {
      version: 1, id, requestId: body.requestId, conversationId: "copy-conversation", userMessageId: "user", status: "completed", seq: 1,
      cancelRequested: false, committedPreparations: 0, preparations: [], presentation: null,
      ...(text.startsWith("copy") ? { handoff: { layoutId: "copied-config", conversationId: "target-conversation", runId: "target-run", requestId: "target-request" } } : {}),
    };
    runs.set(id, { snapshot, text });
    return Response.json(snapshot);
  }
  if (path.startsWith("/api/agent/v1/runs/")) {
    const row = runs.get(path.split("/").at(-1) ?? "");
    if (!row) throw new Error("Unknown synthetic run");
    if (row.text === "copy slow") {
      slowWaiting = true;
      await new Promise<void>((resolve) => { releaseSlow = resolve; });
    }
    return Response.json(row.snapshot);
  }
  if (path.startsWith("/api/agent/v1/conversations/")) { await deferOpen("latest-run", path); return Response.json(null); }
  if (path.startsWith("/api/conversations/")) { await deferOpen("conversation", path); return Response.json(detail(path.split("/").at(-1) ?? "history", "historic input")); }
  throw new Error(`Unexpected synthetic request: ${path}`);
}, { preconnect: globalThis.fetch.preconnect });
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const chat = () => { if (!current) throw new Error("Hook not mounted"); return current; };
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
async function runChecks() {
  const output = document.querySelector("pre");
  if (!output) throw new Error("Missing fixture output");
  output.textContent = "Running actual useChat recovery checks…";
  try {
    for (const stage of ["conversation", "latest-run"] as const) {
      for (const replacement of ["new", "open"] as const) {
        deferred = { stage, entered: false };
        const opening = chat().open("deferred");
        // Match ChatPanel's initial-copy continuation: only a successful open may send.
        const continuation = opening.then((error) => { if (error === null) return chat().send("Continue adapting the copied setup.", null); });
        while (!deferred.entered) await frame();
        const before = posts.length;
        if (replacement === "new") chat().newConversation();
        else check(await chat().open("replacement") === null, "Current replacement open did not report success");
        await frame();
        deferred.release?.();
        const outcome = await opening; await continuation; await frame();
        check(outcome === undefined && posts.length === before, `Canceled ${stage} open after ${replacement} submitted a stale continuation`);
        check(chat().transcript.conversationId === (replacement === "new" ? null : "replacement"), "Canceled open replaced the current conversation");
        deferred = undefined;
      }
    }
    check(await chat().open("normal-history") === null, "Normal history open did not report success");
    await frame();
    check(chat().transcript.conversationId === "normal-history", "Successful history open did not show its conversation");
    await chat().send("copy", null); await frame();
    await chat().send("fail later message", null); await frame();
    await chat().retry(); await frame();
    check(redirects.length === 0 && posts.filter((text) => text === "fail later message").length === 2, "A failed new message retried the earlier copy");
    await chat().send("copy", null); await frame();
    chat().newConversation(); await frame();
    const beforeNew = posts.length;
    await chat().retry(); await frame();
    check(redirects.length === 0 && posts.length === beforeNew, "New conversation retained the old handoff");
    await chat().send("copy", null); await frame();
    await chat().open("history"); await frame();
    await chat().retry(); await frame();
    check(redirects.length === 0 && posts.at(-1) === "historic input", "Opening history retained the old handoff");
    await chat().send("copy", null); await frame();
    const beforeGenuine = posts.length;
    await chat().retry(); await frame();
    check(redirects.length === 1 && posts.length === beforeGenuine, "Current handoff Retry stopped following its target");
    redirects.length = 0;
    const slow = chat().send("copy slow", null);
    while (!slowWaiting) await frame();
    chat().newConversation(); await frame();
    releaseSlow?.(); await slow; await frame();
    await chat().retry(); await frame();
    check(redirects.length === 0 && chat().transcript.turns.length === 0, "An old observer restored the handoff after New");
    output.textContent = "PASS 10 actual useChat recovery checks: canceled opens at both async boundaries after New/replacement, normal history, new-message retry, New conversation, Open history, genuine handoff retry, late observer protection.";
  } catch (error) { output.textContent = `FAIL ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ posts, redirects })}`; }
}
function Harness() {
  const state = useChat("synthetic", "synthetic-handoff", (handoff) => redirects.push(handoff));
  useLayoutEffect(() => { current = state; });
  return <main><h1>Copy handoff recovery</h1><p>Real React hook with synthetic HTTP responses. No keyboard or provider.</p><button onClick={() => void runChecks()}>Run recovery checks</button><pre>Ready</pre></main>;
}
const mount = document.getElementById("root");
if (!mount) throw new Error("Missing root");
createRoot(mount).render(<Harness />);
