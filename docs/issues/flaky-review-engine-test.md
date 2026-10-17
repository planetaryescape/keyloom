# The review engine's "keyboard shows up" test flakes under load

`test/app/review-engine.test.ts` failed once in a full `bun test` run on two separate branches on 2026-10-17 (`fix/add-keyboard-gaps` and `fix/review-engine`), both times under full-suite load, and passed alone and on every rerun. One failure saw an `import` review where the test expected an empty list, so the likely cause is the engine's 3-second quiet timer for imports racing the test's own connect step.

Not yet investigated. Next step: run the file 30 times under four busy CPU loops, capture the failing assertion, then have the test wait on the engine's own events instead of time, as the flash and sync tests were fixed in `4b82bb1` and `3f8e684`.
