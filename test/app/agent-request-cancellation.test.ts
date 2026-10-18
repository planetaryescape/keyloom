import { expect, test } from "bun:test";
import { cancelAgentRequest, inspectAgentRun, startAgentRun } from "../../src/app/agent-runs.ts";
import { openApp } from "../../src/app/context.ts";
import { listLayouts } from "../../src/app/layouts.ts";
import type { AgentModel } from "../../src/agent/model.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

test("Stop during messageModel's await is atomically consumed before model ownership, with payload dedup intact", async () => {
  const { app, dir, layoutId } = await optionOptionApp();
  let calls = 0;
  const model: AgentModel = { provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null, async run() { calls++; throw new Error("must never launch"); } };
  const request = { version: 1 as const, requestId: "resolving-model", layoutRef: layoutId, input: { message: "Prepare after resolution" } };
  try {
    const count = listLayouts(app).length;
    const accepting = startAgentRun(app, request, { model }); // yields at await messageModel before acceptance
    const separate = openApp({ dataDir: dir });
    try {
      expect(cancelAgentRequest(separate, request.requestId)).toEqual({ version: 1, requestId: request.requestId, status: "pending_acceptance", cancelRequested: true });
      expect(() => inspectAgentRun(separate, request.requestId)).toThrow(/no agent run/);
    } finally { separate.db.close(); }
    const run = await accepting;
    expect(run).toMatchObject({ status: "cancelled", cancelRequested: true, committedPreparations: 0 });
    expect(run.presentation).toMatchObject({ status: "cancelled", operations: [], effectsMayHaveOccurred: false });
    expect(calls).toBe(0);
    expect(listLayouts(app)).toHaveLength(count);
    expect(await startAgentRun(app, request, { model })).toEqual(run);
    await expect(startAgentRun(app, { ...request, input: { message: "Changed payload" } }, { model })).rejects.toThrow(/different scope or input/);
  } finally { app.db.close(); }
});

test("a bounded full Stop store fails new acceptance closed instead of forgetting Stop", async () => {
  const { app, layoutId } = await optionOptionApp();
  const model: AgentModel = { provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null, async run() { throw new Error("must not launch"); } };
  try {
    for (let i = 0; i < 1024; i++) cancelAgentRequest(app, `pending-${i}`);
    expect(() => cancelAgentRequest(app, "overflow-stop")).toThrow(/not recorded/);
    await expect(startAgentRun(app, { version: 1, requestId: "overflow-stop", layoutRef: layoutId, input: { message: "Must stay blocked" } }, { model })).rejects.toThrow(/new requests are blocked/);
    expect((await startAgentRun(app, { version: 1, requestId: "pending-0", layoutRef: layoutId, input: { message: "Consume cancelled identity" } }, { model })).status).toBe("cancelled");
  } finally { app.db.close(); }
});
