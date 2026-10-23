// Preloaded after the safety fixtures. A forgotten fake must fail its test rather than change the next file's tools.
import { afterAll, afterEach, beforeEach } from "bun:test";

const guarded = (name: string) => name.startsWith("GIT_CONFIG_") || name.startsWith("FAKE_");
const snapshot = () => new Map(Object.entries(process.env).filter(([name]) => guarded(name)));
const baseline = snapshot();

function assertRestored(): void {
  const current = snapshot();
  const names = new Set([...baseline.keys(), ...current.keys()]);
  const changed = [...names].filter((name) => current.get(name) !== baseline.get(name)).sort();
  if (changed.length === 0) return;
  // Restore before failing so the diagnostic belongs to the leaking test, without cascading into later files.
  for (const name of changed) {
    const value = baseline.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  throw new Error(`Test leaked toolchain environment: ${changed.join(", ")}`);
}

beforeEach(assertRestored);
afterEach(assertRestored);
afterAll(assertRestored);
