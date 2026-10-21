# Checkout and mounted-file tests fail intermittently in the queued full suite

Full `bun test` runs through `agent-work` on 2026-10-21 failed a different handful of tests each time. None of the failing tests touch the code that changed. Each failing file passes when run alone (3 of 3 runs).

- `test/firmware/toolchain/checkout.test.ts`, `ensureCheckout`: `git submodule update failed (exit 1): fatal: transport 'file' not allowed`. The fixture allows the file protocol through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` in `test/helpers/git-fixture.ts:8`. Neither global nor system git config sets `protocol.file.allow`, so the error means those environment variables did not reach the `git` child in that run.
- `test/firmware/toolchain/mounted-files.test.ts`, `awaitMountedFiles`: `Docker still sees an old or missing copy … after 0 s`, at 213 ms.
- `test/validation/fixture.test.ts`, the validate/apply property test, and on another run `buildZmk (fake docker)`: hit their 5 s and 12 s limits while the suite took 442–497 s, against about 220 s normally.

Observed on the PR 145 heads `0f20ab1` and `f0e85dc`, while other agents' jobs shared the machine. CI's full suite passed on the same heads.

## What would settle it

Run the queued suite with the environment printed in the failing `git` child, to see whether another test file overwrote or cleared the `GIT_CONFIG_*` variables in the shared Bun process. Check whether `awaitMountedFiles`'s settle window reads a clock that a fake can stall. If a test mutates `process.env` without restoring it, scope that change to the child it spawns.

Not fixed: recorded during the 24d slice 2 review. The cause has not been diagnosed.
