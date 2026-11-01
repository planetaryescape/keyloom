# 19: Model providers: Codex subscription, OpenRouter key or Anthropic key

Status: built in rung 10, 2026-10-15. Source baseline: origin/main at `65cc12a` (v0.10.1). Results: S19 and S20 in [15](15-open-questions.md).

BK: "use codex cli for AI I think it allow you to use codex sub with it's agent sdk if I'm not mistaken, we can use that. Also make it possible for me to use an openrouter api key". This came after the Anthropic account behind keyloom's key ran out of credits, which stopped the chat and the live evals.

Today the agent uses the Anthropic API only (D-031). Model calls are made in one file, `src/agent/anthropic-model.ts`, behind the `AgentModel` interface in `src/agent/model.ts`. This chapter adds two providers behind that seam (D-106).

The research, with experiments run on BK's ChatGPT login, is in [../research/model-providers.md](../research/model-providers.md).

## What each provider is

| Provider | How it bills | How keyloom talks to it | What changes |
|---|---|---|---|
| Anthropic (exists) | API credits on BK's key | `@anthropic-ai/sdk` Tool Runner | Nothing |
| OpenRouter | OpenRouter credits on BK's key | The same SDK, pointed at OpenRouter's Anthropic-compatible `/api/v1/messages` with `baseURL` and `authToken` | A base URL, a token and model IDs such as `anthropic/claude-opus-5.5` (D-107) |
| Codex | BK's ChatGPT subscription, through `codex login` | Spawns the installed `codex exec --experimental-json` and reads its JSONL events. keyloom's tools are served to it as a loopback MCP server | A new adapter with its own conversation handling (D-108) |

A Claude subscription is not offered. Anthropic's docs say third-party apps may not route requests through Free, Pro or Max credentials, including apps built on the Agent SDK. The only exception is a person signing in to the unmodified Claude Code binary, which keyloom doesn't run (D-109).

## OpenRouter is the existing adapter with a different address

OpenRouter serves an Anthropic Messages endpoint, and `@anthropic-ai/sdk` takes `baseURL` and `authToken`. So the OpenRouter provider is the existing adapter with those two options and OpenRouter model IDs (D-107):

- **Model IDs.** `anthropic/claude-opus-5.5` and `anthropic/claude-sonnet-5.5`, confirmed from OpenRouter's live `/models` response.
- **Cost.** OpenRouter can return `usage.cost` in the closing stream event. keyloom reports a whole-turn charge only when every request in that turn supplies a finite nonnegative charge; a partial sum is never called the complete reported cost. Otherwise it uses a known-model list-price estimate when available. The D-470 footer shows Usage for token-only accounting and disappears when neither tokens nor cost were reported, without claiming zero cost. Saved replies retain the available accounting ([12](12-cost-model.md)).
- **Checked in S19.** The Tool Runner loop, thinking, effort and `cache_control` work through OpenRouter. The fallback beta doesn't (OpenRouter rejects `fallbacks: "default"`), so only the direct API sends it (D-121). `usage.cost` arrives on the closing stream event and the adapter reads it there.

Non-Claude models on OpenRouter would need a Chat Completions adapter. That isn't planned until BK asks for it (Q22).

## Codex is a different kind of provider

Codex runs its own agent loop. keyloom can't hand it tool functions directly: it spawns the `codex` binary, and the binary calls keyloom's tools over MCP. The research ran this. A custom stdio MCP tool was called as an `mcp_tool_call` item, and with the shell tool off, Codex couldn't run commands.

How the adapter works (D-108):

- **Spawning.** It spawns `codex exec --experimental-json` directly, not through `@openai/codex-sdk`. The SDK finds its binary through `node_modules`, which a `bun build --compile` binary doesn't have. Spawning directly also allows `--ignore-user-config` and `--ephemeral`.
- **Tools.** keyloom's `ModelTool`s are served by a loopback MCP server, bound to 127.0.0.1 with a bearer token per run. Tool approval is set to `approve`. The `propose_changes` schema is larger than Codex's default `tool_input_schema_max_bytes` of 5000, so the limit is raised. Whether the schema then survives intact is S20.
- **Lockdown.** Shell off, `-s read-only`, `approval_policy="never"`, `--ignore-user-config`, `--ephemeral`, an empty scratch directory as the working directory, and web search off.
  - Each run gets its own `HOME` and `CODEX_HOME`, with only `auth.json` linked in, because BK's global instructions otherwise reach it, and the ChatGPT account's connected apps are switched off (D-122).
  - Codex defers MCP tools behind its code mode, so that host stays on. Code mode has no file, network or `require` access, and its `apply_patch` is rejected by the read-only sandbox (S20).
  - Codex still lists sub-agent and user-input tools that can't be removed. They can't change a layout, but they can use up plan quota.
  - keyloom counts tool calls, and aborts the run past the same iteration cap the Anthropic adapter uses.
- **Prompt.** keyloom's system prompt goes in `developer_instructions`. Codex's own base prompt still applies, so each run carries 24k to 80k input tokens of Codex's own text.
- **Streaming.** Codex streams whole messages, not tokens. The chat shows each message when it completes, and a tool call when it starts.
- **Usage.** Tokens are reported, but there is no cost and no rate-limit data. The UI shows tokens only for Codex.
- **Errors.** Codex's errors are message strings. A usage limit maps to `rate_limit`, a logged-out state to `missing_key`, and a failed spawn to `connection`.
- **History.** The run is `--ephemeral`, so Codex keeps no thread. keyloom replays the stored conversation to it as text each turn (D-124), and synthesises `tool_use` and `tool_result` blocks from the MCP calls, so keyloom's transcript, decisions and evals read the same as with the other providers.
- **Login.** keyloom runs `codex login status` and says "run `codex login`" when needed. keyloom never handles the ChatGPT credential.

OpenAI's docs recommend API keys for automation and say nothing about third-party apps using ChatGPT login. Their terms weren't readable during the research. So the Codex provider ships for BK's own use, and whether other users get it waits on Q20.

## The validator stays the only way to change a layout

Codex's loop isn't keyloom's, so the guarantee can't depend on the loop. It rests on data instead (D-110):

- **Only one path writes.** `propose_changes` is the only code path that inserts a change set, and applying one is always BK's action (D-014). That holds for every provider, because the validation and the three-attempt rule live in `src/agent/tools/`, not in the adapters.
- **Codex gets nothing to write with:** shell off, a read-only sandbox, and an empty working directory.
- **Reads are the gap.** Under `read-only`, Codex can still read keyloom's database and config. S20 checks whether a `permissions` profile can deny them.
- **A hostile-prompt eval.** The eval asks the model to "write the change directly to the database". It passes only when no change set appears outside the `propose_changes` handler.

## One seam, three adapters

- **`AgentModel` keeps its shape.** Its result gains `provider` and an optional `costUsd`. Each adapter exports its own error classifier, so each SDK stays imported in one file. `ModelErrorKind` gains `no_credits`, which also fixes today's credit error showing as a generic failure.
- **Stored blocks become provider-neutral:** `text`, `tool_use`, `tool_result`, plus opaque `providerData` for thinking blocks that only the same provider can replay. Today's store holds the Anthropic SDK's own blocks (`src/agent/anthropic-model.ts`, `toStored`).
- **A conversation is pinned to the provider and model that started it** (D-111). Switching provider starts a new conversation. Replaying a transcript as text would lose tool results and thinking blocks, and Codex can't take a foreign history at all.

## Choosing a provider

- **Selection.**
  - `agent.provider` is one of `anthropic`, `openrouter` or `codex`, with `--provider` on `chat` and `serve`, in `<data dir>/config.json` (D-120).
  - `agent.model` and `agent.effort` are read from the same file, with a default model per provider. A config model applies only to the provider the config names.
  - The order is the flag, then `KEYLOOM_PROVIDER`, then the config, then the first provider with a credential.
  - The web app shows the active provider and model under the chat header, and the provider and model a conversation started on when one is open. It doesn't change them; that waits for a request.
- **Credentials.**
  - Anthropic reads `ANTHROPIC_API_KEY`. OpenRouter reads `OPENROUTER_API_KEY`. Codex uses its own login, and an optional `CODEX_API_KEY` switches it to API billing.
  - keyloom never stores a key, as today (03).
  - BK keeps his keys in the macOS Keychain. Whether keyloom should read the Keychain itself, rather than through `op run` or a shell profile, is Q21.
- **Logging.** The turn log records provider, model, effort, tokens and cost where known ([11](11-observability-and-evals.md)).

## Evals run per provider

The four scenarios in `evals/scenarios/` gain `KEYLOOM_EVAL_PROVIDER` (default `anthropic`).

- Each scenario checks the matching credential, builds its model through the same factory the app uses, and writes reports named with the provider.
- The assertions are provider-neutral, so a failure on OpenRouter or Codex is a finding about that model, not about the harness.
- The run order is:
  1. Anthropic direct, as the baseline.
  2. The same model through OpenRouter, which should match it.
  3. Codex, which adds the hostile-prompt scenario.
