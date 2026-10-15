// Runs `fn` with no model credential in the environment, so a test of the missing-credential path
// doesn't depend on what the developer's shell has set or whether their codex is logged in.
const NAMES = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "KEYLOOM_PROVIDER", "CODEX_API_KEY"] as const;

export async function withoutCredentials<T>(fn: () => Promise<T>): Promise<T> {
  const saved = NAMES.map((name) => [name, process.env[name]] as const);
  for (const name of NAMES) delete process.env[name];
  try {
    return await fn();
  } finally {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
  }
}
