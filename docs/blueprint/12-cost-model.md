# 12: Cost model

Status: per-turn usage and cost display, including saved/reopened conversations, is implemented and checked against the compiled client. Checks used synthetic provider outcomes, not paid generation; see [verification scope](../research/blueprint-audit-closeout.md).

keyloom costs nothing to host, because there's no hosting (D-028). The only running cost is model usage, paid by whoever's key it runs on (D-031, Q3). Builds and flashes are local and free.

## Prices

`claude-opus-5-5`: $4 per million input tokens, $20 per million output tokens, and $0.20 per million cached-input reads (claude-api skill pricing table, cached 2026-10-06). Check the current price before quoting it anywhere public.

## Estimate per agent turn

These are estimates to be replaced by measurements from rung 3's logs ([11](11-observability-and-evals.md#logs)):

| Part | Tokens (estimate) | Why |
|---|---|---|
| System prompt, board context and skill, firmware capabilities, decisions | ~6,000 | Stable within a conversation, so cached after the first turn |
| `get_layout` result | ~5,000–10,000 | 7–8 layers of 72–80 keys as grids plus JSON. It's the biggest variable |
| Conversation so far | grows | Each turn appends |
| Output, including thinking | ~1,000–2,000 | One proposal (D-452; it was 2,000–4,000 for two or three alternatives), plus about 300 for a question |

A first turn costs about 16k uncached input and 3k output, around $0.06 + $0.06 = **$0.12** (about 1.5k to 2k output, $0.09 to $0.10, for one proposal with D-452). A later turn with about 16k input read from cache, 4k new input and 3k output costs around $0.003 + $0.016 + $0.06 = **$0.08**. Output dominates. A 20-turn session reworking a layout comes to roughly **$1.50–$3**. BK's use is a handful of sessions a month, so the cost is small, and none of these numbers justify a cheaper model before the evals say quality holds.

## Turns per task with the refine loop (D-452)

Each answer to a question is a new turn, so a task with two questions is three turns where it was two (ask, then three alternatives). A turn that revises re-reads the conversation from cache and writes one proposal (about 1k to 1.5k output), so the extra turn is about $0.08 (the later-turn figure above) and the single proposals take back some of it: roughly $0.05 to $0.10 more for a two-question task, and $0.03 to $0.05 less for a request with nothing to ask, which was a proposal of two or three alternatives. These are estimates from the table above, not measurements; the reports from `evals/scenarios/command-shift.eval.test.ts` are the first real figures.

## What would change the cost

- **Layout size.** If `get_layout` dominates, the tool can return only the requested layers and the agent can ask for more. The tool already takes `layers`.
- **Effort.** `medium` is the starting point (D-031). A move to `high` is justified by eval results, not by assumption.
- **Other users.** Each person pays for their own provider. A quiet footer below each reply shows the USD figure, and one click opens the input/output tokens and cache reads/writes when reported (D-456). It distinguishes a complete provider-reported USD charge from a list-price estimate. Estimates use only the exact Opus 5.5 model IDs listed above; unknown models and Codex never receive invented Opus pricing or a zero-cost claim. If any request in a multi-request turn omits its charge, the provider total is unavailable rather than a partial sum. Recorded accounting survives reload and Conversations reopen; legacy turns without accounting say it was not reported. Existing CLI JSON outcomes and logs retain their usage and available cost fields.
