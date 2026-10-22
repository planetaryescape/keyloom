# Windows slice 1 has an implemented release path; native evidence is pending

Status: D-435 implementation, uncommitted on `feat/windows-release-target`, based on `a050189f6695ba923339db8fb7b99a2ec649fd55` (`origin/main` snapshot). At handover the shared local `origin/main` ref had advanced to `020cf0f09fa8cc533d45384bb688948b7c29cf6a` (release 0.50.0), differing only in release metadata; this worker leaves HEAD and the uncommitted work on the requested base for the orchestrator. No native Windows runner result or release artifact was observed in this session. The implementation host is macOS arm64 with Bun 1.3.14. No device discovery, open, capture, touch, reset or flash was performed.

## The paired Windows release is diagnostics only

`scripts/build-binaries.ts` adds `bun-windows-x64` -> `keyloom-windows-x64.exe` with `x86_64-pc-windows-msvc` / `keyloom-device.exe`. The backend stays `legacy`, and the helper must advertise `capabilities: []`. The existing Apple Silicon native default and Intel/Linux diagnostics/legacy selections are preserved. No Rust changes or Windows target installation were needed locally.

`release.yml` builds the Windows helper on `windows-2022`, embeds its hash in the host and includes the final exe in the four-asset `SHA256SUMS`. There is no Windows signing credential in the supplied environment. Both executables remain unsigned; release notes state this limitation. SmartScreen, antivirus response, signing and publisher reputation were not measured. No protection bypass is implemented or recommended.

`install.ps1` installs per-user under LocalAppData, supports `-Version`, `KEYLOOM_INSTALL_DIR`, `KEYLOOM_DOWNLOAD_BASE` and opt-in `-AddToPath`, and verifies with `Get-FileHash`. A locked previous executable moves aside if Windows allows it; otherwise installation fails with a close/retry message. Unique staging and rollback preserve the existing install after checksum or publication failure.

## Extraction checks Windows metadata before launch

The managed path is `%LOCALAPPDATA%\keyloom\device-helper\<release>\<target>\<sha>\keyloom-device.exe`. Existing parents are inspected before creating children. Node checks directory/file type, junction/symlink status and canonical paths. Built-in Windows PowerShell/.NET supplies `ReparsePoint` attributes and ACL inspection: owners/write grants must be limited to the current user, SYSTEM or Administrators. Inherit-only ACEs do not apply to the inspected object. Conservative refusal can reject unusual enterprise ACLs; no ACL is changed automatically.

ACL inspection is cached per path in the process; reparse attributes and final file identity, size and SHA-256 are rechecked on each extraction. Exclusive temporary creation plus same-directory rename handles concurrent publication, accepting a locked winner only after full verification. Releases/hashes coexist, and no automatic cache cleanup occurs. As on Unix, this protects the installed pair's integrity, not against a malicious same-user process racing the launcher. Node does not expose every Windows reparse tag; [Node's AppExecLink issue](https://github.com/nodejs/node/issues/36790) and [Microsoft's filesystem-right definitions](https://source.dot.net/System.IO.FileSystem.AccessControl/System/Security/AccessControl/FileSystemRights.cs.html) informed the metadata checks.

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

## The orchestrator owns the next checks

Account for the release-only main advance when committing/rebasing. From this worktree, in an environment allowed to use the shared build queue, run `agent-work run -- bunx tsc --noEmit`, `agent-work run -- bun run depcruise`, and the regression suite (including remap with loopback available). Review the uncommitted diff and commit it as the orchestrator. Then let the branch's `windows-2022` job build and run the installed smoke; attach its run URL and result here before claiming native Windows support. A native build failure must be investigated on that runner rather than inferred from macOS. No hardware action is authorized by this handover.
