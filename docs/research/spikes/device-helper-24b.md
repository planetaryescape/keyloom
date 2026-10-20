# S58/S62: installed diagnostics, not a native transport adoption

Initial local candidate, 2026-10-20, based on `bd1a58652db0dbfa528e0e4fa68de173702a1e9e` (v0.45.0). That version identifies the test build, not a claim that the published v0.45.0 contains a helper. Runtime: Bun 1.3.14, Rust 1.99.1, native macOS 27.0.1 (26A434), arm64. During the initial local candidate checks, no keyboard was opened, captured, reset or flashed and no Docker/eval/model generation ran. Later synthetic debugging used Docker emulation, recorded in the [CI follow-up](device-helper-24b/ci-followup.md); it used no device access.

**Native CI follow-up:** `125d001` later failed Linux startup and the misleading Intel blocked-output test. Linux's linker correction passed native CI. Intel's [native clock proof and stronger OS-pipe regression oracle](device-helper-24b/ci-followup.md#native-clock-proof-and-final-oracle) supersede the original buffered-stream assumption. Those development gates later passed on reviewed tree `49ce7bde8bdf9aec03050dbc2b4c01530cf02f04`, merged in PR 136. The [release-proof section](#published-release-proof) separates that source acceptance from verified published CLI and desktop-sidecar receipts.

Public evidence uses `<repo>` for this worktree root and `<HOME>` for the local user home. The orchestrator retained unredacted originals in its private durable run archive before these prefix substitutions; test results and other transcript bytes are unchanged.

## Published release proof

Source acceptance is confirmed: PR 136 merged as `316f4bec7fc9e0e7283b7d85fba94fa03fbe48fd` with reviewed tree `49ce7bde8bdf9aec03050dbc2b4c01530cf02f04`. Exact-head full suites, [native CI](https://github.com/planetaryescape/keyloom/actions/runs/39479943823) and fresh independent whole-diff review passed. This does not by itself verify a published download.

Release-please PR 137 merged as `1430414e7cee69ed97d16398ef720167a21edeb5` for v0.46.0 after its dispatched CI passed. [Release build 39482403055](https://github.com/planetaryescape/keyloom/actions/runs/39482403055) failed during Intel helper signing and was canceled without publishing release assets. Interleaved stdout/stderr did not establish which command emitted the keychain error. The existing v0.45.0 desktop had signed and notarised successfully using the same credentials. The helper script omitted a documented codesign prerequisite: its temporary keychain must be on the user's search list even with `--keychain`. The healthy default download was restored to v0.45.0 without changing tags or assets.

PR 138 merged the signing correction as `3142d77bebb80064944367a192efe73146c3e586`, tree `d2cde5c44e3097df59b391697d798c4d097190aa`: register the CI keychain, restore the original search list on exit, and add constant stage markers plus credential-free OS-command regressions. Exact-head full suites passed (2725 pass, 213 gated skips, 0 fail) and [native CI](https://github.com/planetaryescape/keyloom/actions/runs/39484818658) passed. Gemini returned no verdict after a headless file-read permission denial; BK explicitly waived that signing-patch review. This is a waiver, not an independent review pass.

PR 138 also fixed an inherited test-only flake: [main-merge CI](https://github.com/planetaryescape/keyloom/actions/runs/39481797351/job/118831962930) returned the same two synthetic Linux HID records in opposite directory-enumeration order. The oracle now requires both exact records and length two; IDs, serial, handles and exclusion checks remain, and production HID code is unchanged.

The [trusted-main two-Mac signing preflight](https://github.com/planetaryescape/keyloom/actions/runs/39502381771) passed on arm64 and Intel: actual Developer ID authority, accepted notarisation, compiled paired CLI, real installer, eight cold concurrent doctors, empty capabilities, corruption refusal and import afterward. These are preflight v0.46.0 artifacts, not a published v0.46.1 installation. Release-please PR 139 subsequently produced [v0.46.1](https://github.com/planetaryescape/keyloom/releases/tag/v0.46.1), tagged at `6c24b623fa01b2bf610a1d76fc965cc147ff55e3`, tree `a02200ca988b0b05114607a1a2d9b388e20c30ec`. The [release workflow](https://github.com/planetaryescape/keyloom/actions/runs/39502908333) passed all three native builds, CLI publication and desktop publication. [Main CI](https://github.com/planetaryescape/keyloom/actions/runs/39502908456) passed. The latest-release API reports v0.46.1 with nine assets. Published CLI and desktop-sidecar verification passed.

| Published receipt | State |
|---|---|
| Release asset checksums | All three official CLI downloads match the published [SHA256SUMS](https://github.com/planetaryescape/keyloom/releases/download/v0.46.1/SHA256SUMS) |
| Installed CLI host/helper pair | Real GitHub installer to scratch, version/table/JSON doctor passed on macOS arm64: host/helper 0.46.1, protocol 1, capabilities `[]` |
| Extracted macOS helper signature | Strict codesign verification and online `--check-notarization` passed on the extracted arm64 helper |
| Published desktop bundle and sidecar | Official arm64 `.app.zip` checksum matched; deep/strict app signature passed, Gatekeeper accepted `Notarized Developer ID`, and bundled `Contents/MacOS/keyloom` version/doctor passed under isolated scratch HOME/PATH/data outside the repo |
| Update / rollback / re-upgrade | v0.46.1 installation, v0.45.0 reading the same scratch layout database, then v0.46.1 paired doctor passed |

Downloaded CLI SHA-256 values:

```text
5e27daaf302852a7b720f8f2cbb0451b42543d12e4105c4cb51fa072a3f78a25  keyloom-darwin-arm64
84dcfe023c78dbec3f4e50250b3ea12da6dd8c53e6498ee81247406bced94c37  keyloom-darwin-x64
21a32afc625d3540ca50584ccd2f797fc36aa5c92fd1c155b30bf85a9a1f50ec  keyloom-linux-x64
```

The extracted published arm64 helper is `35ebcb442c99a7528016c37589df1a58f7996e812cd7c170daeece01a61215bc`. The exact downloaded CLI bytes also passed eight cold concurrent doctors (316.83 ms), deliberate corruption refusal (`integrity_error`) and import afterward, without Rust/node_modules on the runtime PATH. Standalone `spctl --type execute` reports valid code but not an app; that app-only assessment is inapplicable, not an unsigned waiver. The actual online Apple notarisation-ticket check passed.

The published desktop sidecar returned the same v0.46.1 host/helper identity and arm64 helper hash above, with empty capabilities and no Rust/node_modules on its runtime PATH. No GUI, server, real-data launch or device access was used. The shipped slice remains diagnostics only (`capabilities: []`), with the existing TypeScript transports as defaults. Hardware, native HID/serial/capture/touch, old-OS floors and Windows production extraction/CLI support are not established by this release.

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

## Initial local limits and remaining gates

- Native Intel macOS, Linux and Windows jobs were not executed in the initial local checks. Subsequent native CI results are recorded in [release proof](#published-release-proof). Linux uses a static musl helper inside the existing GNU Bun host and CI rejects an ELF interpreter; this avoids adding a new glibc/libudev runtime dependency. Neither CI nor local checks establish physical transport behavior.
- Windows runs locked Cargo and real Bun child-contract CI only. Production extraction refuses Windows; private ACL/reparse/executable-locking and installed CLI work remain 24f. No Windows public release asset or app parity is claimed.
- Release CI signs the visible Rust executable before hashing/embedding using existing secrets; no local credential access occurred. Separate helper notarisation precedes embedding when credentials exist. The initial local ad-hoc check did not establish Developer ID/notarised extraction; the published CLI and desktop-sidecar receipts above now do.
- The inherited Tauri config says macOS 12.0, while pinned Bun 1.3.14 documents 13+. Neither minimum OS is certified here. The helper's deployment target cannot lower Bun's runtime requirement.
- No device backend/session exists: native leases, lost device-write acknowledgements, capture sequencing/overflow, handle cycling, sustained streams and native hardware cancellation are not applicable to this diagnostic slice. They remain mandatory backend gates; no automatic replay/failover code was added.
- No physical transport CPU/RSS/latency comparison or reliability improvement is claimed. Installed startup timing is in the smoke output; artifact/resource sizes belong to the final candidate packet. Existing TS native ownership is unchanged.
- Publication, released installation, update/rollback/re-upgrade and the signed/notarised desktop-bundle sidecar check passed for v0.46.1 as recorded above. Previous v0.45.0 remains the verified rollback; there is no database migration. This does not certify GUI startup or physical device behavior.

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
