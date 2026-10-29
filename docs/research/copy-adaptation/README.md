# Copied setups refine on their separate target config

Implementation base: fetched `origin/main bb99c14f62208bd146ae13f84183ac6406fecf81` (v0.59.1). Decision: D-460. No real keyboard, kanata reload, personal data or paid model is part of these checks.

Run the deterministic journey:

```sh
agent-work run -- bun test test/app/copy-adaptation.test.ts test/agent/copy-handoff-order.test.ts
```

`test/helpers/copy-adaptation.ts` makes a synthetic Glove80 with an unmatched layer-access key and a smaller Corne. Source preference: keep Navigation in the left hand while the right uses a mouse. Target preference: reserve the inner left thumb for Space. The translator's first placement is the right inner thumb; the scripted target proposal changes that to preserve both preferences, places Navigation on the middle left thumb, retains the complete two-layer setup, and keeps Navigation reachable. This proves context delivery and the state transitions; it does not establish a real model's ergonomic judgment.

The broader app journey tests create a separate target conversation, save one proposal, pause on its associated question, revise after an unchanged answer, Apply and inspect the target choice. The choice carries the original request and answer message IDs. Source and existing target documents, heads and selected status remain intact. A first config for a board remains unselected.

| Event | Stored behavior |
|---|---|
| Successful source copy | Complete source turn; accepted target run receives immutable context |
| Tool after successful copy | Refused; no source question or second config |
| Question before copy | Source waits; copy does not execute |
| Failed copy followed by question | Ordinary tool error; question remains answerable; no target artifacts |
| Invalid question before successful copy | Validation error for that question; source completes without another source request |
| Fresh request after the copy is applied | Ordinary copy/config creation is available; historical facts remain without old control instructions |
| Answer continuing a copy | Config creation stays blocked, including when Apply occurs during that answer |
| Answer with unchanged ops | Valid replacement supersedes previous proposal and retains answer provenance |
| Invalid replacement | Previous target proposal remains open |
| Target edit while waiting | G1's moved-head note names the target change |
| Source edit/apply while waiting | Target question stays open; no false moved-head note |
| Stop after receipt, before launch | Target preparation remains; deferred run cancels without provider execution |
| Duplicate source or answer identity | Returns original artifacts |
| Process interruption | Reconciliation records interrupted work; inspection never executes it |

Anthropic and OpenRouter use ordered terminal-call handling in their shared adapter. Codex refuses later MCP tools immediately after a successful terminal tool, including while its completion item is buffered. Tests preserve provider tool-result pairing.

No database migration is added. The accepted target request JSON stores copy context; the source effect receipt and presentation store its handoff references. Existing schemas ignore the added optional metadata. Older clients can read target proposals/questions, but do not know how to follow a handoff. Downgrade does not restart deferred work.

To assess an authorized live model, from `evals/`:

```sh
KEYLOOM_EVAL_PROVIDER=codex KEYLOOM_LIVE_EVALS=1 bun test ./scenarios/copy-adaptation.eval.test.ts
```

The scenario is gated, uses the synthetic fixture and writes a report under `evals/reports/`. It was prepared without running a paid model. It checks proposal ownership, refinement/Apply memory, actual left-thumb access, and preservation of the originals. Browser screenshots, keyboard-only navigation and installed-release proof belong to the release gate; deterministic tests cannot substitute for them.

## Local verification

The focused app, adapter and CLI checks passed: 27 tests, 164 assertions. The gated live scenario was loaded with live calls disabled: one skip, no failures. Main and eval TypeScript checks and dependency-cruiser pass. The first-config preservation test fails when its unselected-creation fix is disabled and passes with the fix restored.

React Doctor reported an ordered `await` and a lookup through the bounded tool list in the Anthropic adapter. The calls must execute in order to preserve question/terminal boundaries, so those diagnostics do not warrant concurrent execution. The TypeScript and simplification review retained the repository's conditional-spread idiom rather than changing adjacent style.

An early full run exposed ordinary legacy-chat regressions when every stream was routed through durable acceptance. Ordinary legacy streams now keep their original ownership and error propagation; only a copy enters the handoff coordinator. The affected original tests pass. Exact-candidate full-suite and release evidence are retained in the orchestration handover; this note does not claim an installed or browser journey was verified.

## Review regressions preserve later tasks and concurrent terminal boundaries

The first candidate kept its copy restriction for every later turn in the target conversation. The restriction now belongs to the adaptation task: after its proposal is applied, a fresh request can make another copy. A continuation answering a question still cannot create a config. `test/app/copy-adaptation.test.ts` covers both durable and legacy paths, Apply during an answer, and contexts saved before facts were stored separately.

`test/agent/codex-terminal-concurrency.test.ts` sends overlapping HTTP calls through the real MCP server to asynchronous tools. It checks one successful terminal effect, correction after a failed first call, and exclusion after an asynchronous pause. A per-run promise chain preserves arrival order without a separate queue service.

The shared Anthropic/OpenRouter adapter validates an earlier question before giving it precedence over a terminal tool. A malformed question receives a validation error; a successful following copy completes the source with paired tool results. The regression continues the original source conversation afterward to check that no hidden open question remains.

The gated live eval checks Navigation37 and Space38 in the first best proposal before giving any placement answer, and checks ESCAPE, A, LCTL, LEFT and Navigation access in both initial and final layouts. It also requires final completion and at most three questions before Apply, so applying cannot hide a fourth unanswered question. No paid evaluation was run for these review fixes.

A copied-config result card omits the outside-chat proposal count when its presentation identifies a target conversation. The actual proposal remains in that chat; direct `keyboard put` and ordinary `create_config` cards retain their counts. A static React render regression checks this distinction. This is component evidence, not browser or screenshot verification.
