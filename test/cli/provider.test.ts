import { afterEach, describe, expect, test } from "bun:test";
import { Credentials, keychainStore, useCredentials } from "../../src/app/credentials.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

async function cli(args: string[], stdin?: Io["stdin"]) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false, ...(stdin ? { stdin } : {}) };
  return { code: await runCli(args, io), out, err };
}

describe("keyloom provider commands", () => {
  test("provider status outputs active provider and provider list", async () => {
    const { dir } = await optionOptionApp();
    const r = await cli(["provider", "status", "--format", "table", "--data-dir", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Available providers:");
    expect(r.out).toContain("anthropic");
    expect(r.out).toContain("openrouter");
    expect(r.out).toContain("codex");

    const json = JSON.parse((await cli(["provider", "status", "--json", "--data-dir", dir])).out);
    expect(json.schema_version).toBe(1);
    expect(json.providers).toHaveLength(3);
  });

  test("provider use sets provider and model in config.json", async () => {
    const { dir } = await optionOptionApp();
    const use = await cli(["provider", "use", "openrouter", "--model", "anthropic/claude-3.5-sonnet", "--format", "table", "--data-dir", dir]);
    expect(use.code).toBe(0);
    expect(use.out).toContain("Saved openrouter (model: anthropic/claude-3.5-sonnet) as default provider in config.json.");

    const json = JSON.parse((await cli(["provider", "status", "--json", "--data-dir", dir])).out);
    expect(json.active?.provider).toBe("openrouter");
    expect(json.active?.model).toBe("anthropic/claude-3.5-sonnet");
  });

  test("provider use with invalid provider returns exit code 2", async () => {
    const { dir } = await optionOptionApp();
    const use = await cli(["provider", "use", "nonexistent-provider", "--data-dir", dir]);
    expect(use.code).toBe(2);
    expect(use.err).toContain("nonexistent-provider");
    expect(use.err).toContain("choose one of");
  });
});

describe("keyloom provider key (D-496)", () => {
  const KEY = "sk-ant-api03-Example_Key-0123456789abcdWXYZ";
  const piped = (text: string): Io["stdin"] => ({ isTTY: false, text: async () => text });

  /** An in-memory Keychain behind the real `security` command lines, and a local stand-in for Anthropic's models endpoint. */
  function world(answer: 200 | 401) {
    const items = new Map<string, string>();
    useCredentials(new Credentials(keychainStore(async (_command, args, stdin) => {
      const account = args[args.indexOf("-a") + 1] ?? "";
      if (args[0] === "find-generic-password") return items.has(account) ? { code: 0, stdout: items.get(account)! } : { code: 44, stdout: "" };
      if (args[0] === "delete-generic-password") return { code: items.delete(account) ? 0 : 44, stdout: "" };
      const words = [...(stdin ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
      items.set(words[1] ?? "", words[3] ?? "");
      return { code: 0, stdout: "" };
    })));
    const seen: string[] = [];
    const api = Bun.serve({
      port: 0,
      fetch: (request) => {
        seen.push(request.headers.get("x-api-key") ?? "");
        return answer === 200
          ? Response.json({ type: "model", id: "claude-opus-5-5", display_name: "Opus", created_at: "2026-01-01T00:00:00Z" })
          : Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 });
      },
    });
    const before = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${api.port}`;
    cleanups.push(() => {
      api.stop(true);
      if (before === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = before;
    });
    return { items, seen };
  }
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    useCredentials(undefined);
    for (const c of cleanups.splice(0)) c();
  });

  test("set checks the piped key, saves it, and status says where it came from", async () => {
    const w = world(200);
    const { dir } = await optionOptionApp();
    const set = await cli(["provider", "key", "set", "anthropic", "--format", "table", "--data-dir", dir], piped(`${KEY}\n`));
    expect(set.err).toBe("");
    expect(set.code).toBe(0);
    expect(set.out).toContain("Saved the anthropic key ending WXYZ.");
    expect(set.out).not.toContain(KEY);
    expect(w.seen).toEqual([KEY]);
    expect(w.items.get("anthropic")).toBe(KEY);

    const status = await cli(["provider", "status", "--format", "table", "--data-dir", dir]);
    expect(status.out).toContain("saved in the Keychain, ending WXYZ");
    const json = JSON.parse((await cli(["provider", "status", "--json", "--data-dir", dir])).out);
    expect(json.providers.find((p: { id: string }) => p.id === "anthropic").credential).toEqual({ source: "keychain", last4: "WXYZ" });
    expect(json.active.provider).toBe("anthropic");

    const forget = await cli(["provider", "key", "forget", "anthropic", "--format", "table", "--data-dir", dir]);
    expect(forget.code).toBe(0);
    expect(w.items.size).toBe(0);
  });

  test("a refused key exits 9 and is not saved", async () => {
    const w = world(401);
    const { dir } = await optionOptionApp();
    const set = await cli(["provider", "key", "set", "anthropic", "--data-dir", dir], piped(KEY));
    expect(set.code).toBe(9);
    expect(set.err).toContain("Anthropic refused this key.");
    expect(set.err).not.toContain(KEY);
    expect(w.items.size).toBe(0);
  });

  test("a key typed at a terminal, or a provider with no key, is a usage error", async () => {
    world(200);
    const { dir } = await optionOptionApp();
    const tty = await cli(["provider", "key", "set", "anthropic", "--data-dir", dir], { isTTY: true, text: async () => KEY });
    expect(tty.code).toBe(2);
    expect(tty.err).toContain("pipe the key in");
    expect((await cli(["provider", "key", "set", "codex", "--data-dir", dir], piped(KEY))).code).toBe(2);
  });
});
