# S58/S62: installed diagnostics, not a native transport adoption

2026-10-20. Candidate based on `bd1a58652db0dbfa528e0e4fa68de173702a1e9e` (v0.45.0). That version identifies the test build, not a claim that the published v0.45.0 contains a helper. Runtime: Bun 1.3.14, Rust 1.99.1, native macOS 27.0.1 (26A434), arm64. During the initial local candidate checks, no keyboard was opened, captured, reset or flashed and no Docker/eval/model generation ran. Later synthetic debugging used Docker emulation, recorded in the [CI follow-up](device-helper-24b/ci-followup.md); it used no device access.

**Native CI follow-up:** `125d001` later failed Linux startup and the misleading Intel blocked-output test. Linux's linker correction passed native CI. Intel's [native clock proof and stronger OS-pipe regression oracle](device-helper-24b/ci-followup.md#native-clock-proof-and-final-oracle) supersede the original buffered-stream assumption. The final source still requires fresh full/native CI and whole-diff review; these earlier local results do not establish overall acceptance.

Public evidence uses `<repo>` for this worktree root and `<HOME>` for the local user home. The orchestrator retained unredacted originals in its private durable run archive before these prefix substitutions; test results and other transcript bytes are unchanged.

## Reproduce the installed check

```sh
agent-work run -- bun scripts/build-binaries.ts --target bun-darwin-arm64
bun scripts/smoke-device-helper.ts dist/keyloom-darwin-arm64
```

The smoke uses the actual `install.sh` against a local `file://` release mirror. It installs outside the repository, runs with only `/usr/bin:/bin` on PATH, and uses scratch HOME/cache/data. Rust and node_modules are not on the runtime path. It launches eight doctors against a cold cache with spaces/non-ASCII characters, checks the helper hash/identity, deliberately corrupts only that scratch executable, expects refusal, then imports the synthetic/public Oryx fixture and lists layouts successfully. It deletes its own generated installation afterward. The [raw output](device-helper-24b/installed-smoke.txt) records the manifest, duration and exact scratch path.

An isolated copy of the same diagnostics crate was built with synthetic release `0.0.0`, embedded into a host whose release remained `0.45.0`, and installed through the same script. Doctor refused `version_mismatch`; import/layout still passed. See [mismatch output](device-helper-24b/installed-mismatch.txt). No production runtime helper override was added to create this case.

Source/dev invocation warns `not_bundled`, starts no helper and searches no source build directory or PATH. Normal doctor adds the check without removing its other probes; `--device-helper-only` skips database/provider/Docker/USB/remapper checks. See [CLI reference](../../blueprint/10-cli.md#doctor-checks-the-installed-helper-without-opening-a-keyboard).

## S58: observations and retained risks

Transport files are unchanged from the source review baseline `7d3ca25981a5213b8aa9e90fcf3330d5272787fd` through the candidate base. These observations do not certify physical behavior.

| Observation | Evidence | Boundary / consequence |
|---|---|---|
| Linux one-shot writes omit the report-number byte required by hidraw | `test/firmware/toolchain/device-phase0.test.ts`; `hid-linux.ts:71–75`; independently constructed `[0, ...32-byte payload]` | Two synthetic files differ from the kernel contract. No Linux keyboard run or transport fix in 24b |
| Descriptor discovery accepts the vendor usage substring even when it is not a complete report descriptor | Same test; `hid-linux.ts:35` | Old discovery does not verify 32-byte report shape |
| One-shot Linux writes ignore `bytesWritten`; polled writes retry remaining tails | `hid-linux.ts:73`; `polled-file.ts:55–63` | Short-report/partial-write behavior needs a native adapter test, not copied golden output |
| Polled writes check the 200-ms budget only after EAGAIN | `polled-file.ts:57–63` | Zero-progress successful writes have no deadline check in this loop; not reproduced against a device |
| Read polling yields after 64 reads and stop closes once | `polled-file.ts:29–50` | Source behavior, not measured fairness or device-release evidence |
| macOS owns CF/IOKit handles, callbacks and run-loop pumping in Bun | `hid-macos.ts:142–181,198–207`; historical tagged-pointer issue in D-071 | No native ownership leaves TypeScript in this diagnostics rung |
| Serial capture configures/closes through stty before opening the polled descriptor | `serial.ts:58–70` | Actual baud/DTR/close ordering still requires authorized physical checks |
| ZMK line accumulation has no length bound; serial write/close remain synchronous | `zmk/typing-capture.ts:61–63`; `serial.ts:18–21` | Deferred migration/line-limit work, not silently changed here |
| Existing transport paths have no helper endpoint lease | The named HID/serial implementations and their seams | Busy/interprocess ownership is still an untested backend gate |

The two synthetic characterization tests passed ([raw output](device-helper-24b/phase0-tests.txt)). They intentionally characterize old behavior rather than endorse it. Physical timing, loss, permission, DTR, disconnect and stop/reopen behavior remain unobserved. No HID/serial crate was selected.

## S62: implemented and observed

The Rust binary compiles only JSON/stdio/thread/time code. It implements hello/ping/shutdown, advertises empty capabilities and refuses device methods. Rust and Bun consume the same adversarial request corpus; Bun mechanically compares the checked-in JSON schema and Rust checks its discriminators/limits. The canonical schema's `x-maxRequestId` documents the u64 bound that JSON Schema cannot express as a numeric string maximum.

| Check | Local result | Evidence |
|---|---|---|
| Bun embedded binary asset -> exact real file -> absolute launch | 133,184-byte `/usr/bin/true` proof exited 0 | [Embedding output](device-helper-24b/embedding-proof.txt) |
| Locked Cargo fmt/check/clippy/test | Pass, four Rust tests | [Cargo checks](device-helper-24b/cargo-checks.txt) |
| Native Bun/Rust child contract and adversarial client tests | Pass; see final count in raw output | [Native/synthetic checks](device-helper-24b/final-native-tests.txt) |
| Full Bun suite | 2723 pass, 213 gated skips, 0 fail; 2936 tests / 308 files, 159.86 s | [Full output](device-helper-24b/full-tests.txt) |
| Types / dependency rules / workflow syntax | Pass; dependency-cruiser retains its existing TS7 compatibility notice while using SWC | [Types](device-helper-24b/typecheck.txt), [dependencies](device-helper-24b/dependency-rules.txt), [actionlint](device-helper-24b/actionlint.txt) |
| Installed cold/concurrent extraction, corruption refusal, import afterward | Pass | [Installed output](device-helper-24b/installed-smoke.txt) |
| Installed mismatched release | Refused before any device API could exist; import still passed | [Mismatch output](device-helper-24b/installed-mismatch.txt) |
| Unix symlinks, modes, hash/release/target mismatch, valid existing 0755 general cache | Pass using synthetic temporary paths | [Synthetic output](device-helper-24b/synthetic-tests.txt) |
| Blueprint relative file links | Pass after report creation; checks file targets, not remote URLs or all heading anchors | [Output](device-helper-24b/link-check.txt), [checker](device-helper-24b/check-links.mjs) |

Native child tests cover parallel independent handshakes, fragmented/joined frames, unsupported device methods, malformed/oversized/invalid-UTF8 inputs, stale response IDs, changed release/capabilities, unexpected exit 0, late frames, non-exiting shutdown and bounded stderr. They observe child exit after termination rather than treating a kill request as completion. The original Bun-flooded stdout case did not prove backpressure; the final Rust integration test uses an actually unread OS pipe and covers both open and closed stderr, with stdin held open until observed child exit. Rust's watchdog keeps its five-second idle rule. Killing the Bun parent leaves no live helper after EOF/watchdog. Parent-death tests first verify that the OS can observe the live helper PID, avoiding a false pass from an unsupported probe.

The launcher has a dedicated absolute-path spawn boundary, empty child environment and private pipes, not `run.ts` (which inherits credentials, resolves PATH and logs unbounded lines). Stderr is discarded and capped; synthetic secret-like input is not echoed. Unix extraction checks ownership/modes/type/size/hash and rejects managed symlinks. An exclusive same-directory temporary file plus atomic no-replace hard link avoids replacement/publication races. This is integrity anchored in the installed host, not a sandbox against the same OS user.

### Failures found by the gates

1. The first smoke used an older compiled artifact that lacked the new reported hash; the smoke refused to accept that as a valid paired manifest. Rebuilding supplied the expected field.
2. Reusing one Cargo target cache for an isolated same-name mismatch crate left a stale `0.0.0` build-script release. The real installed smoke refused it ([failure](device-helper-24b/stale-build-refused.txt)). The native test now compares helper release against root `package.json`, not against the helper's own answer ([red test](device-helper-24b/version-regression-red.txt)). `build.rs` now declares the absolute package input via `CARGO_MANIFEST_DIR`. Repeating mismatch -> normal builds without clearing that shared cache restored `0.45.0` ([mismatch build](device-helper-24b/cache-reuse-mismatch.txt), [restored build](device-helper-24b/cache-reuse-restored.txt)); final native/installed checks passed.
3. The TypeScript schema's BigInt refinement threw on a text request ID instead of returning a parse refusal ([red test](device-helper-24b/id-regression-red.txt)). A format guard now precedes BigInt; the expanded shared corpus passes. Rust accepts equivalent JSON numeric `1.0` for version 1, matching the schema.

## Review and scope decisions

TypeScript review traced manifest/JSON boundaries, callers and lifecycle. It replaced the diagnostic optional-field bag with a discriminated success/failure union, removed an unused packaged-pair override parameter, and added the malformed-ID regression. There are no type assertions hiding untrusted input. Code-simplifier's reuse/altitude pass retained the dedicated launcher because the existing subprocess runner's environment/stdio/logging contract is incompatible. It preserved the parent CLI's existing Bun autoload defaults rather than changing unrelated configuration behavior.

Anti-slop reports one conditional optional-property spread in the new DoctorCheck construction ([output](device-helper-24b/anti-slop.txt)). This is the established pattern throughout that same file; 33 pre-existing findings are hidden/out of scope. It was retained under the skill's repository-convention rule, not suppressed. Inline test-quality review removed a handwritten semantic classifier that duplicated the Rust implementation: TS now checks the real envelope parser against literal fixture verdicts, while Rust checks actual protocol effects. Red tests above establish independent failure signals.

Documentation-refiner ran in refine mode, with code/CLI help/runtime output as truth. README, CLI reference, architecture, roadmap/spikes, D-426, chapters 31–33, desktop and kickoff/navigation now distinguish the built diagnostics subset from proposed native transports. No Obsidian note was changed. No UI changed, so screenshot/React gates are not applicable.

## Not observed / release gates

- Native Intel macOS, Linux and Windows jobs are configured, not executed locally. Linux uses a static musl helper inside the existing GNU Bun host and CI rejects an ELF interpreter; this avoids adding a new glibc/libudev runtime dependency. This local report does not prove Linux execution.
- Windows runs locked Cargo and real Bun child-contract CI only. Production extraction refuses Windows; private ACL/reparse/executable-locking and installed CLI work remain 24f. No Windows public release asset or app parity is claimed.
- Release CI signs the visible Rust executable before hashing/embedding using existing secrets; no local credential access occurred. Separate helper notarisation precedes embedding when credentials exist. Developer ID/notarised extraction through an installed desktop bundle is not established by local ad-hoc `codesign --verify`.
- The inherited Tauri config says macOS 12.0, while pinned Bun 1.3.14 documents 13+. Neither minimum OS is certified here. The helper's deployment target cannot lower Bun's runtime requirement.
- No device backend/session exists: native leases, lost device-write acknowledgements, capture sequencing/overflow, handle cycling, sustained streams and native hardware cancellation are not applicable to this diagnostic slice. They remain mandatory backend gates; no automatic replay/failover code was added.
- No physical transport CPU/RSS/latency comparison or reliability improvement is claimed. Installed startup timing is in the smoke output; artifact/resource sizes belong to the final candidate packet. Existing TS native ownership is unchanged.
- Publication, released installation, update/rollback and applicable desktop-chain acceptance are orchestrator-owned gates. Previous v0.45.0 remains rollback; there is no database migration.

## Resource packet and cleanup boundary

Worktree: `<repo>`, branch `feat/device-helper-diagnostics`. Final local measurements: worktree 1.1 GiB, sole Cargo target directory 98 MiB, `dist` 263 MiB, node_modules 192 MiB; below the 8-GiB worker budget. Native CLI is 70,133,474 bytes and helper 657,680 bytes. No server/port was allocated; no helper/installed-smoke process remained in the final process-table check.

Owned queue IDs: 9382-9390, 9393-9402 (not the intervening foreign jobs). Final Cargo gate was 9400, final build 9402, single full suite 9390. All returned; raw build/check logs identify the relevant IDs. No queue cancellation or foreign process cleanup was performed.

The retained initial manual scratch installation is `/tmp/keyloom-device-24b-installed.hVrYE5`; it contains generated binaries/cache only, has no active child and can be removed after this evidence is preserved. Automated installed scratch directories under the macOS temporary root were `keyloom-device-installed-3rwUo1`, `-Gx2Cix`, `-0YMXuH`, `-OfHsqB`, `-bFig6M`, `-AtIx7A` and final `-uQGmxG`; the script removed each in its own finally block. Native parent-death probe `/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/keyloom-test-lLjit4` owned parent PID 43875/helper PID 43876; the raw test observes helper exit, and the fixture removes its directory after the file. Other synthetic fixture directories are owned/removed by `test/helpers/tmp.ts`.

Keep the worktree, native target and isolated mismatch prototype under ignored `dist` until exact-SHA review/release evidence is preserved. The orchestrator owns removal after idle/clean/reachability checks; preserve the branch and foreign `TODO.md`. No source is stored only in a temporary directory. Raw transcript whitespace is preserved using a folder-local `.gitattributes` exception, not altered to satisfy diff checks.

## Primary sources

- [Linux hidraw write framing](https://docs.kernel.org/hid/hidraw.html)
- [Pinned Bun embedding documentation](https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/docs/bundler/executables.mdx#L669-L704)
- [Pinned Bun installation/runtime requirements](https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/docs/installation.mdx)
- [GitHub native runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Apple notarisation requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
