# Deterministic workload evaluator

The workload evaluator implements [D-470](../blueprint/14-decision-log.md#deterministic-workload-evaluation-2026-11-01). It tests named activities against the existing config rather than prescribing a replacement layout. This record separates implementation checks from real-firmware and hardware evidence.

## Design evidence

The research compared existing keyloom validation, the typing lab and real-core emulators with external layout analyzers and typing research. These sources informed the implementation boundaries:

- [Keyboard Layout Optimizer](https://github.com/dariogoetz/keyboard_layout_optimizer) separates statistical evaluation from optimization and supports layer/modifier costs. Statistical expansion is not proof that a timed physical route executes correctly.
- [Oxeylyzer](https://github.com/o-x-e-y/oxeylyzer) provides useful character-transition metrics. Those measures describe the chosen corpus and fingering assumptions, not all of a programmable config's behavior.
- [The keystroke-level model](https://doi.org/10.1145/358886.358895) predicts practiced execution of a specified method. A searched route is not evidence that a person uses it or has learned it.
- [The 136-million-keystroke study](https://userinterfaces.aalto.fi/136Mkeystrokes) observes overlapping presses and skill-dependent transitions. Counting keydowns alone does not justify a typing-time prediction.
- [VS Code editing behavior](https://code.visualstudio.com/docs/editing/codebasics) includes configurable pairing, completion and snippets. Source-code transcription must not be described as a recording of programming activity.

V1 therefore uses explicit US-layout tasks, deterministic candidate routes and independent HID-output matching. It reports costs separately and retains unsupported tasks in coverage. It does not copy code or corpora from those projects.

## Verification boundaries

- Unit and app/CLI tests can inject independently specified firmware reports. They test planning, accounting, matching and comparison, not firmware fidelity.
- Gated Docker tests run the generated candidate through the existing QMK/ZMK cores. Passing them would establish emulator behavior for the tested configurations, not physical scan, debounce, USB, comfort or human performance.
- A compiled CLI smoke uses synthetic configs and a scratch data directory. It must not start a server, sync, read a device or call a model.
- No hardware access or flash is authorized for this implementation.

## Local execution record

Initial environment discovery on 2026-11-01 found the Docker CLI installed but both configured daemon endpoints unavailable. Colima reported a running VM while its runtime-status query failed and SSH reset the connection. The runtime was left untouched during discovery; BK's later restart authorization and the resulting checks are recorded below.

### Candidate checks (2026-11-01)

These pre-release checks exercised the source candidate based on `a39b7ae0f06348f0ca25f6574574290f623d3608`, before its first commit or publication.

| Check | Observed result |
|---|---|
| `bun test` | 3,487 passed, 233 skipped, 0 failed; 136,822 assertions across 377 files; 261.05 s |
| `bun test test/lab/workload test/app/workload.test.ts test/cli/workload.test.ts` | 28 passed, 2 gated real-core cases skipped, 0 failed; 154 assertions |
| Existing QMK/ZMK emulator parser/harness tests | 32 passed, 0 failed |
| `bun run typecheck` | Passed |
| `bun run depcruise` | Passed; the existing TypeScript-7 compatibility warning remains |
| `git diff --check` | Passed |

After BK explicitly authorized a Colima restart, `colima stop` and `colima start` restored the daemon. Both targeted real-core commands then passed through the shared queue:

```sh
agent-work run -- env KEYLOOM_DOCKER_TESTS=qmk bun test test/lab/workload/real-core.docker.test.ts
agent-work run -- env KEYLOOM_DOCKER_TESTS=zmk bun test test/lab/workload/real-core.docker.test.ts
```

The QMK test verified layered `see` on the Moonlander: 4 physical keydowns, one layer entry, peak two keys, and exact `S`, `E`, `E` reports. The first ZMK check verified direct `e` on the Glove80; its fixture was then strengthened to test the same layered `see` workload across both boards and passed again (5.46 s). These are native firmware-core simulations, not physical keyboard tests.

The compiled candidate was installed under a run-owned `installed/keyloom` path and exercised against a scratch database containing an original synthetic Moonlander config. It verified both `see` and `{}` through the real core. Two evaluations produced byte-identical JSON. Comparing a patch that adds a direct `e` reduced the letter task from 4 to 3 keydowns without changing the brace task's 4 keydowns / peak three keys. The result was `verified-improvement`; the layout document and stored revision were identical before and after. Evaluation took 25.835 s and 30.033 s; comparison took 45.408 s. These include build/replay overhead, not modeled human typing time.

The compiled `shortcuts` suite also verified exact Control-C (2 physical keydowns) and Command-Shift-P (3) from real-core reports. Navigation had no route in this synthetic config and remained in coverage: 2 of 3 tasks / 2 of 4 requested outputs were verified. The test did not claim that an application copied text or opened a palette.

The independent Claude review did not start: its API returned `usage_limit_reached` before consuming input tokens. BK explicitly waived that second-provider review for this slice. Orchestrator whole-diff review, tests and runtime checks remain the evidence; no cross-provider review is claimed.

These receipts establish local pre-release behavior, not publication. Published availability is recorded in the [release history](https://github.com/planetaryescape/keyloom/releases). No real keyboard was opened, recorded, restarted or flashed.
