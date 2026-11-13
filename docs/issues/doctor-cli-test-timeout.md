# Doctor CLI tests timed out while their probes still ran

Status: fixed by merge commit `a69ba7c3403d1fdb28a5fd183ffa13e54ef115d4`. Observed on main `3499376af34d1c9348f9f6477df5d6a48a59efe6`, 2026-11-13.

Two CLI doctor tests timed out at five seconds during the design review's clean-main comparison. The environment guard then reported unrestored `FAKE_*` variables. The same cases failed on the UI candidate, whose relevant backend and test subtrees matched the baseline.

A trace on main reproduced both failures with the original budget. A second run kept the assertions and allowed 60 seconds for observation. Both cases passed in 13.19 seconds and 7.34 seconds. Across those cases, all 91 subprocesses exited and closed both output streams. The largest observed stream closure delay after exit was 1 ms. This run found cumulative work beyond the test budget, with no hanging output pipe.

The shared fake Docker also handled `info`, context, image, and disk probes as firmware builds. It printed compile output and attempted writes under `/.build`. Its invalid disk output made doctor try every candidate image. The stopped-daemon path also queried the host's real Colima.

The fix gives read-only Docker probes valid synthetic answers and supplies a fake Colima. The three subprocess-based doctor cases use the existing `SLOW_RUNNER_MS` budget. A CLI assertion checks the synthetic disk result. That assertion failed before the fixture fix and passed afterward. The two originally failing cases then passed in 3.44 seconds and 3.26 seconds. These observations are not a controlled performance comparison.

Run the affected doctor cases from the repository root:

```sh
agent-work run -- bun test test/cli/handsfree.test.ts test/cli/firmware.test.ts --test-name-pattern 'reports the running build|a missing zapp is a warning|reports Docker, its disk'
```

All three passed, with 22 assertions and no environment guard failures. TypeScript passed. The final patch removes diagnostic instrumentation. No production code changed. This fix does not establish the cause of separate Glove80 cancellation, Codex, or empty CLI-output failures.
