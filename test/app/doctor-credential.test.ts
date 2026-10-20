// `keyloom doctor` resolves the model credential with a read, not a generation (11#logs). No test touches the
// network: the check is injectable, and the one test of the real mapping answers the SDK's own fetch.
import { afterEach, describe, expect, test } from "bun:test";
import { runCredentialChecks, runDoctor } from "../../src/app/doctor.ts";
import { closeApp, getLayout } from "../../src/app/index.ts";
import { createBuild, finishBuild, newBuildId } from "../../src/persistence/builds.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

const savedFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = savedFetch; });

test("doctor reports a previous failed build as history, not a failing current health check", async () => {
  const { app, layoutId } = await optionOptionApp();
  try {
    const id = newBuildId();
    createBuild(app.db, { id, layoutId, revisionId: getLayout(app, layoutId).revision.id, boardRevision: "reva", logPath: "logs/synthetic.log" });
    finishBuild(app.db, id, { error: "synthetic failure" });
    expect(runDoctor({ dataDir: app.dataDir })).toContainEqual(expect.objectContaining({ name: "recent builds", ok: true, warn: true, detail: expect.stringContaining("failed") }));
  } finally {
    closeApp(app);
  }
});

describe("doctor: the model credential", () => {
  test("no key at all is a warning, not a failure, and says how to set one", async () => {
    const checks = await runCredentialChecks({
      env: {},
      verify: () => { throw new Error("no credential means no read at all"); },
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: "model credential", ok: true, warn: true });
    expect(checks[0]?.detail).toContain("ANTHROPIC_API_KEY");
    expect(checks[0]?.detail).toContain("OPENROUTER_API_KEY");
    expect(checks[0]?.detail).toContain("codex login");
  });

  test("a rejected credential fails the check with the reason", async () => {
    const checks = await runCredentialChecks({
      env: { ANTHROPIC_API_KEY: "sk-ant-bad" },
      verify: async () => ({ status: "rejected", reason: "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY." }),
    });
    expect(checks).toEqual([{ name: "model credential (anthropic)", ok: false, detail: "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY." }]);
  });

  test("a check that couldn't run warns instead of failing doctor", async () => {
    const checks = await runCredentialChecks({
      env: { ANTHROPIC_API_KEY: "sk-ant-good" },
      verify: async () => ({ status: "unchecked", reason: "Could not reach the Anthropic API: timed out" }),
    });
    expect(checks).toEqual([{ name: "model credential (anthropic)", ok: true, warn: true, detail: "couldn't check: Could not reach the Anthropic API: timed out" }]);
  });

  test("a resolving credential passes, and each keyed provider is checked with its own key", async () => {
    const seen: string[] = [];
    const env = { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" };
    const checks = await runCredentialChecks({
      env,
      verify: async (provider, got) => {
        expect(got).toBe(env);
        seen.push(provider);
        return { status: "ok" };
      },
    });
    expect(seen).toEqual(["anthropic", "openrouter"]);
    expect(checks.map((c) => [c.name, c.ok, c.warn])).toEqual([
      ["model credential (anthropic)", true, undefined],
      ["model credential (openrouter)", true, undefined],
    ]);
    expect(checks[0]?.detail).toBe("claude-opus-5-5 resolves");
  });

  test("a blank key counts as no key, as it does for the chat", async () => {
    const checks = await runCredentialChecks({ env: { ANTHROPIC_API_KEY: "  " } });
    expect(checks[0]).toMatchObject({ name: "model credential", ok: true, warn: true });
  });
});

describe("doctor: the real read maps a 401 to a rejected credential", () => {
  test("without the network: the SDK's own fetch is answered with a 401", async () => {
    let requested = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      requested = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
        status: 401, headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const checks = await runCredentialChecks({ env: { ANTHROPIC_API_KEY: "sk-ant-bad" } });
    expect(checks[0]).toMatchObject({ name: "model credential (anthropic)", ok: false });
    expect(checks[0]?.detail).toContain("401");
    // A models read, never a generation: the request is a GET of the model, with no messages endpoint.
    expect(requested).toContain("/v1/models/");
    expect(requested).not.toContain("/messages");
  });
});
