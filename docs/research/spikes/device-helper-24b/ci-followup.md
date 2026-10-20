# Native CI follow-up: Linux linker and Intel lifetime observation

2026-10-20, starting from candidate `125d001e141a107d477a4379d54cbad381e8f6c8`. This follow-up is **not a green verification report**. Native Linux and Intel CI must pass the updated candidate before merge.

## Observed native failures

CI [run 39468759658](https://github.com/planetaryescape/keyloom/actions/runs/39468759658) observed:

- Linux [job 118786966009](https://github.com/planetaryescape/keyloom/actions/runs/39468759658/job/118786966009): Ubuntu 22.04.5, musl-tools 1.2.2-4, Rust 1.99.1. Format/check/clippy compiled, but the musl test executable received SIGSEGV before printing any test result.
- Intel macOS [job 118786966074](https://github.com/planetaryescape/keyloom/actions/runs/39468759658/job/118786966074): 23 passes, one skip, one failure. Only the combined idle/blocked-stdout test exceeded its existing exit deadline (11.55 s total: idle half followed by the 6.5-s blocked half). Other child-contract/parent-death cases passed. The log establishes a missing Bun exit notification within the deadline, not whether the OS process was still alive.

The orchestrator preserved original logs in its read-only run directory. No source, device or credential access was needed to inspect them.

## Linux discriminator and correction

The isolated Docker probe uses Ubuntu image `sha256:0a9887931b0e38af2e3487ed39e29436b0535c4f3f52e57745baaf79d1898956`, `--platform linux/amd64`, on a Linux aarch64 Docker VM. **This is emulated supplemental evidence, not native x64 certification.** The worktree is mounted read-only; only `dist/linux-probe` is writable. No host home, secrets, Docker socket or physical device is mounted.

A one-line Rust main with no dependencies reproduced exit 139 before its first println. The three controlled builds used the same Rust 1.99.1, source and musl target:

| Link selection | ELF / execution |
|---|---|
| `musl-gcc` | Has INTERP `/lib/ld-musl-x86_64.so.1`; exit 139 |
| `musl-gcc` plus explicit `+crt-static` | Same interpreter and exit 139; Rust cfg already includes crt-static |
| `rust-lld` plus the same `+crt-static` | Static PIE, no INTERP; println reached, exit 0 |

Verbose linking shows Rust supplied `-static-pie`, but Ubuntu's musl-gcc specs supplied a dynamic interpreter to collect2. See [comparison output](ci-followup/compare.txt), [musl-gcc link arguments](ci-followup/link-explicit-static.txt) and [bundled-linker output](ci-followup/link-bundled-linker.txt). GDB could not read registers through the emulator; that failed attempt is preserved in [the first probe](ci-followup/run.txt), not presented as a native backtrace.

The correction pins `rust-lld` for only `x86_64-unknown-linux-musl` in the crate's `.cargo/config.toml`, and removes CI/release environment overrides to musl-gcc. The pinned Rust toolchain supplies its self-contained musl CRT/linker; no system musl-tools installation is needed. The GNU Bun host, client deadlines and protocol are unchanged. Existing ELF-interpreter rejection stays in CI/release.

With only that checked-in configuration, locked Cargo fmt/check/clippy and all four Rust tests passed; the release helper is static PIE without an interpreter and `--version` exits 0 ([probe output](ci-followup/verify.txt)). Five real Bun 1.3.14/Rust child-contract tests passed, including blocked output and parent death. The complete synthetic suite had one timeout in eight concurrent **Bun** fixture children under the two-CPU emulation cap (other synthetic child cases took about 0.6 s each); the unchanged two-second budget remains enforced and this failed run is preserved, not waived.

A separate follow-through exercised the real Rust child tests, compiled the existing GNU Bun Linux CLI with the static helper, installed through the real `install.sh` file mirror outside the source tree, and passed eight concurrent doctors, corruption refusal and import/layout after failure. The batch took 7.98 s under emulation; each admitted helper exchange still used the unchanged two-second budget. See [installed Linux output](ci-followup/finish.txt). Helper SHA-256: `6fbf81b0407568a675a97d0cb71d0b73b05e2fdb11ad502caa58b8774429f862`.

## Intel: observe before changing lifetime behavior

The preinstalled macOS Rosetta runtime allowed pinned x64 Bun/Rust execution without installing OS support. The exact failing idle/blocked test passed once in 10.49 s ([output](ci-followup/macos-x64-rosetta.txt)); Bun warned about absent AVX in this emulated environment. That single supplemental pass neither reproduces nor dismisses the native Intel failure.

The next native data wave adds only deadline observations to the test: PID probe error/presence, `ps` process state, Bun exit/signal fields and the unchanged budget, captured **before** kill, stream drain or cancellation. This distinguishes a live/stuck helper, a zombie or gone process, and an unread-pipe exit-notification delay. The Unix `ps` probe is bounded; Windows does not invoke it. Rust's exit implementation has not been changed on an unverified deadlock hypothesis.

CI repeats only the Intel idle/blocked test five times under its existing bounds, including after an initial child-contract failure. Any repetition failure still fails the job. No timeout was increased and no failed assertion was removed. Native Intel diagnosis remains blocked until those observations arrive.

## Resources and verification boundary

Owned queues: 9406 first Linux probe, 9407 linker comparison, 9408 locked crate/full synthetic probe, 9409 Rosetta, 9410 installed Linux follow-through. Each returned; all containers used the registered name `keyloom-device-24b-linux-probe` and `--rm`. Generated Linux probe data is 1.3 GiB, Rosetta probe data 91 MiB and the shared native target 118 MiB; within the existing worker budget. Container scratch `/tmp/keyloom-device-installed-h34l2D` and native parent-death scratch `/tmp/keyloom-test-NlPaX7` were removed by their own fixtures. No port or physical device was used. Retain the Ubuntu image and generated probes until evidence/review are preserved; image sharing is not assumed safe for deletion.

Typecheck, actionlint, diff whitespace checks and diff-scoped anti-slop pass for the focused change. The earlier full application suite is historical evidence, not a substitute for the required updated native CI. No push/merge/release was performed by this worker.
