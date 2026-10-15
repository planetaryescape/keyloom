# 12: Cost model

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
| Output, including thinking | ~2,000–4,000 | A proposal with two or three alternatives |

A first turn costs about 16k uncached input and 3k output, around $0.06 + $0.06 = **$0.12**. A later turn with about 16k input read from cache, 4k new input and 3k output costs around $0.003 + $0.016 + $0.06 = **$0.08**. Output dominates. A 20-turn session reworking a layout comes to roughly **$1.50–$3**. BK's use is a handful of sessions a month, so the cost is small, and none of these numbers justify a cheaper model before the evals say quality holds.

## What would change the cost

- **Layout size.** If `get_layout` dominates, the tool can return only the requested layers and the agent can ask for more. The tool already takes `layers`.
- **Effort.** `medium` is the starting point (D-031). A move to `high` is justified by eval results, not by assumption.
- **Other users.** Each person pays for their own key. keyloom shows the token usage and estimated cost of each turn in the chat footer, so nobody is surprised.
