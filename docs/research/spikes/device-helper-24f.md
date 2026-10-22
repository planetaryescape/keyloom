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

## Local checks passed within the sandbox's limits

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
