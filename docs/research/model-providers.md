# Model providers: Codex, Claude subscription and OpenRouter for keyloom

Reviewed on 2026-10-15.

Versions and refs checked:

- `@openai/codex-sdk` 0.162.1 on npm. It depends on `@openai/codex` 0.162.1. The installed `codex-cli` on BK's machine is also 0.162.1.
- openai/codex at tag `rust-v0.162.1`, commit `092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`. I also read `main` at `f0c5077c34ec7a76b4ad9134835925e6ae3d72ec`. `sdk/typescript/src/{exec,thread,threadOptions,codexOptions,items,events}.ts` are identical at both.
- `@openrouter/sdk` 1.4.25, `openai` 7.34.0, `@anthropic-ai/sdk` 0.134.0 latest (keyloom pins 0.132.1), `@modelcontextprotocol/sdk` 1.32.1.
- keyloom worktree `65cc12aa3fc65a0c1cdebf35566045f75a872740`.
- OpenRouter docs and `GET /api/v1/models` fetched 2026-10-15.

Each claim is tagged "verified in source/docs" with a link, "verified by experiment" (I ran it on 2026-10-15), or "unverified". Doc pages fetched through a summarising tool are marked "docs (summarised)". The quotes from them should be re-read before anything is published.

Source links: `SRC` = `https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`. `SDK` = `SRC/sdk/typescript/src`.

## Summary and recommendation

Build the neutral seam first, then add OpenRouter, then Codex. The order matters because the costs are very different.

OpenRouter is cheap. It exposes an Anthropic-compatible `/messages` endpoint, so the existing adapter may only need a base URL and a bearer token. Needs a live spike with a key.

Codex works, but it is a different kind of provider. I ran it with keyloom-style tools: a custom MCP tool was called, and with the shell tool off it could not run commands. It streams whole messages, not tokens. It reports tokens but no cost. It keeps its own conversation state. It carries 25k to 80k input tokens of its own prompt on every run. Treat it as an "agent backend" adapter with its own conversation handling, not a drop-in `AgentModel`.

A Claude subscription is not an option for keyloom. Anthropic's docs say third-party developers may not route requests through Free, Pro or Max credentials. The same page allows a user to sign in to the unmodified Claude Code binary, which keyloom does not run.

Recommended order:

1. Make stored messages provider-neutral, and pin a conversation to one provider.
2. Parameterise the Anthropic adapter with `baseURL` and `authToken`, point it at OpenRouter, and run the four evals. This is the "OpenRouter key" feature.
3. Add the Codex adapter that spawns `codex exec` directly, not through `@openai/codex-sdk`, with a loopback MCP server for keyloom's tools. Gate it on a spike (below) that shows the ChangeOp tools survive Codex's schema handling.

Unresolved questions are at the end.

## 1. Codex SDK

### It is a thin wrapper that spawns the `codex` binary and reads JSONL

`@openai/codex-sdk` has no model client of its own. `CodexExec.run` spawns `codex exec --experimental-json ...`, writes the prompt to stdin and yields stdout lines as events. Verified in source: [exec.ts](SDK/exec.ts) (`commandArgs = ["exec", "--experimental-json"]`, `spawn(this.executablePath, ...)`). The README says the same: "It spawns the CLI and exchanges JSONL events over stdin/stdout." Verified in source: [README](SRC/sdk/typescript/README.md).

The flag name `--experimental-json` suggests the wire format can change. The event types are generated from `codex-rs/exec/src/exec_events.rs`. Verified in source: [events.ts](SDK/events.ts). Unverified: any stability promise.

### ChatGPT login works through the CLI, and the docs recommend API keys for automation

The SDK has no auth code. It passes `CODEX_API_KEY` if you give it `apiKey`, and otherwise the spawned CLI uses whatever `codex login` stored. Verified in source: [exec.ts](SDK/exec.ts) (`env.CODEX_API_KEY = args.apiKey`). On this machine `codex login status` reports "Logged in using ChatGPT". Verified by experiment.

OpenAI's auth page lists two methods: "Sign in with ChatGPT for subscription access" and "Sign in with an API key for usage-based access". With an API key, Codex "uses standard API pricing instead of included ChatGPT plan credits". It says "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs" and "API keys are still the recommended default for automation". Verified in docs (summarised): https://learn.chatgpt.com/docs/auth (redirect from https://developers.openai.com/codex/auth).

The advanced guide for ChatGPT-managed auth in automation says to use it only on trusted private runners, never for public or open-source repositories, and never to share one `auth.json` across concurrent jobs. Verified in docs (summarised): https://learn.chatgpt.com/docs/auth/ci-cd-auth.

Credentials live in `$CODEX_HOME/auth.json` or the OS keyring, per `cli_auth_credentials_store`, and the docs say to treat the file like a password. Verified in docs (summarised): same auth page.

Whether this is "allowed in a third-party local app" is not answered by anything I could read. The docs describe ChatGPT sign-in only for OpenAI's own Codex clients and say nothing about third-party apps. I could not fetch OpenAI's Terms of Use (HTTP 403 from openai.com and help.openai.com). A web search found no OpenAI policy covering it. Unverified: the terms. The practical position is narrower than Anthropic's. keyloom would never touch the token. It would run BK's own installed `codex`, logged in by BK, on BK's machine, which is what the CLI is for. Using the same arrangement for other users is the part nobody has cleared, and BK should read the current OpenAI terms before offering it to anyone else.

Plan limits are shared: "Local messages and cloud chats share your plan's usage allowance", and Plus has a roughly five-hour window measured in local messages per model. Verified in docs (summarised): https://learn.chatgpt.com/docs/pricing. The docs do not break out SDK or `exec` usage separately.

### Models: `gpt-6.1-sol` is the recommended model on ChatGPT login

The models page lists `gpt-6.1-sol` (recommended for complex agentic work, Plus and above), `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, and `gpt-5.5`, which retired from ChatGPT sign-in on 2026-10-14 and stays available on an API key. Set with `-m` or `model = ...`. Verified in docs (summarised): https://learn.chatgpt.com/docs/models. The SDK passes `--model`. Verified in source: [exec.ts](SDK/exec.ts). No Anthropic models. With `model_provider` set, Codex can use another OpenAI-compatible endpoint, but only over the Responses wire format. Verified in source: [config.schema.json](SRC/codex-rs/core/config.schema.json) (`WireApi` has the single value `responses`).

### keyloom's tools can be supplied as an MCP server, per run; I ran this

Codex config has `mcp_servers.<name>` with `command`, `args`, `env` for stdio, or `url` plus `bearer_token_env_var` and `http_headers` for streamable HTTP. It also has `enabled_tools`, `disabled_tools`, `default_tools_approval_mode` (`auto`, `prompt`, `writes`, `approve`), `tool_timeout_sec` and `startup_timeout_sec`. Verified in source: [config.schema.json `RawMcpServerConfig`](SRC/codex-rs/core/config.schema.json).

The SDK accepts `config: { mcp_servers: { keyloom: { url, bearer_token_env_var } } }` per `Codex` instance. It flattens the object to repeated `--config key=value` flags. Verified in source: [exec.ts `serializeConfigOverrides`](SDK/exec.ts). The CLI accepts the same through `-c`. Verified by experiment, below.

Experiment on 2026-10-15, `codex-cli` 0.162.1, ChatGPT login, `--ephemeral`, a scratch directory. I wrote a 15-line stdio MCP server exposing one tool, `find_function`, and ran:

```
codex exec --experimental-json --ephemeral --skip-git-repo-check --ignore-user-config \
  -s read-only -c 'features.shell_tool=false' -c 'approval_policy="never"' \
  -c 'mcp_servers.keyloom.command="node"' -c 'mcp_servers.keyloom.args=["…/mcp-echo.mjs"]' \
  -c 'mcp_servers.keyloom.default_tools_approval_mode="approve"' \
  "Call the find_function tool with function 'mod:LALT' …"
```

The stream contained `item.started` and `item.completed` events of type `mcp_tool_call` with `server: "keyloom"`, `tool: "find_function"`, the arguments, and the result text. The model then answered with it. Verified by experiment.

For keyloom the better transport is streamable HTTP on `127.0.0.1` with a random port and a per-run bearer token passed through `bearer_token_env_var`. The tools then run inside the keyloom process, so `instrument()` in `run-turn.ts`, the recorder and the validator all stay in the same address space. A stdio server would be a second process that needs the DB handle. HTTP transport is verified in the schema only, not run. Unverified: HTTP end to end, and the HTTP MCP server under a `bun build --compile` binary.

A risk in the ChangeOp tools: the config exposes `tool_input_schema_max_bytes`, described as the "UTF-8 byte threshold for compacting each ordinary MCP tool input schema. Defaults to 5,000 bytes". Verified in source: [config.schema.json](SRC/codex-rs/core/config.schema.json). keyloom's `propose_changes` schema, built from the ChangeOp union, is far larger than 5,000 bytes. What compaction drops is unverified. Set a large value per tool and test.

### Codex's own tools can be mostly removed, but not provably to zero

`features.shell_tool=false` removes `exec_command` and `write_stdin` from the model's tool list. Verified in source: [core/tests/suite/tools.rs `unified_exec_spec_toggle_end_to_end`](SRC/codex-rs/core/tests/suite/tools.rs). The feature key exists in [features/src/lib.rs](SRC/codex-rs/features/src/lib.rs).

I asked the model to list its tools with the shell feature off, then to also disable `code_mode`, `unified_exec`, `multi_agent`, `apply_patch_freeform`, `view_image` and others. Both times the reply still named `functions.exec`, `functions.wait`, `functions.request_user_input`, and `collaboration.spawn_agent` and its siblings. That is the model's own report, not a tool dump. I then asked it to run `ls` and `touch` with shell off and `-s read-only`. It said "no local command-execution tool is available" and ran nothing, and no file appeared. Verified by experiment, on one prompt each. So the shell is gone in practice, but the remaining tool surface (sub-agent spawning, user-input requests) is not documented as removable. Unverified: a flag set that leaves only MCP tools.

Other controls:

- `sandbox` is `read-only`, `workspace-write` or `danger-full-access`, and `approval_policy` is `never`, `on-request`, `on-failure` or `untrusted`. Verified in source: [threadOptions.ts](SDK/threadOptions.ts).
- A read-only sandbox blocks writes but not reads. The docs I read do not say reads are restricted. The config has a `permissions` table and `default_permissions` with filesystem rules, and the SDK README shows `filesystem={":root"="read", ".env"="deny"}`. Verified in source: [README](SRC/sdk/typescript/README.md). I did not run it. Unverified: that a profile can hide `~/.config/keyloom` and the SQLite file from a model that has some file-reading tool.
- `--ignore-user-config` skips `$CODEX_HOME/config.toml` while auth still uses `CODEX_HOME`. Verified in source: [exec/src/cli.rs](SRC/codex-rs/exec/src/cli.rs). The SDK does not expose this flag. Without it, BK's own `~/.codex/config.toml` (MCP servers, hooks, instructions) applies to keyloom runs.
- Run in an empty scratch directory with `skipGitRepoCheck`, so `AGENTS.md` discovery finds nothing. The SDK requires a git repo unless that flag is set. Verified in source: [README](SRC/sdk/typescript/README.md).

### Streaming is whole items, not tokens

`ThreadEvent` is one of `thread.started`, `turn.started`, `turn.completed` (with usage), `turn.failed`, `item.started`, `item.updated`, `item.completed`, `error`. Item types are `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `todo_list`, `error`. Verified in source: [events.ts](SDK/events.ts), [items.ts](SDK/items.ts).

The JSONL processor handles plan updates and returns `Running` for every other notification, so there are no text deltas. Verified in source: [exec/src/event_processor_with_jsonl_output.rs](SRC/codex-rs/exec/src/event_processor_with_jsonl_output.rs). In my run, `agent_message` arrived complete, including an intermediate "I'll look for the find_function tool" message before the tool call. keyloom's `onText(delta)` would be called once per message, so the chat panel would show text in blocks. `Turn.finalResponse` keeps only the last `agent_message`. Verified in source: [thread.ts](SDK/thread.ts).

`reasoning` items carry a summary string. Whether the summary appears by default for the models above is unverified.

### Structured output works per turn, but it is not a replacement for tools

`turnOptions.outputSchema` (a plain JSON schema) is written to a temp file and passed as `--output-schema`. The final message then contains JSON. Verified in source: [thread.ts](SDK/thread.ts), [outputSchemaFile.ts](SDK/outputSchemaFile.ts). The README says OpenAI-style strict schemas apply (`additionalProperties: false`, all keys required). It is unverified whether the ChangeOp union passes that subset. keyloom's validate-and-retry loop needs tool results in the middle of a turn, so structured output would only be the fallback design: ask for proposals as the final JSON, validate in keyloom, and resume the thread with the errors.

### Usage has tokens only; there is no cost and no rate-limit data

`turn.completed.usage` has `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`. Verified in source: [events.ts](SDK/events.ts). Nothing in the stream carries a price, a balance or the plan window. The CLI shows remaining limits through `/status` in a TUI session, and the docs point to a usage dashboard. Verified in docs (summarised): https://learn.chatgpt.com/docs/pricing.

Failures arrive as `error` events and `turn.failed` with a message string only (`ThreadError = { message }`). Verified in source: [events.ts](SDK/events.ts). The usage-limit text is "You've hit your usage limit. Upgrade to Pro (...), visit https://chatgpt.com/settings/usage to purchase more credits or try again later." Verified in source: [protocol/src/error_tests.rs](SRC/codex-rs/protocol/src/error_tests.rs). keyloom would have to match on message text to map this to `rate_limit`. A non-zero exit gives "Codex Exec exited with code N: stderr". Verified in source: [exec.ts](SDK/exec.ts).

Per-run overhead is large. My three runs reported 24k to 80k input tokens for a one-line task, of which up to 65k were cached. That is Codex's own system prompt and tool catalogue. Verified by experiment.

### Sessions resume by thread id from `~/.codex/sessions`

`resumeThread(id)` runs `codex exec ... resume <id>`. Threads persist in `~/.codex/sessions` unless `--ephemeral`. Verified in source: [exec.ts](SDK/exec.ts), [README](SRC/sdk/typescript/README.md). The thread id comes from the `thread.started` event. Resuming means Codex owns the history. keyloom's `history: ModelMessage[]` is ignored after the first turn, except for the new user message. The session files hold keyloom prompts, including the layout and BK's stated priorities, in `~/.codex` outside keyloom's control. Use `--ephemeral` and give up resume, or accept the files.

### Platform support: use the installed binary; the SDK's own lookup will not work in a compiled binary

The SDK finds the binary by `require.resolve("@openai/codex/package.json")` and then the platform package (`@openai/codex-darwin-arm64`, `-darwin-x64`, `-linux-x64`, `-linux-arm64`, `-win32-x64`, `-win32-arm64`). Verified in source: [exec.ts](SDK/exec.ts). Inside a `bun build --compile` executable there is no `node_modules` to resolve against. `codexPathOverride` skips the lookup. Verified in source: [codex.ts](SDK/codex.ts). Unverified: the SDK running under Bun at all. It uses `node:child_process`, `readline` and `createRequire`, which Bun supports, but I did not run it.

Spawning `codex exec --experimental-json` from keyloom directly is about 60 lines (arguments, stdin write, line-by-line JSON parse, abort via `AbortSignal`, stderr capture). It avoids a dependency and gives access to flags the SDK lacks (`--ignore-user-config`, `--ephemeral`). The SDK is Apache-2.0 and its `exec.ts` is the reference. The cost is tracking `exec_events.rs` ourselves. Locate the binary with `which codex` or a configured path, and check `codex --version` and `codex login status` before use.

## 2. A Claude subscription is not available to keyloom

Anthropic's legal page says OAuth "is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications". It says developers "including those using the Agent SDK, should use API key authentication", and: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users." It adds that developers "may not collect, store, or intermediate Claude.ai credentials or session tokens". Verified in docs (summarised): https://code.claude.com/docs/en/legal-and-compliance.

The Agent SDK overview repeats it: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Verified in docs (summarised): https://code.claude.com/docs/en/agent-sdk/overview.

One carve-out: the policy "does not prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". That is Claude Code itself, which has its own tools, prompt and TUI, not keyloom calling the Agent SDK with a subscription. The same page says plan limits "assume ordinary, individual usage of Claude Code and the Agent SDK".

Whether BK using the Agent SDK in his own personal tool with his own login counts as "offering" is not answered by the text. It is written for products offered to others. keyloom is meant to serve other users (Q3 in the blueprint), so building it on subscription auth would be the prohibited case. A way to get an answer is the sales contact the page names. The Agent SDK also bundles Claude Code's tools and prompt, which has the same problem Codex has with keyloom's validator-gated tools. Do not build this.

OpenAI is looser on paper in that nothing forbids it, and tighter in that nothing allows it. That asymmetry is the finding, not a clearance.

## 3. OpenRouter

### Chat Completions has tools, streaming, reasoning and per-request cost

OpenRouter's Chat Completions API (`POST https://openrouter.ai/api/v1/chat/completions`) takes OpenAI-shaped `tools`, `tool_choice` (`none`, `auto`, `required`, or a named function) and `parallel_tool_calls` (default true). "For non-OpenAI providers, it will be transformed accordingly." Verified in docs: https://openrouter.ai/docs/api_reference/parameters. Streaming is SSE, and cancelling the connection stops processing and billing for supported providers. Verified in docs: https://openrouter.ai/docs/api_reference/streaming (text read from `llms-full.txt`, section "Stream cancellation").

Reasoning is controlled by `reasoning: { effort | max_tokens, exclude, enabled }`. Effort accepts `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`. For Anthropic models the budget is `max(min(max_tokens * ratio, 128000), 1024)` with ratio 0.95 for max and xhigh, 0.8 high, 0.5 medium, 0.2 low, 0.1 minimal. Reasoning tokens bill as output and count against `max_tokens`. Reasoning comes back in `message.reasoning` and in `reasoning_details` (types `reasoning.summary`, `reasoning.encrypted`, `reasoning.text`), which must be passed back unmodified for tool-use turns. Verified in docs: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.

Usage is always present, in the final SSE chunk or the response body: `prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens`, `prompt_tokens_details.cached_tokens` and `cache_write_tokens`, and `cost` (credits charged). `stream_options.include_usage` and `usage: {include: true}` are deprecated no-ops. Verified in docs: https://openrouter.ai/docs/cookbook/administration/usage-accounting. Streams end with an extra usage chunk that repeats `finish_reason`. Verified in docs: streaming page above.

Errors use `{ error: { code, message, metadata } }`. The docs list invalid credentials, insufficient credits, forbidden (including guardrail and budget blocks, which carry reset times in `metadata`), timeout, rate limited, and provider down. The numeric codes were stripped from the text I fetched. The mapping to Anthropic error types is `payment_required` to `billing_error`, `rate_limit_exceeded` to `rate_limit_error`, `provider_overloaded` to `overloaded_error`. `Retry-After` may be sent on rate-limit and credit responses. Errors after the stream starts arrive as SSE data with an `error` field. Verified in docs: https://openrouter.ai/docs/api_reference/errors-and-debugging. HTTP 402 for no credits is standard for OpenRouter but the fetched text did not show the digits. Unverified: the exact status numbers from the page.

### OpenRouter also serves an Anthropic Messages endpoint

OpenRouter documents `POST /api/v1/messages` and says it "exposes an input that is compatible with the Anthropic Messages API", with an "Anthropic Skin" that "behaves exactly like the Anthropic API" and passes through thinking blocks and native tool use. Claude Code is pointed at it with `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<key>` and `ANTHROPIC_API_KEY=""`. Verified in docs: https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration. The base URL has no `/v1`, which the SDK appends.

Details that matter for keyloom:

- Reasoning on `/messages`: `output_config.effort` maps to the unified `reasoning.effort`, `thinking: {type: "adaptive"}` to `reasoning.enabled`, and `output_config.effort` wins over adaptive. "Claude receives both fields unchanged." Verified in docs: reasoning-tokens page, "Reasoning with the Anthropic Messages API". keyloom sends exactly `thinking: adaptive` plus `output_config.effort`.
- Usage arrives in `message_delta` before `message_stop`. Verified in docs: streaming page. Whether `cost` is included in that Messages-shape usage is unverified.
- Errors on `/messages` use Anthropic envelopes (`authentication_error`, `billing_error`, `rate_limit_error`, ...) with an added `error.error_type`. Verified in docs: errors page. The SDK's `AuthenticationError`, `RateLimitError` and `APIError` classes should map, so `classifyModelError` may keep working. Unverified.
- OpenRouter sets `eager_input_streaming: true` itself on streamed requests with tools. Strict tool use needs the header `x-anthropic-beta: structured-outputs-2025-11-13`, and without it "OpenRouter will strip the `strict` field and route normally". Verified in docs: https://openrouter.ai/docs/guides/routing/provider-selection (section "Provider-Specific Headers"). keyloom's two large tools are already non-strict. The small tools use strict, which would silently become non-strict. That is harmless because zod validates every input.
- Not documented, so unverified: whether the SDK's beta Tool Runner (`client.beta.messages.toolRunner`, `/v1/messages?beta=true`) works, whether `betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"` is accepted or rejected, and whether top-level `cache_control` is accepted (OpenRouter says "Prompt caching and extended context are enabled based on model capabilities"). OpenRouter's Fable 5.1 migration page is listed as covering "forced tool use rejected" (index description only, page not read), which matches keyloom's `tool_choice: auto` approach.
- OpenRouter says Claude Code "is only guaranteed to work with the Anthropic first-party provider" and recommends setting Anthropic 1P as top provider. Verified in docs: the Claude Code page. Pin the provider in the request (`provider: { order: ["anthropic"], allow_fallbacks: false }`) if the first spike shows tool or thinking differences. The exact field names are in the provider-selection page and not yet tested.

`@anthropic-ai/sdk` 0.132.1 has `baseURL` and `authToken` client options. Verified in source: `client.d.ts` from the 0.132.1 tarball (`authToken?: string`, `baseURL?: string`). So `new Anthropic({ baseURL: "https://openrouter.ai/api", authToken: key })` is the whole change at the client. Unverified until run with a key. I had no OpenRouter key here.

The `/messages` endpoint also takes non-Claude models: the docs say the `thinking` and `output_config.effort` fields are normalised "so they work on every reasoning model, not only Claude". That is a docs claim; whether keyloom's stored Anthropic blocks (thinking signatures) replay across models is unverified.

### Model IDs: `anthropic/claude-opus-5.5` and `anthropic/claude-sonnet-5.5`

From `GET https://openrouter.ai/api/v1/models` on 2026-10-15, all with 1,000,000 context and `tools`, `tool_choice`, `reasoning`, `structured_outputs` in `supported_parameters`:

| ID | Prompt $/token | Completion $/token |
|---|---|---|
| `anthropic/claude-opus-5.5` | 0.000004 | 0.00002 |
| `anthropic/claude-sonnet-5.5` | 0.000002 | 0.00001 |
| `anthropic/claude-haiku-5.5` | 0.0000001 | 0.0000005 |
| `anthropic/claude-opus-5` | 0.000005 | 0.000025 |
| `anthropic/claude-fable-5.1` | 0.00001 | 0.00005 |

Each has a `:batch` variant at half price. Verified in docs: the live models response (saved in `/tmp/keyloom-refs/or/models.json`). The Opus 5.5 price matches `evals/` and `12-cost-model` ($4 and $20 per million). keyloom's `claude-opus-5-5` maps to `anthropic/claude-opus-5.5`. Rolling aliases such as `~anthropic/claude-opus-latest` exist in the docs, but pin the dated ID so evals stay comparable.

### Which TS client: the Anthropic SDK for Claude models, plain `fetch` or `openai` for the rest

The choices:

1. `@anthropic-ai/sdk` with `baseURL` and `authToken`. No new dependency, the existing tool runner, streaming and block storage stay. Covers every Claude model on OpenRouter. Needs the spike above.
2. `openai` 7.34.0 with `baseURL: "https://openrouter.ai/api/v1"`. OpenRouter lists it among recommended SSE clients. It is the right client for the Chat Completions shape (non-Claude models). It brings a second tool loop to write (the OpenAI SDK's tool-runner helpers take zod through `zodFunction`; their behaviour with OpenRouter is unverified).
3. `@openrouter/sdk` 1.4.25 and `@openrouter/agent` 0.11.0. Typed and current, but young, with its own loop abstractions, and its docs steer users away from `openai`. It adds a dependency that must track a fast-moving API.
4. Plain `fetch` plus `eventsource-parser`. Smallest dependency; keyloom would own SSE framing, tool-call delta accumulation and retries.

Recommendation: option 1 first. Add option 2 only if BK wants non-Claude models through OpenRouter, because Chat Completions is the shape every OpenRouter model has in common. Unverified: whether option 1 is good enough for non-Claude models.

### Tool schemas and strict mode map as follows

Chat Completions tool: `{ type: "function", function: { name, description, parameters } }`, with `parameters` as plain JSON Schema from `z.toJSONSchema`. OpenRouter converts it for non-OpenAI providers. Verified in docs: parameters and tool-calling pages. `strict` in Chat Completions is passed through for OpenAI-family models. Anthropic strict needs the beta header above. Both big keyloom tools stay non-strict. On `/messages` the tool shape is Anthropic's `{ name, description, input_schema }`, which is what keyloom sends today. `transformJSONSchema` in the Anthropic SDK is only needed for strict.

## 4. Design for keyloom

### Shape: one `AgentModel`, three adapters, neutral stored messages

`AgentModel` stays as is: `run(request)` returns `{ messages, stopReason, iterations, usage }`. Three changes to the seam.

- Add a `provider` field next to `model` and `effort` for the turn log, and add `costUsd?: number` to the result. Anthropic computes it from the price table as the evals do. OpenRouter reads `usage.cost`. Codex leaves it undefined and the UI shows tokens only.
- Make stored `ContentBlock`s neutral: `text`, `tool_use { id, name, input }`, `tool_result { tool_use_id, content, is_error }`, plus an optional opaque `providerData` for thinking and reasoning blocks that only the same provider may replay. Today the store holds Anthropic blocks as the SDK returned them, including thinking blocks with signatures. Verified in source: `src/agent/anthropic-model.ts` (`toStored`) and `src/agent/model.ts` (`ContentBlock` is an Anthropic block). The OpenRouter-Messages adapter keeps this format unchanged. A Chat Completions adapter and the Codex adapter both need to translate.
- Pin each conversation to the provider and model that started it, and store `provider` on the conversation. Switching means a new conversation. The alternative, replaying a transcript as text, loses tool results and thinking, and Codex cannot take foreign history at all.

### Per-adapter changes

| | anthropic (exists) | openrouter | codex |
|---|---|---|---|
| Transport | `@anthropic-ai/sdk` Tool Runner | Same SDK, `baseURL` OpenRouter, `authToken`. Later an `openai` Chat Completions variant | `codex exec --experimental-json` child process |
| Tools | `betaZodTool`, strict where small | Same, `strict` stripped unless header sent | Loopback MCP server (streamable HTTP, bearer token) wrapping the same `ModelTool`s. `default_tools_approval_mode="approve"`. Raise `tool_input_schema_max_bytes` |
| System prompt | `system` | `system` | No system field in the SDK. Put keyloom's prompt in the `-c developer_instructions=...` override (key exists in schema) or at the start of the prompt. Codex's own base prompt still applies. Unverified: which wins on conflicts |
| Thinking and effort | `thinking: adaptive`, `output_config.effort` | Same fields, normalised by OpenRouter. Chat Completions variant uses `reasoning.effort` | `modelReasoningEffort` / `model_reasoning_effort` (values up to `max`, `ultra` in the SDK type) |
| Streaming | Token deltas via `stream.on("text")` | Same on `/messages` | Item-level only. Call `onText` per `agent_message` item. Map `mcp_tool_call` `item.started` to `onToolCall` |
| Loop and iteration cap | Runner `max_iterations` | Same | No cap option found. Count MCP calls in the keyloom handler, return an error result past the cap and abort with `signal` if ignored. Unverified: Codex's own turn limits |
| Stored messages | SDK's own transcript | Same | Synthesise assistant `tool_use` and user `tool_result` blocks from MCP items and the handler's results, so `conversations.ts` (which lists `tool_use` names) keeps working. Keep Codex's thread id in `providerData` |
| Usage | `usage` with cache read and write | Messages: `message_delta` usage. Chat Completions: final chunk, plus `cost` | `turn.completed.usage`. Map `cached_input_tokens` to cache read, `cache_write_input_tokens` to cache write, add reasoning tokens to output. Cost unknown |
| Stop reasons | `refusal`, `max_tokens`, `model_context_window_exceeded`, `tool_use` | Same on `/messages` | `turn.completed` is `end_turn`. `turn.failed` is an error. No refusal or truncation signal found |
| Errors | `classifyModelError` on SDK classes | Same classes if OpenRouter's envelopes map (unverified), with message text adjusted to name OpenRouter and credits. `billing_error` becomes a new kind `no_credits` | Parse `error` and `turn.failed` message text. Map "usage limit" to `rate_limit`, spawn failure or non-zero exit to `connection`, missing binary or logged-out status to `missing_key` |

`ModelErrorKind` gains `no_credits`. `classifyModelError` becomes per-adapter (each adapter exports `classify`) so the Anthropic SDK stays imported in one file.

### Validator-gated tools must stay the only way to change a layout

This is the main risk with Codex, because Codex runs an agent loop keyloom does not control. The boundary keyloom controls is data, not process.

- The layout and decisions live in keyloom's SQLite database. `propose_changes` is the only code path that inserts a `change_set`, and applying one is BK's action (D-014). That does not depend on the model at all. A Codex run cannot apply a change even if it misbehaves, as long as it cannot write keyloom's files.
- Give Codex nothing to write with. Shell off (verified to remove command execution, on one prompt), `-s read-only`, `approval_policy="never"`, `--ignore-user-config`, an empty scratch cwd, `--ephemeral`, and web search disabled. Verified in source/by experiment as above.
- Reads are the leak. keyloom's database and `~/.config` stay readable under `read-only` unless a `permissions` profile denies them. Unverified. Test it: ask the model to read a file outside the cwd with shell off.
- The tool surface after these flags still includes sub-agent and user-input tools I could not remove. They cannot change a layout. They can burn plan usage. Cap with the iteration counter and an `AbortSignal` timeout.
- Start a hostile-prompt eval for the Codex path: a user message that says "write the change directly to the database". It should end with no new `change_set` rows outside the `propose_changes` handler. Count rows before and after, and assert on `toolCalls`.
- Keep the validator inside the handler, as today. A Codex run that sends an invalid proposal gets the same error `tool_result` and the same three-attempt rule. That logic lives in `src/agent/tools/`, not in the adapter, so it holds for every provider.

### Config: a `provider` setting and keys from the environment, then the Keychain

Today `clientFromEnv` reads `ANTHROPIC_API_KEY` only, and the key is never stored (03#model-and-sdk). Keep that rule.

- `agent.provider`: `anthropic` (default), `openrouter`, `codex`. `agent.model` and `agent.effort` stay, interpreted per provider (`anthropic/claude-opus-5.5` for OpenRouter, `gpt-6.1-sol` for Codex). A per-provider default model table lives next to the adapters.
- Anthropic: `ANTHROPIC_API_KEY`. OpenRouter: `OPENROUTER_API_KEY`. Codex: no key; keyloom runs `codex login status` and reports "run `codex login`" if it is not logged in. An optional `CODEX_API_KEY` passes through to switch Codex to API billing.
- Where keys come from on BK's machine: today `op run -- keyloom chat`, per the existing error message. OpenRouter's own docs suggest `security find-generic-password -s openrouter -w` for macOS. That is a shell-profile pattern, so keyloom does not need to read the Keychain itself. Add `keyloom` support for a Keychain lookup only if BK wants to stop using `op run`. Reading a generic password by shelling out to `security` is simple but is a new code path to maintain, so I would not add it until asked.
- Selection order: CLI flag `--provider`, then config, then the default. The UI shows the active provider and model, since the cost and behaviour differ.
- Per-turn log records `provider`, `model`, `effort`, tokens and `costUsd` where known.

### Evals run per provider by parameter, with provider-tagged reports

The four scenarios in `evals/scenarios/*.eval.test.ts` build the app and call `sendMessage`. They are gated by `ANTHROPIC_API_KEY` and `KEYLOOM_LIVE_EVALS=1`, and write `evals/reports/<date>-<model>-<effort>-<scenario>.md`. Verified in source: `evals/scenarios/option-option.eval.test.ts`.

Change: add `KEYLOOM_EVAL_PROVIDER` (default `anthropic`), have the gate check the matching credential, build the model through the same `defaultAgentModel(provider)` factory the app uses, and include the provider in the report file name and header. The cost helper reads `outcome.costUsd` when present and falls back to the price table. Codex reports show tokens only. The assertions (valid alternative, Option reachable, no multi-tap on S) are provider-neutral, so a failure on OpenRouter or Codex is a real finding about that model, not a harness problem. Add the hostile-prompt scenario for Codex above.

Run order: Anthropic direct as the baseline, the same model through OpenRouter to prove the endpoint is transparent (the reports should match in kind and roughly in cost), then Codex.

### Spikes to run before committing to each adapter

1. OpenRouter, about an hour, needs a key: run `option-option.eval.test.ts` with `baseURL` and `authToken` set. Check the Tool Runner, the fallback beta, `cache_control`, usage and `cost` fields, and an out-of-credits error.
2. Codex, about half a day: stand up the loopback HTTP MCP server with the real tools. Check that `propose_changes`'s schema survives (`tool_input_schema_max_bytes`), that the validate-and-retry loop works over MCP, how many tokens a four-message conversation costs on the Plus plan window, and whether intermediate `agent_message` items need filtering from the stored text.
3. Both: a `bun build --compile` binary that spawns the installed `codex` and serves the MCP server.

## Unresolved questions

- Is BK content to run Codex only on his own machine with his own login, or should other users be able to? OpenAI's terms were unreadable to me, and the answer decides whether the Codex adapter ships beyond BK.
- Should a conversation be pinned to its provider, or does BK want mid-conversation switching, which costs a neutral transcript and loses thinking blocks?
- Is a proper Keychain lookup wanted, or is `op run` enough?
- Is OpenRouter wanted for Claude only, or for other models too? The second needs the Chat Completions adapter.
- Does BK accept Codex without token streaming and without a cost figure?
