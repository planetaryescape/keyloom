// Preloaded before every test file (bunfig.toml). The board review runs the agent by itself when a layout changes (D-340), so a test that
// serves or edits a layout would call whatever model the developer's shell can reach. No test pays for a model: a test that wants one
// passes a fake, and one that wants the missing-credential path gets it by default.
import { NO_CODEX } from "./no-credentials.ts";

for (const name of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "KEYLOOM_PROVIDER", "CODEX_API_KEY"]) delete process.env[name];
process.env.KEYLOOM_CODEX_BIN = NO_CODEX;
