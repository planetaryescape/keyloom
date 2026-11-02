# Contextual proposal recovery: source proof

Source implementation: `3469a79c4d982c1fb1435b21bf0c3661d5c8144d`, tree `4ebcd82bf9c9c1a5bfcba94c845c9a0f4a43d6c6`, on base `14312ecda7d960546474514121336a716e80e67d`. The following evidence-only commit adds this receipt and captures; it changes no implementation. This is a source candidate, not a shipped release.

## Reproduce

In two terminals, with a disposable evidence directory:

```sh
bun test/web/proposal-recovery-server.ts <evidence-directory>
bun test/web/proposal-recovery.browser.ts <evidence-directory>
```

The fixture runs the real App, SQLite persistence, production editor/chat routes and the Anthropic SDK tool runner against a deterministic fake provider. It listens only on assigned localhost port 4531. It starts no sync engine, device discovery, firmware build or paid model call. Configs and goals are synthetic; the imported layout is the public synchronized Oryx fixture.

## What passed

- A real missing-target `propose_changes` reached the validator, saved no proposal, and was read back from the stored presentation. The browser showed the refusal without a fabricated ProposalCard. It explained `unknown_ref` without inventing an exact rejected target.
- A real agent proposal retained its distinctive original request despite a later unrelated message. A validated conflicting editor edit advanced its head; actual Apply returned `stale_base`.
- In both journeys, Plan made no agent POST. Explicit Send read the current layout and saved a validated F17 replacement. API reads proved preview left the persisted revision unchanged. Explicit Apply changed position 33; position 36 was unchanged. See [persisted journeys](persisted-journeys.json).
- Mounted checks covered edited Home retention, config isolation, occupied composer and pending-request preservation, overlong-request blocking, explicit HTTP send refusal, synchronous double activation, delayed old-source-read ownership, ambiguous accepted POST without Home replay, active-work recovery without cancellation, deliberate Stop without replay, and changed-head refusal with the goal kept. The HTTP refusal checks are lifecycle checks, not the evidence of domain validation refusal. See [journey receipt](journey-receipt.json).
- Source CLI human and JSON draft invocations left counts of heads/revisions, proposals, conversations and runs unchanged. See [read-only receipt](cli-read-only.json), [human output](cli-draft-table.txt) and [JSON output](cli-draft-json.txt). Focused tests also exercise explicit CLI replan with a fake provider and reject mixed, missing, foreign, unsupported and overlong sources before writes.

## Visual inspection

Captures use 1440×900 and 390×844, actual light/dark media and theme settings, with reduced motion. Four states are captured in each: `unsaved-refusal`, `refusal-request`, `replacement-preview`, and `blocked-long-request`. Separate `request-send-reachable` captures and [scroll measurements](scroll-proof.json) show that the long request can scroll to a visible, enabled Send button in both sizes/themes. The controls reuse existing tokens and native buttons/disclosures; no JSON GUI, emoji icon, stripe or sparkle was added.

The phone refusal capture starts partway through the chat log, with the recorded-target limitation and Plan visible. The request panel is independently scrollable; its initial viewport need not show Send until scrolled. Browser captures do not establish native-wrapper, installed-release or hardware behavior.

## Checks and limits

Focused tests: 6 passed, 36 assertions. Typecheck and dependency-cruiser passed. React Doctor reported one warning on the existing `drafts = []` default at the touched ChatPanel signature; the earlier new index-key warning was fixed. Three changed-line anti-slop warnings concern optional-property spreads that follow the adjacent repository pattern; no suppression or dependency/config change was added. Diff whitespace check passed.

The first full default suite was killed by the 180-second harness timeout (queue task 696), without a summary. The unchanged rerun (task 698) completed in 311.56 seconds: **3681 passed, 243 skipped, 1 failed**, 150615 assertions across 404 files. The failure was `test/firmware/zmk/flash.test.ts:100`: the synthetic drive observer read an empty byte array instead of its fixture artifact. Its narrow rerun passed all 24 tests / 75 assertions in 4.15 seconds. That test and the flashing implementation are unchanged by this candidate. The full suite is **not green**; the isolated pass does not erase the failure. No further full-suite retry or flashing-code edit was made. See [check summary](checks.json).

Remaining proof limits: no native interaction, installed-consumer run, physical typing outcome, independent model review or release gate was performed by this worker. Those belong to the coordinator. Question-answer lineage is labelled as an answer to its recorded question rather than presented as a standalone typed request; a dedicated mounted question-answer recovery journey, a full keyboard-only journey and an in-flight proposal-source deletion were not run.

## Review notes

Inline TypeScript review checked the local discriminated recovery source, API-derived conversation values, source/config identity, maximum request length and async lock ownership. No wire schema, persistence migration, validator authority or `useChat` replay transport changed. Simplification extracted the Viewer freshness branch and reused the existing formatter, human labels, App-owned draft and saved-chat transport. No independent send pipeline was introduced.

Test-quality self-check: the resolver tests assert real domain rejection and unchanged persisted state, not just text snapshots. They catch partial/generic/truncated evidence, prototype-like unknown categories, disjoint old bases, wrong source/config and overlong wrapping. The browser checks use actual routes and state reads; screenshots alone are not treated as persistence evidence. New unit tests do not yet cover every question-answer lineage shape or automatic-review freshness case.

Harness lessons: wait for network readiness before opening Chat/history; use separate React turns for menu opening and selection; reopen Chat after Apply; reselect the same config after Home rather than assuming the wall selected it; viewport changes may remount Chat, so reopen the source conversation before capturing it. Failed attempts were retained in worker evidence, not counted as passes.
