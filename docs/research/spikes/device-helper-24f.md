# Windows slice 1 has an implemented release path; native evidence is pending

Status: D-435 slice 1, PR 154 on `feat/windows-release-target`. The native `windows-2022` CI job passes the full installed journey (2026-10-22, run on head `13aee17`). Native Windows device support and S61 hardware evidence remain open.

## The paired Windows release is diagnostics only

`scripts/build-binaries.ts` adds `bun-windows-x64` -> `keyloom-windows-x64.exe` with `x86_64-pc-windows-msvc` / `keyloom-device.exe`. The backend stays `legacy`, and the helper must advertise `capabilities: []`. The existing Apple Silicon native default and Intel/Linux diagnostics/legacy selections are preserved. No Rust changes or Windows target installation were needed locally.

`release.yml` builds the Windows helper on `windows-2022`, embeds its hash in the host and includes the final exe in the four-asset `SHA256SUMS`. There is no Windows signing credential in the supplied environment. Both executables remain unsigned; release notes state this limitation. SmartScreen, antivirus response, signing and publisher reputation were not measured. No protection bypass is implemented or recommended.

`install.ps1` installs per-user under LocalAppData, supports `-Version`, `KEYLOOM_INSTALL_DIR`, `KEYLOOM_DOWNLOAD_BASE` and opt-in `-AddToPath`, and verifies with `Get-FileHash`. A locked previous executable moves aside if Windows allows it; otherwise installation fails with a close/retry message. Unique staging and rollback preserve the existing install after checksum or publication failure.

## Extraction checks Windows metadata before launch

The managed path is `%LOCALAPPDATA%\keyloom\device-helper\<release>\<target>\<sha>\keyloom-device.exe`. Existing parents are inspected before creating children. Node checks directory/file type, junction/symlink status and canonical paths. Built-in Windows PowerShell/.NET supplies `ReparsePoint` attributes and ACL inspection: owners/write grants must be limited to the current user, SYSTEM or Administrators. Inherit-only ACEs do not apply to the inspected object. Conservative refusal can reject unusual enterprise ACLs; no ACL is changed automatically.

ACL inspection is cached per path in the process; reparse attributes and final file identity, size and SHA-256 are rechecked on each extraction. The temporary exe is created exclusively with a private DACL, verified, then published with a hard link, which fails if the exe exists; a concurrent loser verifies the winner instead. A rename would replace an existing exe that another process is verifying. LocalAppData must be NTFS. Releases/hashes coexist, and no automatic cache cleanup occurs. As on Unix, this protects the installed pair's integrity, not against a malicious same-user process racing the launcher. Node does not expose every Windows reparse tag; [Node's AppExecLink issue](https://github.com/nodejs/node/issues/36790) and [Microsoft's filesystem-right definitions](https://source.dot.net/System.IO.FileSystem.AccessControl/System/Security/AccessControl/FileSystemRights.cs.html) informed the metadata checks.

## Unsupported workflows fail before their actions run

`src/firmware/toolchain/platform-support.ts` owns Windows policy and the typed roadmap error (CLI exit 6, `platform_unavailable`). The CLI pre-action hook blocks build, flash, sync/autosync, lab, remap, keyboard, emulation, serve, config use, geometry generation and online board checks. Offline board checks remain available. App build/flash/sync/emulation/remap/lab entry points and default HID/serial selectors also guard alternate callers. Doctor reports unavailable components without probing unsupported device/toolchain paths. Serve is gated entirely because its startup owns discovery and auto-sync.

Q38 is assumed as directed by the Stage 7 brief: helper/CLI device journey first, full product parity separately. HID/COM and lab capture are the next slice. No device capability is advertised by this slice.

## Local checks ran on macOS; Windows behaviour comes from CI

Commands used `/opt/homebrew/Cellar/bun/1.3.14/bin/bun`.

| Command | Observed result |
|---|---|
| `git status --short`, `git branch --show-current`, `git rev-parse HEAD` | Clean initial tree, branch `feat/windows-release-target`, base SHA above |
| `git fetch origin main` | Blocked writing shared worktree `FETCH_HEAD` outside the writable root |
| `git ls-remote origin refs/heads/main` | GitHub hostname could not resolve; remote freshness remains unverified |
| `bun test test/cli/windows-support.test.ts test/firmware/toolchain/device-helper-windows-extract.test.ts test/firmware/toolchain/device-helper.test.ts` (initial focused run) | 42 pass, 2 Windows-native skips, 0 fail |
| `bun test test/cli/firmware.test.ts test/cli/windows-support.test.ts test/firmware/toolchain/device-helper-windows-extract.test.ts` | 31 pass, 2 Windows-native skips, 0 fail |
| `bun test test/cli/firmware.test.ts test/cli/sync.test.ts test/cli/remap.test.ts test/cli/emulate.test.ts test/cli/lab.test.ts test/cli/change.test.ts test/cli/windows-support.test.ts test/firmware/toolchain/device-helper.test.ts test/firmware/toolchain/device-helper-windows-extract.test.ts` | 89 pass, 3 skips, 7 failures. Each failure occurs in fake kanata's `Bun.listen(127.0.0.1:0)` with sandbox `EPERM`; no device was involved |
| `bun test test/cli/windows-support.test.ts test/firmware/toolchain/device-helper-windows-extract.test.ts` (final added refusal/hook cases) | 22 pass, 2 Windows-native skips, 0 fail |
| Ruby `YAML.load_file` for `ci.yml` and `release.yml` | Both parse |
| `git diff --check` | Pass |
| `agent-work run -- .../bun node_modules/typescript/bin/tsc --noEmit` and `agent-work run -- .../bun run depcruise` | Both blocked connecting to Pueue's socket: `Operation not permitted`. No bypass of the shared build queue |

Injected filesystem tests cover Unicode/spaces, version coexistence, final hash rechecks, symlink/junction/canonical-path refusal, metadata refusal, locked/corrupt publication winners, final-file links and failed-publication cleanup. A simulated win32 CLI check verifies typed refusal precedes missing-layout lookup and normal doctor skips device/toolchain probes. Native junction and broad writable-ACL tests are configured for Windows and skipped locally.

## Windows CI must establish the installed outcome

`windows-2022` is the only available native Windows evidence source. CI builds the real MSVC diagnostics helper, checks the pair and runs `scripts/smoke-windows-install.ps1` using Windows PowerShell 5.1 for installation and a local file mirror. The scratch path includes a space and `é`. Runtime PATH contains Windows system tools only, excluding Bun, Rust, Docker and WSL. Checks include eight concurrent cold doctors, version, `capabilities: []`, normal doctor, public Oryx import/layout show/boards/change, unsupported build exit/message, locked replacement refusal, update after unlocking, opt-in/idempotent user PATH, checksum mismatch preserving the previous exe, corrupt-cache refusal and layout use after helper failure.

None of those Windows-native outcomes was observed locally. Neither Windows compilation nor execution, installer PowerShell parsing, real ACL/reparse behavior, exe locking, PATH registry behavior, compiled Bun SQLite/WASM import portability, SmartScreen/antivirus, nor published download checksums are certified by the local injected tests. The existing source paths embed WASM bytes without POSIX shelling, but only CI can establish their Windows runtime behavior. Windows minimum-version claims remain open under Q37.

S61 still needs HID collection/COM ancestry, bounded I/O/cancellation, leases, capture/stop/reopen, Ctrl-C/parent death, unplug/busy-port behavior, framing and exact 1200/1201-baud effects on separately authorized hardware. Windows S62 still needs native installed evidence and release-policy measurements. No physical evidence or Windows transport support is claimed.

## Native Windows CI found four problems the local tests couldn't

The `windows-2022` job ran the real MSVC helper and the compiled CLI. It found four problems, each now fixed on this branch:

- **Windows PowerShell 5.1 couldn't load `Get-Acl`.** It was launched from PowerShell 7 and inherited 7's `PSModulePath`, so every extraction refused the cache. The inspection now reads ACLs through .NET (`DirectoryInfo`/`FileInfo.GetAccessControl`), and the child process gets no `PSModulePath`. The test fixtures set ACLs the same way.
- **The refusal reason was unreadable.** Redirected PowerShell stderr is CLIXML. The script now prints its reason on stdout and exits 1, and `HelperFailure` carries the detail in its message (`unsafe_cache: …`).
- **A cold Windows PowerShell start took several seconds on the runner.** The inspection allows 30 s. Each path's ACL is read once per process, but every inspection and private-creation step starts PowerShell (two on a warm launch, more on a cold one).
- **`keyloom.exe` ran nothing and exited 0.** `import.meta.main` in `src/cli/main.ts` is false in the compiled Windows executable, so `--version` printed nothing through a pipe, a file and `cmd`. Compiled builds now start from `src/cli/compiled.ts`, which always runs the CLI. The CLI also flushes stdout and stderr before it exits.

On the final head the installed smoke passes everything it was written to check:
- checksum-verified install into a path with a space and `é`;
- a locked-exe refusal, then the update;
- PATH changes only with `-AddToPath`;
- `--version`;
- eight concurrent cold doctors;
- `import`, `layout`, `boards`;
- `change check`/`propose`/`apply` with F17 read back on key 6;
- `keyloom build` refused with exit 6 and the roadmap link;
- a checksum mismatch refused with the installed exe preserved;
- a corrupted cached helper refused while layout editing still works.

The ancestor check (delete, delete-child, change-permissions and take-ownership rights held by another account on any folder above the cache) and the junction and Everyone-writable refusals pass as native tests.

Still not observed: SmartScreen and antivirus behaviour on a downloaded unsigned exe, and a published Windows release download.

## Remaining after slice 1

The installed Windows journey is covered by the `windows-2022` CI job; the merged head's run is the evidence of record. Review rounds with Codex (gpt-6.1-sol) closed three Windows cache-safety holes, each now covered by a native test:
- ancestor folders that another account could rename;
- inheritable untrusted grants on the cache root;
- objects created without an explicit descriptor. Folders and the temp exe are now created with a protected DACL.

Still open:
- Native HID/COM (slice 2, D-436).
- S61 on Windows hardware.
- Code signing, and SmartScreen/antivirus behaviour on a downloaded release.
- Process-level tests for a closed or stalled stdout. The exit flush is bounded at 5 s.

## Slice 2 implements the native candidate without hardware evidence

Status: implemented, uncommitted worker changes on `feat/device-helper-windows`, based on `8b030a91b95331a8512f2eb78d1e3cbd47396508` (PR 154), macOS arm64, 2026-10-22. D-436 records the design. The separate `windows-2022` candidate job has not run for these changes. No Windows runtime or physical device result is claimed.

### The explicit build keeps ordinary releases diagnostics-only

```powershell
bun scripts/build-binaries.ts --device-backend native --target bun-windows-x64 --out-dir dist/native-windows-candidate
.\dist\native-windows-candidate\keyloom-windows-x64.exe --data-dir "$env:TEMP\keyloom-native-doctor" doctor --device-helper-only
```

The builder selects `native-windows`, statically selects both native host adapters, and pairs the helper hash/version as before. Doctor expects `hid.list`, `hid.open`, `hid.write`, `serial.list`, `serial.open`, `serial.touch.1200`, `serial.touch.1201`, with “native Windows candidate; hardware acceptance pending”. Without the explicit backend, Windows still embeds a diagnostics-only helper and refuses device commands under D-435. A separate output directory and native runner are required.

`windows_registry.rs` enumerates SetupAPI HID/COM interfaces, reads the COM `PortName`, and uses the injected CfgMgr USB-owner walk in `windows_contract.rs`. It stops at the first USB device, skips `MI_` composite-interface nodes, retains absent serials and distinguishes instance-plus-port keys. `hid_windows.rs` checks collection caps and zero report IDs, opens with sharing, and rechecks the opened attributes/serial plus metadata. `serial_windows.rs` opens exclusively, verifies raw DCB state, owns DTR and checks close. Both touch rates use the same verified sequence. `windows_io.rs` retains overlapped storage through completion/cancellation, exits on unconfirmed cancellation, and owns named-mutex leases. The lock adds only `windows-sys 0.61.2` and `windows-link 0.2.1`; both MIT notices are embedded.

Known keyboard driver-failure devnodes without a usable interface become `driverMissing` records. Doctor gives an in-box HID/`usbser.sys` remedy; open/touch returns `unsupported`. COM access-denied/sharing-violation opens become `busy`. Doctor does not open COM to measure occupancy: its conditional busy hint and explicit-open error remain distinct from the missing-driver finding and workflow refusal.

The candidate admits lab and reboot-only, preserving Docker, full flash/UF2, kanata, sync, serve and general-discovery refusals. Reboot-only now accepts an explicit ZMK board/half and reuses the existing local/relay selector. Its `transport_only: true` response does not claim firmware restart or a mounted bootloader. On Windows the QMK restart's existing departure check reads the HID/COM identity view, not general USB discovery.

### Local verification used the pinned source and provisional transitive dependencies

Bun was `/opt/homebrew/Cellar/bun/1.3.14/bin/bun`; Rust commands selected `/Users/bhekanik/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin` and `RUSTC_WRAPPER=`. No device was discovered, opened, recorded, touched, restarted or flashed. Anonymous PTYs and synthetic fixtures were used only.

| Check | Observed result |
|---|---|
| `git fetch origin main` | Sandbox refused writing the shared worktree's `FETCH_HEAD`; initial HEAD and `origin/main` both resolved to the base SHA above |
| Later `git rev-parse HEAD origin/main` / `git diff --stat HEAD..origin/main` | Another process advanced `origin/main` to `583e39b3474ca3eb3b702f10583bb2e437eedce5` (release 0.51.0); only package version, release manifest and changelog differed. Worker HEAD stayed on the supplied base |
| `cargo update --offline -p windows-sys --precise 0.61.2` | Passed after introducing the dependency. Final lock diff contains only the helper dependency edge and the two Windows packages; existing versions/checksums are unchanged |
| `agent-work run -- … cargo check … --target x86_64-pc-windows-msvc --features native-windows` | Blocked at Pueue's Unix socket by sandbox `Operation not permitted` |
| Repository `cargo check --locked --offline --all-targets --target x86_64-pc-windows-msvc --features native-windows` | Stopped before compilation: cached `cfg-if 1.0.5` unavailable. A non-offline attempt also could not unpack windows-link into the read-only Cargo home |
| `cargo fmt --check` | Passed against the repository manifest |
| Isolated Windows `cargo check` and all-target clippy `-D warnings`, `native-windows` | Passed, including every new Windows adapter and Windows unit-test source; no linking or execution |
| Isolated Windows all-target clippy `-D warnings`, `synthetic-windows` | Passed; no native device code compiled in that feature |
| Isolated Linux musl check and all-target clippy `-D warnings`, `native-linux` | Passed; no Linux binary executed |
| Isolated macOS all-target clippy `-D warnings`, `native-macos` | Passed |
| Isolated macOS `cargo test --features native-macos` | 41 unit tests passed, including existing raw-termios/anonymous-PTY, checked-close and portable Windows contract tests |
| Isolated diagnostics clippy and tests | Clippy passed; 17 unit tests and 3 real OS-pipe lifetime tests passed |
| Isolated `cargo test --features synthetic-windows` on macOS | 22 unit tests passed; synthetic endpoints only, not Windows API execution |
| Focused Bun policy, reboot, interrupted-lab and Windows extraction run (8 files) | 77 passed, 5 Windows-native extraction checks skipped, zero failures |
| Final Bun policy, reboot, transport, owner and USB metadata run (6 files) | 50 passed, 12 compiled-helper/soak checks skipped, zero failures |
| `bun node_modules/typescript/bin/tsc --noEmit` | Passed |
| `bun run depcruise` | Passed: 668 modules, no violations. Existing warning: dependency-cruiser's compatible transpiler range excludes TypeScript 7 |
| `bun scripts/gen-device-helper-schema.ts` | Regenerated the transport supplement with `driverMissing`; frozen diagnostics schema unchanged |
| Builder guard commands | Explicit Windows native reaches the expected cross-build/prebuilt-helper refusal on macOS; shared `dist` is refused |
| Ruby YAML parse of `.github/workflows/ci.yml`; `git diff --check` | Passed after removing an extra notice-file trailing blank |

The isolated manifest lives at `/tmp/keyloom-stage8-check/native/device-helper/Cargo.toml` and points at the actual worktree source. It uses the repository's exact direct dependency versions, including `windows-sys 0.61.2`, `windows-link 0.2.1` and libc 0.2.191, but resolves cached transitive `cfg-if 1.0.4`, `memchr 2.8.1` and `zmij 1.0.21` instead of the repository lock's 1.0.5/2.8.3/1.0.23. Its optional, uncompiled proc-macro/WASI lock entries also resolve from the cache. Cargo storage stays under `/tmp`; repository pins and lock entries were preserved. These checks establish source/API compatibility with the provisional graph, not a successful pinned build.

### CI must establish the installed Windows result

`device-helper-windows-candidate` runs clippy `-D warnings` and tests with `native-windows`, builds the explicit candidate, installs it through `install.ps1` into scratch LocalAppData with spaces/non-ASCII, and checks its seven-capability doctor without listing devices. It separately builds `synthetic-windows`, pairs the test-only `smoke-windows-native-entry.ts`, and uses fresh installed processes for imports, two recordings per transport, persisted sessions, stop/reopen, local/relay touch and reboot-only. The entry checks the embedded helper's synthetic identity before every synthetic command. Terminal text is scripted; capture, selectors, IPC and persistence are production paths. Runtime PATH excludes Bun/Rust/Docker. The ordinary diagnostics Windows job remains separate.

Not observed: Windows linking or test execution, PowerShell smoke execution, a built/installed candidate's doctor, the installed synthetic lab journey, Windows named-mutex behavior, actual SetupAPI/CfgMgr/registry results, HID caps/serial correctness, COM driver binding/occupancy, overlapped completion/cancellation on Windows, DCB/DTR behavior, executable/pipe cleanup or resource measurements. All Windows source paths and unit-test bodies cross-compiled under the provisional graph; the complete repository-locked Windows build did not compile locally. No Windows transport path ran. No Ctrl-C, ConPTY, helper/parent death, suspend/resume or physical firmware effect was tested by this slice's installed journey.

Next action for the orchestrator: inspect the uncommitted diff and `/tmp/keyloom-stage8-worker-report.md`, commit under BK's authorship, refresh/rebase the release-only main change, then push and iterate on the `device-helper-windows-candidate` CI job. Keep ordinary Windows releases diagnostics-only. After native CI passes, arrange a separately authorized S61 Windows run covering collection/USB identity, COM10+/renumbering, missing drivers and busy ports, capture/stop/reopen, unplug/kill and firmware-observed 1200/1201 effects. A scripted terminal or successful setter does not close S61.
