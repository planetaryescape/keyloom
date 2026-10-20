# 33: Prove the helper on macOS, Linux and Windows

Status: diagnostics packaging implemented in the rung 24b candidate, 2026-10-20; local installed evidence covers native macOS arm64 only. CI/release checks are configured for the other current CLI targets and native Windows child contracts, not yet observed here. All device backends and hardware support below remain proposed. [Evidence and unrun gates](../research/spikes/device-helper-24b.md). Source transport baseline: `7d3ca25981a5213b8aa9e90fcf3330d5272787fd`. D-420 and D-424 define the platform and release intent; Q37–Q41 record unsettled scope, hardware access and packaging.

## Support is a capability claim, not a cross-compile

The required end state is the [version-1 transport contract](32-device-helper-protocol.md) on native macOS, Linux and Windows. Start CI build/contract checks for all targets during phase 0; enable production backends only after each target's native and physical gates pass. macOS-first delivery does not remove Linux or Windows from scope.

| Target | Initial architecture assumption | Required evidence | Not implied |
|---|---|---|---|
| macOS | arm64 and x64 | Installed CLI, applicable Tauri bundle, HID and CDC; permission refusal, kill/stop/reopen; preserve current macOS minimum | Testing arm64 proves neither Intel nor the minimum OS version |
| Linux | x64 GNU Bun host, static musl diagnostics helper | Installed CLI on declared distro/runtime floor, hidraw and CDC, least-privilege permissions, native process cleanup | ARM, musl/static distribution, every distro or a Linux desktop shell |
| Windows | x64, MSVC target | Native installed `keyloom.exe` plus helper, HID/CDC identity and capture, Ctrl-C/parent death, explicit unsupported capabilities | WSL passthrough, Windows ARM, Docker/build/flash parity, kanata or Tauri packaging |

Q37 still gates minimum-OS certification. The inherited Tauri config says macOS 12.0, but [pinned Bun 1.3.14 requires macOS 13+](https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/docs/installation.mdx#L335-L337). The helper's 12.0 deployment setting cannot lower Bun's requirement; neither minimum was physically tested in 24b. Linux uses a static `x86_64-unknown-linux-musl` helper without libudev to avoid raising the existing GNU Bun host's libc requirement. Native runner success proves that runner, not every older OS. Windows has no public CLI asset in this rung.

Q38 assumes the Windows rung delivers a minimal real CLI journey through doctor and lab capture. Audit imports and platform assumptions in that path before adding a Windows release asset. Generic USB enumeration (`usb.ts`), UF2 volume detection, external flash tools, Docker/emulation, terminal handling and desktop setup are separate capabilities. A successful helper handshake must never make all of them report supported.

## macOS: use the vendor endpoint without disturbing typing

Run S59 against both HID and serial, with real device access authorized for that session.

- Candidate HID backend: `hidapi`, with the exact macOS backend/features pinned after source inspection. Preserve vendor-defined usage filtering and nonexclusive access to the keyboard. Record what metadata enumeration opens, if anything; listing must not claim the device, register input capture, write reports, assert DTR or prompt for operational access. If a candidate enumerator violates that, use a metadata-only OS adapter rather than weakening the contract.
- Preserve the Core Foundation tagged-pointer lesson. Remove pointer marshaling from TS; do not wrap the old FFI declarations in RPC. Review native bindings and resource ownership even if a crate claims safe methods.
- Candidate serial backend: `serialport`. Its enumeration includes `/dev/cu.*` and `/dev/tty.*`; keep one callout endpoint for each USB interface and retain owning USB VID/PID/serial. Never choose the first Glove80 half by port order.
- On ordinary capture, configure 115200 baud before any close that could otherwise leave the previous 1200/1201 setting active. Assert DTR as required by the firmware, then verify actual behavior. Opening or closing capture must not restart a half.
- A touch is an explicit state-changing request. Verify baud, DTR transitions and close timing against the existing module's debounce/latch, including the unusual 1201 relay rate. A successful setter is not evidence the firmware saw that rate. Do not restore baud immediately after touch if that would erase the trigger before firmware reads it.
- Distinguish missing permissions, disappeared endpoint and busy endpoint. Test the helper's own permission identity from terminal and signed desktop, not only the development Bun process. Show the observed remedy; do not assume every IOKit failure means Input Monitoring is missing.

Hardware checks include ordinary typing before/during/after capture, stop while idle, unplug mid-report, helper kill, parent kill and a fresh explicit start. QMK firmware timeout and ZMK DTR cleanup are part of the observation. Initial hardware uses a board already carrying the needed firmware; if reflashing is necessary, stop and ask separately.

## Linux: preserve permissions and fix framing from the OS contract

Run S60; extend the unanswered S17 evidence.

- Prefer a hidraw-based backend rather than detaching the kernel keyboard driver through libusb. Pin hidapi backend features and runtime libraries explicitly. Hidraw writes include the zero report-ID prefix; see the [source discrepancy](../research/rust-device-helper.md#the-linux-report-id-mismatch-needs-a-regression-test).
- Discovery reads metadata without opening an operational device handle. Test missing `/dev/serial/by-id`, symlink changes, ttyACM renumbering, permission-denied descriptors and duplicate USB serials. Never treat a reused path as proof of the same keyboard.
- Use distro-appropriate udev permissions scoped to supported endpoints. Diagnose missing access; do not run the app as root, chmod every device to world-writable, or install a global rule without user approval.
- Test with ModemManager present. If interference is observed, document a narrowly scoped rule; do not disable the service globally or claim it interferes without evidence.
- Pin whether enumeration links libudev. Test the release on a host without development headers/Rust; if a runtime library is required, declare it in doctor and installation docs. A Rust binary is not automatically static.
- Verify 1200/1201 baud, DTR transitions and close behavior on the actual CDC driver. Cover removal during read/write and busy-port handling; pseudo-terminals alone cannot prove USB line-state behavior.

Linux adoption needs an installed release and authorized physical HID/CDC checks. A fake sysfs tree or a cross-compiled artifact remains useful but incomplete evidence.

## Windows: native HID and COM, not a Unix emulation layer

Run S61 on native Windows. Windows is a planned backend, not a call through WSL, PowerShell serial polling or a port of `stty` arguments.

- Select the QMK vendor-defined top-level HID collection, not the ordinary keyboard collection. Normalize report ID and buffer lengths from the backend. Verify the correct collection on a composite device with several interfaces.
- Resolve a COM endpoint to its owning USB VID/PID/serial/interface through the selected crate and, where required, SetupAPI/configuration-manager metadata. COM numbers are ephemeral; support values above COM9 without exposing path construction to TS. If serial identity is absent/ambiguous, refuse a state-changing selection.
- Use the existing in-box HID/CDC drivers where the actual descriptors support them. Do not prescribe Zadig, replace the keyboard driver or install a privileged service. If the firmware does not bind to CDC correctly, report that as a separate firmware/driver finding.
- `serialport` offers a Windows implementation, but neither its API nor a successful baud setter proves 1201 works on the driver/board. Test it explicitly; disable relay capability when it cannot be established.
- Cancellation can race with completed writes. Windows documents that CancelIoEx is not a guarantee. Keep overlapped buffers alive until completion if using that API directly; otherwise establish what the crate guarantees. The parent watchdog isolates a stuck helper without claiming a write was undone.
- Test another process holding the COM port, unplug while reading, suspend/resume, executable paths with spaces/non-ASCII characters, Ctrl-C, parent kill, and the absence of a flashing console window when launched by a UI host.

The installed Windows demonstration imports a synthetic/public layout into scratch data, runs doctor, then uses `keyloom lab start <layout>` with explicit hardware permission. It stops and starts a new recording, and exposes interruption honestly after a forced helper exit. Lab replay/analysis may still need unsupported Docker/emulation infrastructure; do not fabricate a successful analysis to complete the demonstration.

A PowerShell install path must check the release checksum, install per-user without elevation, handle `.exe` locking/version coexistence and avoid POSIX shell assumptions. Signing/SmartScreen and antivirus behavior are measured release risks, not reasons to disable OS protections. If code-signing credentials or a native runner are unavailable, record the blocker and keep the target unverified.

## Package two processes as one version

Rung 24b implements Q41's embedded-helper shape for the current Unix CLI targets. `scripts/build-binaries.ts` replaces the source-only packaged module with a static binary-asset import and manifest. The installed native macOS arm64 test proves unsigned/ad-hoc extraction and execution; Developer ID/notarised desktop and other native target evidence remain release gates, not observed successes.

Proposed build flow:

1. Pin Rust in `rust-toolchain.toml`, commit `Cargo.lock`, and build the target helper with locked dependencies on a suitable native CI runner. Inspect crate/transitive licences and produce notices; keyloom's helper remains AGPL-3.0-or-later.
2. Sign the helper where required **before** hashing/embedding it. Record helper SHA-256, release version, target triple and protocol version in a generated manifest.
3. Import the target helper as a binary asset using a build-generated static import. Compile the existing Bun entry with that asset and manifest. Do not build import paths from `import.meta` at runtime or assume Bun's virtual filesystem is executable by the OS.
4. Sign/package the parent and desktop bundle through the existing release chain. Preserve release-please ownership of versions/tags and `SHA256SUMS` for final artifacts. Do not invent a second helper release version.
5. Install from the release artifact, outside the repo with no Rust, node_modules or local helper source. Test extraction, execution, update and rollback. A local `cargo run` is not the shipping check.

Implemented Unix extraction root (Windows remains proposed): `<user-cache>/keyloom/device-helper/<release>/<target>/<sha256>/keyloom-device[.exe]`. Use the existing XDG cache convention on macOS/Linux and a per-user LocalAppData cache on Windows. Directories are private to the user (0700 / appropriate Windows ACL), files are created exclusively in the same directory, verified and atomically renamed, and executable on Unix. Reject symlink/reparse-point substitution and unexpected owners/permissions; never run an unverified file already at the target path. Test two parents extracting concurrently.

Launch only that verified absolute path. The file hash is an integrity check anchored in the installed host, not protection against a malicious process already controlling the same user account. No PATH/current-directory fallback and no production environment override to an arbitrary executable. Tests inject a fake launcher explicitly.

Keep versions side by side so running Windows executables need not be overwritten and rollback keeps a matching pair. Initial policy keeps extracted versions until explicitly cleaned; cleanup must not delete active helpers. Manifest mismatch or extraction failure disables device operations but leaves layout editing/import available. Give doctor a repair instruction; do not fetch a helper dynamically.

The Unix cache subtree is user-owned, nonsymlink and private (0700), with a 0700 regular executable. Existing general cache ancestors may be 0755 but not writable by other users; canonical OS aliases such as macOS `/var` are accepted. Publication uses an exclusive same-directory temporary file plus atomic no-replace hard link, so concurrent processes never overwrite an executable. Every launch verifies ownership, modes, type, size and SHA-256 again. Unsafe paths and corruption fail closed rather than being silently repaired. Windows production extraction refuses until ACL/reparse checks are implemented in 24f.

Native release jobs use macOS arm64, Intel macOS and Ubuntu runners. Linux builds a static musl helper; a fan-in job collects exactly three CLI binaries and creates the final checksum list. Existing signing secrets are used by `scripts/sign-device-helper.sh` before hashing/embedding: Rust gets hardened runtime and timestamp, no Bun JIT entitlements. When existing notarisation credentials are present the visible helper is submitted separately before embedding; outer Tauri notarisation cannot inspect its hidden bytes. Missing credentials produce explicit warnings, not a signed/notarised claim.

For Tauri, follow the current shell -> Bun sidecar -> helper chain. Test signing, permission prompts, helper extraction and server reuse in that exact chain. A separately bundled app-resource helper is an alternative only if S62 disproves extraction and D-424 is amended. Do not apply Bun's JIT entitlements to Rust by habit; establish the helper's actual signing needs.

## Verification has three distinct levels

| Level | Required checks | What it can establish |
|---|---|---|
| Synthetic, every PR | Cargo tests/format/lints, Bun tests/types/dependency rules, shared schema fixtures, fake native lifecycle, lost-response and overflow cases, no-real-device guards | Protocol and application invariants; no physical-device claim |
| Native OS, every release target | Installed host/helper handshake, cold extraction, wrong hash/version refusal, process cleanup, concurrent launches, permission/path failures, applicable desktop path | Runtime/package viability on the tested OS/architecture; not electrical/firmware behavior |
| Authorized hardware, before enabling each capability | Exact endpoint selection, ordered capture, stop/reopen, unplug, kill, native framing, ordinary typing, baud/DTR and authorized reset observations | Only the named board/firmware/OS/capability tested |

Use a synthetic backend to run at least 100 open/close cycles and a ten-minute sustained stream, including overload beyond the queue bound. Assert no growing handle/thread count and explicit termination on loss. Use real hardware for a smaller agreed run, never ten minutes of private typing by default. These are proposed test budgets, not results.

Record helper/host hashes, toolchain/features, OS version, architecture, keyboard model/revision, firmware pin, permissions, test action and outcome. Keep physical serials and raw recordings out of the repo. Measure idle/capture CPU, process-tree RSS, cold/warm startup, stop latency, native-handle counts and artifact size against the current backend where one exists. Windows has no current transport baseline; compare against the contract, not a fictional previous implementation.

S58–S62 remain open until their reports name what was observed and what was not. A platform can ship diagnostics while hardware support is experimental; only claim HID/serial/capture/touch support after the relevant gate. Keep Linux/Windows work independently deliverable from the unfinished agent roadmap.
