// Real recovery controls over synthetic HTTP only. The server beside this file builds and serves it.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CodexInstall } from "../../src/web/chat/CodexInstall.tsx";
import { ConfigCardList } from "../../src/web/chat/ConfigCards.tsx";
import type { ApiConfig } from "../../src/api/configs.ts";
import type { ChatPresentation } from "../../src/api/http.ts";
import "../../src/web/fonts/fonts.css";
import "../../src/web/tokens.css";
import "../../src/web/app.css";
import "../../src/web/shell/shell.css";
import "../../src/web/chat/chat.css";
import "../../src/web/chat/setup.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
const scenario = params.get("scenario") ?? "install-transient";
const calls: string[] = [];
let reads = 0;
let restoreAttempts = 0;
let recovered = false;
let releaseRestore: (() => void) | undefined;
const archived: ApiConfig = { id: "other-board-config", name: "Archived Corne", boardId: "foostan/corne", boardName: "Corne", headRevisionId: "r", createdAt: 1, updatedAt: 1, onKeyboard: false, archivedAt: 2, copiedFrom: null };
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), location.origin).pathname;
  const method = init?.method ?? "GET";
  calls.push(`${method} ${path}`);
  if (path === "/api/restart" && method === "GET") return Response.json({ canRestart: true, command: "keyloom serve" });
  if (path === "/api/system/install" && method === "GET") {
    reads++;
    if (recovered) return Response.json({ tool: "codex", status: "succeeded", phase: null, logTail: ["Synthetic install finished"], error: null, errorCode: null });
    if (reads > 1) return scenario === "install-mismatch" ? Response.json({ incompatible: true }) : Response.json({ error: { code: "unreachable", message: "Synthetic lost read" } }, { status: 503 });
    return Response.json({ tool: "codex", status: "running", phase: "stopping", logTail: ["Synthetic install log"], error: null, errorCode: null });
  }
  if (path === "/api/configs/other-board-config/restore" && method === "POST") {
    if (scenario === "restore-delayed") await new Promise<void>((resolve) => { releaseRestore = resolve; });
    if (++restoreAttempts === 1 && scenario !== "restore-delayed") return Response.json({ error: { code: "busy", message: "Synthetic restore refusal" } }, { status: 409 });
    return Response.json({ config: { ...archived, archivedAt: null } });
  }
  throw new Error(`Unexpected synthetic request: ${method} ${path}`);
}, { preconnect: globalThis.fetch.preconnect });

const presentation: ChatPresentation = { version: 1, userMessageId: "m", status: "completed", operations: [{ id: "made", tool: "create_config", label: "Create config", status: "succeeded", durationMs: 1, validationCodes: [], references: [{ kind: "config", id: archived.id }], accepted: 0, declined: 0 }], messages: [], effectsMayHaveOccurred: true, warning: null, detailsTruncated: false };
function Fixture() {
  const [visible, setVisible] = useState(true);
  const [opened, setOpened] = useState("");
  const [reloaded, setReloaded] = useState(0);
  return <main style={{ maxWidth: 560, margin: "24px auto", padding: 16 }}>
    <h1>Recovery controls</h1>
    <p>Synthetic install and archived config. No hardware or provider.</p>
    {scenario.startsWith("restore") ? visible ? <ConfigCardList presentation={presentation} cards={{ token: "synthetic", currentId: "moonlander-daily", origin: null, data: new Map([[archived.id, { state: "ready", config: reloaded > 0 ? { ...archived, archivedAt: null } : archived, waiting: null }]]), onOpen: setOpened, onReview: () => {}, onReadAgain: () => setReloaded((n) => n + 1) }} /> : null : <CodexInstall token="synthetic" text="Codex is absent." page="https://developers.openai.com/codex/cli" canInstall onReload={() => setReloaded((n) => n + 1)} />}
    <output aria-label="Recovery result">{JSON.stringify({ opened, reloaded })}</output>
    <details><summary>Synthetic fixture controls</summary><button type="button" onClick={() => setVisible(false)}>Hide config card</button><button type="button" onClick={() => releaseRestore?.()}>Release restore response</button><button type="button" onClick={() => { recovered = true; }}>Restore status reads</button><button type="button" onClick={() => document.querySelector("pre")?.replaceChildren(JSON.stringify(calls))}>Show requests</button><pre /></details>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
