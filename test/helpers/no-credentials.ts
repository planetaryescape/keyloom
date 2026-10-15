// Runs `fn` with no model credential in the environment, so a test of the missing-credential path
// doesn't depend on what the developer's shell has set or whether their codex is logged in.
const NAMES = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "KEYLOOM_PROVIDER", "CODEX_API_KEY"] as const;
// A path that is not there, so "is codex signed in?" is answered no without running the developer's own codex.
export const NO_CODEX = "/nonexistent/keyloom-test-codex";

export async function withoutCredentials<T>(fn: () => Promise<T>): Promise<T> {
  const saved = [...NAMES, "KEYLOOM_CODEX_BIN"].map((name) => [name, process.env[name]] as const);
  for (const name of NAMES) delete process.env[name];
  process.env.KEYLOOM_CODEX_BIN = NO_CODEX;
  try {
    return await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
