import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Import only the gate in a fresh process: a synthetic key never reaches an API or a model.
const script = `import { live } from ${JSON.stringify(resolve(import.meta.dir, "../../evals/provider.ts"))}; console.log(live);`;

const cases = [
  { name: "no opt-in or key", flag: "", provider: "anthropic", anthropic: "", openrouter: "", expected: false },
  { name: "key without opt-in", flag: "", provider: "anthropic", anthropic: "synthetic-not-a-real-key", openrouter: "", expected: false },
  { name: "non-exact opt-in", flag: "true", provider: "anthropic", anthropic: "synthetic-not-a-real-key", openrouter: "", expected: false },
  { name: "opt-in without key", flag: "1", provider: "anthropic", anthropic: "", openrouter: "", expected: false },
  { name: "exact opt-in with selected key", flag: "1", provider: "anthropic", anthropic: "synthetic-not-a-real-key", openrouter: "", expected: true },
  { name: "wrong provider's key", flag: "1", provider: "openrouter", anthropic: "synthetic-not-a-real-key", openrouter: "", expected: false },
  { name: "OpenRouter's own key and opt-in", flag: "1", provider: "openrouter", anthropic: "", openrouter: "synthetic-not-a-real-key", expected: true },
];

for (const c of cases) {
  test(`live eval gate: ${c.name}`, () => {
    const result = spawnSync(process.execPath, ["--eval", script], {
      env: { ...process.env, KEYLOOM_LIVE_EVALS: c.flag, KEYLOOM_EVAL_PROVIDER: c.provider, ANTHROPIC_API_KEY: c.anthropic, OPENROUTER_API_KEY: c.openrouter },
      encoding: "utf8", timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(String(c.expected));
  });
}
