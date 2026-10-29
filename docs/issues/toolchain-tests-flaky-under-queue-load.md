# Checkout and mounted-file tests fail intermittently in the queued full suite

Full `bun test` runs through `agent-work` on 2026-10-21 failed a different handful of tests each time. None of the failing tests touch the code that changed. Each failing file passes when run alone (3 of 3 runs).

- `test/firmware/toolchain/checkout.test.ts`, `ensureCheckout`: `git submodule update failed (exit 1): fatal: transport 'file' not allowed`. The fixture allows the file protocol through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` in `test/helpers/git-fixture.ts:8`. Neither global nor system git config sets `protocol.file.allow`. The original report inferred that those environment variables did not reach the `git` child; it did not capture the child's environment.
- `test/firmware/toolchain/mounted-files.test.ts`, `awaitMountedFiles`: `Docker still sees an old or missing copy … after 0 s`, at 213 ms.
- `test/validation/fixture.test.ts`, the validate/apply property test, and on another run `buildZmk (fake docker)`: hit their 5 s and 12 s limits while the suite took 442–497 s, against about 220 s normally.

Observed on the PR 145 heads `0f20ab1` and `f0e85dc`, while other agents' jobs shared the machine. CI's full suite passed on the same heads.

## What would settle it

Run the queued suite with the environment printed in the failing `git` child, to see whether another test file overwrote or cleared the `GIT_CONFIG_*` variables in the shared Bun process. Check whether `awaitMountedFiles`'s settle window reads a clock that a fake can stall. If a test mutates `process.env` without restoring it, scope that change to the child it spawns.

Status: the Git cascade is fixed in `e894e6d` (PR 201) (cause under "A timed-out test left a fake git on PATH"). The mounted-file timing failure is fixed in 582b511 (PR 174), released in v0.54.0. The slow individual tests that start the cascade still time out under heavy load; they now fail alone.
The successful-retry fixture now allows 3 s for its subprocess probes, with a regression that failed against its old 200 ms budget. A preload guard fails and restores leaked `GIT_CONFIG_*` and `FAKE_*` values; the original Git failure has not reproduced here.

## The 200 ms fixture expires before a slow fourth probe

Investigation base: `545f1f481d4868e917ab04e7e4150fc6e91e3d29`, branch `test/flaky-under-load`, Bun 1.3.14, macOS arm64. `git fetch origin main` failed with `Permission denied (publickey)`; no claim about a newer remote head is made.

```sh
bun test test/firmware/toolchain/mounted-files.test.ts
```

With the new regression and the old fixture budget, adding 80 ms to each fake Docker probe produced:

```text
(fail) awaitMountedFiles > slow probes still get enough time to retry a view that settles [223.65ms]
BuildFailure: Docker still sees an old or missing copy of a/default.nix, b.conf after 0 s
4 pass
1 fail
```

`src/firmware/toolchain/mounted-files.ts:41–67` starts a `Date.now()` deadline after hashing the host files and checks elapsed time after every unsuccessful child. It sleeps with `Bun.sleep`. The test requires three stale probes followed by a successful fourth probe, but formerly gave that sequence only 200 ms. The error rounds that budget to seconds, hence "after 0 s". Searches of `test/` and `evals/` found no replacement of these clocks or timers.

The successful-retry fixture now allows 3,000 ms. The never-settles case explicitly uses 50 ms and still proves refusal and the recovery message. The production 30,000 ms settle window is unchanged. The regression passes with the new fixture budget.

## Loaded runs did not reproduce the missing Git configuration

Run the affected files together with bounded CPU load:

```sh
python3 - <<'PY'
import subprocess
files = [
    'test/firmware/toolchain/checkout.test.ts',
    'test/firmware/toolchain/mounted-files.test.ts',
    'test/firmware/zmk/build.test.ts',
    'test/validation/fixture.test.ts',
    'test/app/doctor-dfu.test.ts',
]
load = [subprocess.Popen(['/usr/bin/yes'], stdout=subprocess.DEVNULL) for _ in range(24)]
try:
    subprocess.run(['bun', 'test', *files], check=True, timeout=120)
finally:
    for child in load:
        child.terminate()
    for child in load:
        child.wait()
PY
```

Before the fix, five `yes` processes gave **34 pass, 0 fail, 13.84 s**; 24 gave **34 pass, 0 fail, 15.18 s**. These were targeted single-process runs, not the complete suite. The worker brief reserves the full suite for the orchestrator.

In the five-worker run, temporary instrumentation immediately before `Bun.spawn` in `src/firmware/toolchain/run.ts` printed only Git arguments and the three relevant variables. Both `submodule update` invocations printed:

```json
{"GIT_CONFIG_COUNT":"1","GIT_CONFIG_KEY_0":"protocol.file.allow","GIT_CONFIG_VALUE_0":"always"}
```

The commands succeeded. This records the environment passed at the spawn boundary, not a failing child's environment. The instrumentation was removed.

## The audit found restoration, not an unscoped Git assignment

At the investigation base:

| Mutation site | Scope and restoration |
| --- | --- |
| `test/helpers/git-fixture.ts:5–15` | `GIT_ENV` is spread into the child's explicit environment. It never assigns `process.env`. |
| `test/helpers/fake-bin.ts:23–35` | `withPath` saves PATH and every supplied variable, then restores or deletes each in `finally`. Checkout tests supply `gitEnv` through this scope. |
| `test/app/doctor-dfu.test.ts:9–10,19–33` | PATH is restored in `afterEach`. |
| `test/agent/codex.test.ts:137–180` | Both synthetic credential assignments are restored or deleted in `finally`. |
| `test/persistence/persistence.test.ts:168–180` | `XDG_DATA_HOME` is restored in `finally`. |
| `test/helpers/no-credentials.ts:7–19` | Credentials and `KEYLOOM_CODEX_BIN` are restored in `finally`. |
| `test/helpers/no-real-flash.ts:34`, `isolate-data-dir.ts:7`, `no-paid-model.ts:6–7` | Intentional test-process safety defaults: refusing executables, scratch data and disabled paid providers. |
| `test/helpers/demo-sync.ts:57–61,150–153` | Process-lifetime settings for a standalone demo server, including its repeating control-file callback. No test imports the script; it requires three command-line arguments before setup. It is not loaded by `bun test`. |

No test or helper replacing `process.env` was found. `checkout.ts` passes each Git command to `run.ts`, which synchronously constructs `{ ...process.env, ...opts.env }` at each spawn. There is no checkout-level saved environment. Overlapping process-global scopes or late cleanup after a timed-out test remain unproved explanations for the historical failure.

`test/helpers/guard-toolchain-env.ts` now compares guarded variables against the process baseline before/after tests and after teardown. A difference is restored and fails the run with the variable names. Its subprocess regression proves detection of additions, changed values, deletions and an `afterAll` leak, and proves that subsequent tests see the restored values. Other regressions prove child-only Git configuration and `withPath` restoration after success, rejection and nested scopes.

The property test keeps all 400 cases with a 15 s limit. The fake ZMK build file allows 30 s for its Git/hash subprocesses. Its explicit 400 ms build timeout and 10 s elapsed-time assertion remain. Neither historical outer test timeout reproduced in the loaded runs; these allowances follow the recorded full-run failures and do not establish their cause.

## The guard and the new limits hold in a full run

With the preload guard, the 3 s mounted-files budget and the larger property and fake-build limits, the full suite on branch `test/flaky-under-load` passed 2,922 tests with 0 failures and no leaked-environment reports (2026-10-22, run through `agent-work` while other agents' Cargo jobs shared the machine).

## Another test that fails only under load

`test/app/firmware-drivers.test.ts`, "ZMK driver > a west flash writes each half's UF2 from the bundle", failed once in a full `bun test test/app` run on branch `fix/doctor-permission-match` (2026-10-22, 455 pass, 1 fail), and passed 3 of 3 runs alone. The run didn't capture the assertion that failed. It stays open with the Git failure until it reproduces with its output.

On 2026-10-22, on branch `fix/locked-mac-flash`, a loaded run of `test/firmware/zmk test/firmware/toolchain` and two app files (511 tests, 140 s) also timed out at Bun's 5 s default in `test/firmware/zmk/module-c.test.ts` ("the serial number the module writes > a peripheral writes R, a central writes L…") and `test/firmware/toolchain/checkout.test.ts` ("ensureCheckout > a submodule that has not been fetched is fetched on the next use"). Neither file is touched by that branch. Both files now allow 30 s per test, as `test/firmware/zmk/build.test.ts` does (branch `fix/stage-shadow-and-flaky-limits`). Each runs a compiler or Git several times per test; alone, all 16 tests take 3.4 s.


## A timed-out test left a fake git on PATH

On 2026-10-28/29, full `bun test` runs through `agent-work` (logs V3-full-final, V4-full-final, A2r4-full-orch) timed out one toolchain test at 5 s, the guard reported "Test leaked toolchain environment: FAKE_DOCKER_LOG, FAKE_GIT_HEAD, …", and then 37 to 44 later tests failed on `git init --quiet -b main` with an empty stderr. Each failing file passed alone.

Reproduced at base `48c2f02` with three tests in one file: a `withPath(fakeGit, () => sleep(600), { FAKE_GIT_HEAD })` test with a 100 ms limit, a second `withPath` test, then `git init` through `test/helpers/git-fixture.ts`. In the failing `git init`, printed from the same process:

```text
which git -> /var/folders/…/keyloom-bin-BV5Pyp/git      (the fake from FAKE_GIT)
PATH      -> /var/folders/…/keyloom-bin-BV5Pyp:/var/folders/…/keyloom-no-flash-…:/Users/bhekanik/…
cwd       -> the repo root (unchanged)
```

`FAKE_GIT` does `shift 2` and `exit 9` for anything but `rev-parse` and `submodule`, so `git init` fails without printing anything. cwd was not the cause.

A timed-out test does not cancel its `withPath` callback. The next test's `withPath` saved a PATH that still held the first fake directory. When the straggler finished it restored the real PATH, and when the second scope finished it restored its stale snapshot, with the fake directory in it, for the rest of the process. The old guard restored `GIT_CONFIG_*` and `FAKE_*` but never looked at PATH.

Two changes: `withPath` (`test/helpers/fake-bin.ts`) now removes only its own PATH entry and returns each variable to the newest scope still active that sets it, or to its original value, so scopes can end in any order; and the preload guard resets PATH to its starting value before every test. Regressions in `test/firmware/toolchain/test-environment.test.ts` ("scopes that overlap…", "the preload starts each test with the baseline PATH…") both failed before the change.
