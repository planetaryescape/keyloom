// How a Codex run is locked down (D-108, D-110). Codex runs its own agent loop, so keyloom can't
// remove a tool from a list it controls. It switches off what Codex lets it, runs in a sandbox and
// a directory with nothing in it, and keeps the guarantee where it already was: only the
// propose_changes handler writes a change set, and BK's Apply is the only thing that changes a layout.
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

/**
 * Features that give Codex something to act with besides keyloom's tools: a shell, the account's
 * connected apps (booking, spaces, mail), plugins, a browser, computer use, image generation,
 * sub-agents and persistent memory. Observed on codex-cli 0.162.1 (S20). A name the installed Codex
 * doesn't know is ignored by it, so an old list degrades to "less off", not an error.
 *
 * `code_mode_host` is deliberately not here. Codex defers every MCP tool behind its code mode, so
 * with the host off keyloom's tools can't be called at all (S20). Code mode is a JavaScript sandbox
 * with no `require`, no `fetch` and no file access; its nested tools are `apply_patch`, which the
 * read-only sandbox rejects, a clock, MCP resource listings, and keyloom's own tools.
 */
export const DISABLED_FEATURES = [
  "shell_tool", "unified_exec", "apps", "plugins", "remote_plugin", "browser_use", "browser_use_external",
  "computer_use", "in_app_browser", "image_generation", "view_image", "multi_agent", "goals", "tool_suggest", "sleep_tool",
  "skill_search", "skill_mcp_dependency_install", "memories", "hooks",
] as const;

export const MCP_SERVER = "keyloom";
export const TOKEN_ENV = "KEYLOOM_MCP_TOKEN";
// propose_changes's schema is far over Codex's default of 5,000 bytes, above which it compacts the schema (S20).
export const SCHEMA_MAX_BYTES = 1_000_000;

/** A TOML value for `-c key=value`. JSON strings, numbers and arrays of them are valid TOML. */
const toml = (value: string | number | boolean | string[]): string => JSON.stringify(value);

/** Codex's names for reasoning effort; keyloom's `max` is its `xhigh`. */
const effortFor = (effort: string): string => (effort === "max" ? "xhigh" : effort);

export function codexArgs(opts: { model: string; effort: string; cwd: string; serverUrl: string; developerInstructions: string }): string[] {
  const config: Array<[string, string | number | boolean | string[]]> = [
    ["approval_policy", "never"],
    ["web_search", "disabled"],
    ["developer_instructions", opts.developerInstructions],
    ["model_reasoning_effort", effortFor(opts.effort)],
    ...DISABLED_FEATURES.map((f): [string, boolean] => [`features.${f}`, false]),
    [`mcp_servers.${MCP_SERVER}.url`, opts.serverUrl],
    [`mcp_servers.${MCP_SERVER}.bearer_token_env_var`, TOKEN_ENV],
    [`mcp_servers.${MCP_SERVER}.default_tools_approval_mode`, "approve"],
    [`mcp_servers.${MCP_SERVER}.tool_input_schema_max_bytes`, SCHEMA_MAX_BYTES],
    [`mcp_servers.${MCP_SERVER}.required`, true],
  ];
  return [
    "exec", "--experimental-json",
    // No session files: they would hold BK's layout and priorities in ~/.codex, outside keyloom (D-108).
    "--ephemeral",
    // The scratch directory is not a git repository.
    "--skip-git-repo-check",
    // BK's own config.toml (MCP servers, hooks, instructions) must not shape keyloom's runs.
    "--ignore-user-config",
    "-s", "read-only",
    "-C", opts.cwd,
    "-m", opts.model,
    ...config.flatMap(([key, value]) => ["-c", `${key}=${toml(value)}`]),
  ];
}

// Only what Codex needs to run and reach OpenAI. keyloom's own model keys must not follow it into a
// process whose tools we don't control.
const PASSED_ENV = [
  "PATH", "LANG", "LC_ALL", "TMPDIR", "TERM", "CODEX_API_KEY", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
] as const;

export type Scratch = {
  cwd: string;
  /** What to spawn Codex with. */
  env: Env;
  remove(): void;
};

/**
 * An empty working directory, and a HOME and CODEX_HOME of their own. Codex reads instructions from
 * the home directories (BK's global AGENTS.md reached a keyloom run until HOME was replaced, S20), so
 * those must not be the real ones. The only thing linked in is auth.json, so the sign-in works and a
 * token refresh lands in the real file; keyloom never opens it. Where Codex keeps the sign-in in the
 * OS keyring instead there is no file to link, and the real CODEX_HOME is used as it is.
 */
export function prepareScratch(token: string, env: Env = process.env): Scratch {
  const root = mkdtempSync(join(tmpdir(), "keyloom-codex-"));
  const cwd = join(root, "cwd");
  const home = join(root, "home");
  const codexHome = join(root, "codex-home");
  for (const dir of [cwd, home, codexHome]) mkdirSync(dir);

  const realCodexHome = env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const auth = join(realCodexHome, "auth.json");
  const linked = existsSync(auth);
  if (linked) symlinkSync(auth, join(codexHome, "auth.json"));

  const childEnv: Env = { [TOKEN_ENV]: token, HOME: home, CODEX_HOME: linked ? codexHome : realCodexHome };
  for (const name of PASSED_ENV) if (env[name] !== undefined) childEnv[name] = env[name];
  // rmSync does not follow the symlink, so the real auth.json is never touched.
  return { cwd, env: childEnv, remove: () => rmSync(root, { recursive: true, force: true }) };
}
