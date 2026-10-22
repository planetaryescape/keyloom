# 33: Prove the helper on macOS, Linux and Windows

Status: D-433 selects `native-macos` for Apple Silicon CLI releases and their desktop sidecars. Intel Macs and Linux keep legacy transports and diagnostics-only helpers until their own hardware evidence. [S59](../research/spikes/S59.md) proves arm64 capture, failure and reopen behavior on the Moonlander and Glove80; [Stage 5](../research/spikes/device-helper-native-default.md) records the combined build and explicit touch implementation. Physical touch/reset and release desktop acceptance remain the orchestrator's checks. An explicit Linux `native-linux` candidate is implemented under D-434; [24e](../research/spikes/device-helper-24e.md) records the software checks and pending S60 gate. Windows slice 1 implements the diagnostics/layout release and installer under D-435. D-436 implements an explicit `native-windows` HID/COM candidate; native candidate CI and S61 remain pending.

## Support is a capability claim, not a cross-compile

The required end state is the [version-1 transport contract](32-device-helper-protocol.md) on native macOS, Linux and Windows. Start CI build/contract checks for all targets during phase 0; enable production backends only after each target's native and physical gates pass. macOS-first delivery does not remove Linux or Windows from scope.

| Target | Initial architecture assumption | Required evidence | Not implied |
|---|---|---|---|
| macOS | arm64 and x64 | Installed CLI, applicable Tauri bundle, HID and CDC; permission refusal, kill/stop/reopen; preserve current macOS minimum | Testing arm64 proves neither Intel nor the minimum OS version |
| Linux | x64 GNU Bun host, static musl helper; native transport candidate is explicit | Installed CLI on declared distro/runtime floor, hidraw and CDC, least-privilege permissions, native process cleanup | ARM, musl/static distribution, every distro or a Linux desktop shell |
| Windows | x64, MSVC target | Native installed `keyloom.exe` plus helper, HID/CDC identity and capture, Ctrl-C/parent death, explicit unsupported capabilities | WSL passthrough, Windows ARM, Docker/build/flash parity, kanata or Tauri packaging |

Q37 still gates minimum-OS certification. The inherited Tauri config says macOS 12.0, but [pinned Bun 1.3.14 requires macOS 13+](https://github.com/oven-sh/bun/blob/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/docs/installation.mdx#L335-L337). The helper's 12.0 deployment setting cannot lower Bun's requirement; neither minimum was physically tested in 24b. Linux uses a static `x86_64-unknown-linux-musl` helper without libudev to avoid raising the existing GNU Bun host's libc requirement. Native runner success proves that runner, not every older OS. Windows slice 1 defines `keyloom-windows-x64.exe`; publishing and native installed evidence remain pending.

Q38 assumes the Windows rung delivers a minimal real CLI journey through doctor and lab capture. Audit imports and platform assumptions in that path before adding a Windows release asset. Generic USB enumeration (`usb.ts`), UF2 volume detection, external flash tools, Docker/emulation, terminal handling and desktop setup are separate capabilities. A successful helper handshake must never make all of them report supported.

## macOS: use the vendor endpoint without disturbing typing

Run S59 against both HID and serial, with real device access authorized for that session.

- The [24c implementation candidate](../research/spikes/device-helper-24c.md) uses direct IORegistry/IOKit with pinned `core-foundation`, not HIDAPI: the inspected immutable HIDAPI 2.6.3 and 2.6.7 macOS callbacks silently discard older queued reports. Registry discovery reads metadata and the descriptor without an operational open; the owner then opens the exact registry ID nonexclusively. Compile/synthetic evidence does not establish real permission, framing or lifecycle behavior. Apple Silicon releases enable it together with native serial; Intel retains the legacy macOS FFI (D-433).
- Preserve the Core Foundation tagged-pointer lesson. Remove pointer marshaling from TS; do not wrap the old FFI declarations in RPC. Review native bindings and resource ownership even if a crate claims safe methods.
- D-431 replaces the earlier `serialport` candidate with direct macOS IORegistry/POSIX ownership. The audited crate ignores the builder DTR setter error and has no checked DTR-low close. Shared registry helpers enumerate only USB-owned `IOSerialBSDClient` callout endpoints, sorted by registry ID plus path; duplicate serial numbers remain distinct. Identity comes from the nearest `IOUSBHostDevice`/`IOUSBDevice` ancestor. macOS copies VID/PID onto the CDC data and interface nodes without string descriptors (S59). Native paths stay inside the helper. Never choose the first Glove80 half by port order.
- Capture checks registry identity before opening with `O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC`, re-resolves the registry entry ID and compares full metadata and callout path immediately after open, then checks `TIOCEXCL`, builds raw 115200 8N1 with software/hardware flow control off and HUPCL cleared, applies it and verifies termios readback before asserting DTR and checking `TIOCMGET`. Close checks `TIOCCDTR`, `TIOCNXCL` and fd close. After an unplug, `ENXIO` from the two line ioctls means there is nothing left to clear, so the fd close alone decides (D-432). The HID close likewise accepts a device-gone `IOHIDDeviceClose` result after the removal callback. A setup failure clears DTR only if capture baud was verified; otherwise cleanup only closes the fd. A failed post-open identity check closes the fd without configuration and returns `stale_device` with possible effects. Every post-open failure reports possible effects. The OS can assert DTR on open and an early failure may close at an inherited trigger rate; software ordering proves neither absence of a restart nor the firmware-observed baud/line state. PTYs establish configuration/read/write/error handling only. See the [exact sequence and remaining physical gates](../research/spikes/device-helper-24d.md#slice-2-owns-the-macos-port-with-checked-transitions).
- A touch acquires the endpoint lease and repeats the serial-open identity checks before and after opening. It sets the speed to 1200 or 1201 with `IOSSIOSPEED`, because `tcsetattr` refuses 1201 (D-440). It then verifies both speeds with `tcgetattr`, clears DTR and closes exactly once. `ENXIO` on line control follows D-432; other failures report possible effects after open. A failed close terminates the helper while retaining the lease until process exit. A touch is an explicit state-changing request. Verify baud, DTR transitions and close timing against the existing module's debounce/latch, including the unusual 1201 relay rate. A successful setter is not evidence the firmware saw that rate. Do not restore baud immediately after touch if that would erase the trigger before firmware reads it.
- Distinguish missing permissions, disappeared endpoint and busy endpoint. Test the helper's own permission identity from terminal and signed desktop, not only the development Bun process. Show the observed remedy; do not assume every IOKit failure means Input Monitoring is missing.

Hardware checks include ordinary typing before/during/after capture, stop while idle, unplug mid-report, helper kill, parent kill and a fresh explicit start. QMK firmware timeout and ZMK DTR cleanup are part of the observation. Initial hardware uses a board already carrying the needed firmware; if reflashing is necessary, stop and ask separately.

## Linux has an explicit sysfs/libc candidate; S60 remains open

```sh
bun scripts/build-binaries.ts --device-backend native --target bun-linux-x64 \
  --out-dir dist/native-linux-candidate
dist/native-linux-candidate/keyloom-linux-x64 --data-dir /tmp/keyloom-linux-doctor \
  doctor --device-helper-only
```

Run the build on Linux x64, or supply a prebuilt target `--helper` when cross-building. The candidate advertises all seven HID/serial capabilities and doctor calls it a Linux candidate with hardware acceptance pending. Default Linux releases still pair a diagnostics-only helper with legacy TypeScript transports (D-433). No hardware was accessed during implementation; [24e evidence](../research/spikes/device-helper-24e.md) records local checks and Linux CI commands separately.

`native-linux` is Linux-only and cannot combine with macOS or synthetic features. It uses sysfs and the pinned libc ABI directly, with no libudev, hidapi or basic-udev. The helper remains static musl; the Bun host retains its existing GNU runtime requirement. CI checks both the absence of an ELF interpreter and dynamic dependencies.

HID discovery reads `report_descriptor` and `uevent` under each `/sys/class/hidraw/*/device`, admits the unnumbered QMK raw interface (page `0xff60`, usage `0x61`, 32-byte input/output), then walks to the nearest USB device's `idVendor`/`idProduct` attributes. Missing serial stays missing; a hub cannot supply it. Interface metadata comes from `bInterfaceNumber` below that owner. Serial uses `/sys/class/tty/ttyACM*` with the same ancestry. Neither backend depends on `/dev/serial/by-id`. Keys combine the resolved sysfs device path and dev node; duplicate serials remain separate endpoints.

Open uses `O_RDWR | O_NONBLOCK | O_CLOEXEC` (also `O_NOCTTY`), then compares the dev node's character-device identity against the fd and repeats metadata discovery. A mismatch is `stale_device`. Identical metadata after an indistinguishable reconnect remains the S57 limitation. Hidraw writes add a zero report-ID byte to the 32-byte payload; unnumbered reads preserve all 32 bytes without stripping a prefix. Reads target 50-ms polling and pending reads do not wait. Short HID writes fail rather than sending the tail as another report.

CDC capture shares macOS's raw 115200/8N1/no-flow-control/HUPCL-clear builder and verifier. Linux owns `TIOCEXCL`, DTR-high via `TIOCMBIS` and `TIOCMGET` readback. Touch uses Linux `TCGETS2`/`TCSETS2` with `BOTHER` to set and read back exact 1200/1201 rates before DTR-low (`TIOCMBIC`) and one close. Both capture and touch clear exclusivity before releasing the fd. `TIOCEXCL` blocks later opens; it cannot evict a process already holding the tty. Read/write `ENODEV`, `ENXIO`, `EIO` or `POLLHUP` means `disconnected`. Only `ENODEV`/`ENXIO` prove removal during line cleanup; EIO/ENOTTY and other failures remain errors. Failed checked cleanup exits while the lease is held.

Metadata listing can report optional `permissionDenied: true` from a read-only access check. Normal doctor names hidraw read/write access plus a udev rule scoped to the observed VID/PID, or ttyACM access plus the port's owning `dialout`/`uucp` group. Open EACCES remains authoritative and returns `permission_denied`, `retry: after_user_action`; lab gives the transport-specific remedy. No rule is installed and no root/world-writable remedy is suggested. `doctor --device-helper-only` performs no discovery and reports prerequisites only.

S60 must still observe the following on an authorized Linux host:

- Moonlander framing, capture/stop/reopen, ordinary typing, unplug and explicit HID reset.
- Glove80 capture with no restart on open/close, exact firmware-observed 1200/1201 baud/DTR transitions and the intended half restarting.
- Permission refusal and remediation on the declared distro, denied nodes, busy tty behavior, and ModemManager interaction. Do not disable ModemManager globally or infer interference without evidence.
- Parent/helper death, removal during read/write/close, firmware timeout and DTR cleanup. PTYs cannot establish USB line-state behavior or OS-initiated DTR during open.
- Installed candidate operation without Rust/development headers, runtime floor, CPU/RSS/start/stop costs and comparison against the legacy transports.

Synthetic sysfs, injected ordering, PTYs and cross-compilation do not close S60 or enable the default.

## Windows has an explicit HID/COM candidate; S61 still gates adoption

```powershell
.\install.ps1 -Version vX.Y.Z -AddToPath
keyloom --version
keyloom doctor --device-helper-only
```

Slice 1 (D-435) defines a Windows x64 release asset with an embedded diagnostics-only MSVC helper. The installer checks `SHA256SUMS` using `Get-FileHash`, installs per-user under `%LOCALAPPDATA%\Programs\keyloom` without elevation, accepts `KEYLOOM_INSTALL_DIR` / `KEYLOOM_DOWNLOAD_BASE`, and changes user PATH only with `-AddToPath`. A locked executable either moves aside or produces a clear close-and-retry message. No Windows signing credential is available; release notes identify unsigned CLI/helper and unmeasured SmartScreen/antivirus behavior. OS protections stay enabled.

Version, doctor, import, layout, boards and change are the slice's installed journey. A central policy returns typed command-specific roadmap errors for build, flash, sync/autosync, lab, keyboard discovery, remap/kanata, emulation and serve. Serve is gated at startup because it owns discovery and auto-sync. `config use`, geometry generation and online board checks are also gated; offline board checks remain available. Doctor reports unavailable components without discovering devices or probing unsupported toolchains.

`windows-2022` builds the pair and runs `scripts/smoke-windows-install.ps1` against a file mirror, with spaces/non-ASCII in the scratch install/cache path and no Rust/Bun/Docker on the runtime PATH. It checks eight concurrent cold launches, version, diagnostics `capabilities: []`, normal doctor, public import/layout/boards/change, typed build refusal, locked update refusal, opt-in PATH idempotence, installer checksum mismatch and cached-helper corruption. These CI checks are configured, not observed on the macOS implementation host; [24f evidence](../research/spikes/device-helper-24f.md) records that limit.

Slice 2 (D-436) implements the explicit candidate:

```powershell
bun scripts/build-binaries.ts --device-backend native --target bun-windows-x64 --out-dir dist/native-windows-candidate
.\dist\native-windows-candidate\keyloom-windows-x64.exe --data-dir "$env:TEMP\keyloom-native-doctor" doctor --device-helper-only
```

Build on Windows x64, or supply a prebuilt target helper for a cross build. The candidate statically selects the combined native adapters and advertises seven capabilities. Default releases keep D-435's refusals. The candidate admits lab recording/listing and reboot-only; Docker/emulation, UF2 operations, kanata, sync, serve and general keyboard detection remain unavailable. Reboot-only for a ZMK half requires `--board moergo/glove80 --half left` or `--half right`; the same restart selector chooses a local 1200 touch or a 1201 relay via the central. Its response includes `transport_only: true`; no UF2 drive is probed and firmware restart is unverified. QMK keeps its existing HID-write/departure check, using the helper's identity view on Windows.

`native-windows` uses SetupAPI/CfgMgr and exactly pinned `windows-sys 0.61.2`. HID caps admit only the vendor collection, 33-byte input/output reports and unnumbered 32-byte arrays. Zero desired access reads caps during discovery; streaming opens share read/write access with Windows. USB identity walks past composite interface nodes to the nearest USB device, without borrowing a hub serial. Unique instance serials retain the keyloom marker; restore only its prefix casing. The opened HID handle's attributes/serial/caps and a repeated COM mapping must match the listing. Instance ID plus interface/COM port is the endpoint key; COM10+ paths are constructed inside Rust.

COM opens exclusively, sets/verifies raw 115200 8N1 with no flow control, sets nonblocking read timeouts, and checks DTR transitions and close. Both touch rates use the same exact-rate/readback/DTR-low/close sequence. HID reads wait 50 ms and allow another 500 ms to confirm targeted cancellation. Writes wait 500 ms and check cancellation immediately, exiting if it is unconfirmed. If a driver retains the operation, the helper exits without unwinding its live buffer/OVERLAPPED or releasing its lease first. Read/write removal errors become `disconnected`. Named mutexes hold endpoint leases across helper processes within the Windows session.

Known keyboard USB devnodes with failed drivers and no usable collection/port yield `driverMissing` diagnostics, refused with `unsupported` on open. Doctor names the in-box HID or USB CDC `usbser.sys` binding. COM open access-denied/sharing-violation means `busy`, with a close-the-other-client remedy. Doctor does not open COM to discover occupancy; it gives the busy hint without pretending an idle listing proves availability. No Zadig, driver replacement or elevation remedy is prescribed.

The separate `device-helper-windows-candidate` job uses `windows-2022` for native clippy/tests and a real installed candidate's discovery-free doctor. It then builds a helper with only `synthetic-windows`, pairs a test-only entry and runs installed CLI HID/serial capture, persistence, stop/reopen, local/relay touch and reboot-only. The entry independently checks the paired helper's synthetic identity before any device request. Only terminal text is scripted: this does not test a real Windows terminal or Ctrl-C. The native candidate never receives a list/open/touch request in CI. [24f slice-2 evidence](../research/spikes/device-helper-24f.md#slice-2-implements-the-native-candidate-without-hardware-evidence) records local compile checks separately from unobserved CI outcomes.

S61 still needs separately authorized Windows hardware:

- Correct Moonlander collection/report lengths, exact USB serial identity and ordinary typing during capture.
- Glove80 in-box CDC binding, COM10+, port renumbering, duplicate/missing serials and a competing serial monitor. Missing/failed-driver findings must match Device Manager.
- Capture, stop/reopen, idle stop, unplug during read/write/close, helper death, parent death, Ctrl-C and suspend/resume, with bounded cleanup and honest incomplete recordings.
- Firmware-observed 1200/1201 baud, DTR order and the intended half restarting. Setter/readback success does not prove the relay reached firmware; open may assert DTR before configuration.
- Runtime/extraction behavior on the supported Windows floor, paths with spaces/non-ASCII, handle/resource measurements and no console-window flash from a UI host.

S61's remaining installed Windows demonstration imports a synthetic/public layout into scratch data, runs doctor, then uses `keyloom lab start <layout>` with explicit hardware permission. It stops and starts a new recording, and exposes interruption honestly after a forced helper exit. Lab replay/analysis may still need unsupported Docker/emulation infrastructure; do not fabricate a successful analysis to complete the demonstration.

A PowerShell install path must check the release checksum, install per-user without elevation, handle `.exe` locking/version coexistence and avoid POSIX shell assumptions. Signing/SmartScreen and antivirus behavior are measured release risks, not reasons to disable OS protections. If code-signing credentials or a native runner are unavailable, record the blocker and keep the target unverified.

## Package two processes as one version

Rung 24b implements Q41's embedded-helper shape for the current Unix CLI targets. `scripts/build-binaries.ts` replaces the source-only packaged module with a static binary-asset import and manifest. Native CI passed paired compiled/installed diagnostics on macOS arm64/x64 and Linux x64. Published v0.46.1 downloads/checksums, arm64 installed helper signature/online notarisation, and the signed/notarised desktop bundle's sidecar doctor also passed in the [release-proof record](../research/spikes/device-helper-24b.md#published-release-proof). No GUI/server or real-data launch was part of that desktop check.

Proposed build flow:

1. Pin Rust in `rust-toolchain.toml`, commit `Cargo.lock`, and build the target helper with locked dependencies on a suitable native CI runner. Inspect crate/transitive licences and produce notices; keyloom's helper remains AGPL-3.0-or-later.
2. Sign the helper where required **before** hashing/embedding it. Record helper SHA-256, release version, target triple and protocol version in a generated manifest.
3. Import the target helper as a binary asset using a build-generated static import. Compile the existing Bun entry with that asset and manifest. Do not build import paths from `import.meta` at runtime or assume Bun's virtual filesystem is executable by the OS.
4. Sign/package the parent and desktop bundle through the existing release chain. Preserve release-please ownership of versions/tags and `SHA256SUMS` for final artifacts. Do not invent a second helper release version.
5. Install from the release artifact, outside the repo with no Rust, node_modules or local helper source. Test extraction, execution, update and rollback. A local `cargo run` is not the shipping check.

Implemented extraction root: `<user-cache>/keyloom/device-helper/<release>/<target>/<sha256>/keyloom-device[.exe]`. Use the existing XDG cache convention on macOS/Linux and a per-user LocalAppData cache on Windows. Directories exclude untrusted writers (0700 on Unix; checked inherited ACLs for the current user, SYSTEM and Administrators on Windows), Unix files are created exclusively in the same directory, verified and atomically published through a no-replace hard link; the temporary name is then removed. The executable is private to its owner. Reject symlink/reparse-point substitution and unexpected owners/permissions; never run an unverified file already at the target path. Test two parents extracting concurrently.

Launch only that verified absolute path. The file hash is an integrity check anchored in the installed host, not protection against a malicious process already controlling the same user account. No PATH/current-directory fallback and no production environment override to an arbitrary executable. Tests inject a fake launcher explicitly.

Keep versions side by side so running Windows executables need not be overwritten and rollback keeps a matching pair. Initial policy keeps extracted versions until explicitly cleaned; cleanup must not delete active helpers. Manifest mismatch or extraction failure disables device operations but leaves layout editing/import available. Give doctor a repair instruction; do not fetch a helper dynamically.

The Unix cache subtree is user-owned, nonsymlink and private (0700), with a 0700 regular executable. Existing general cache ancestors may be 0755 but not writable by other users; canonical OS aliases such as macOS `/var` are accepted. Publication uses an exclusive same-directory temporary file plus atomic no-replace hard link, so concurrent processes never overwrite an executable. Every launch verifies ownership, modes, type, size and SHA-256 again. Unsafe paths and corruption fail closed rather than being silently repaired. Windows uses the same release/target/hash hierarchy under LocalAppData with `keyloom-device.exe`. It checks directory/file reparse attributes through built-in PowerShell/.NET, rejects untrusted owners or write grants outside the current user/SYSTEM/Administrators, and verifies type, file identity, size and SHA-256 before each launch. ACL inspection runs on first use of each path per process; attribute/hash checks repeat. Directories and the temporary exe are created with a protected DACL, and the verified exe is published with a no-replace hard link; a concurrent loser verifies the winner. The windows-2022 CI job exercises this path natively, including eight concurrent cold extractions (D-435).

Native release jobs use macOS arm64, Intel macOS, Ubuntu and Windows 2022 runners. Linux builds a static musl helper; Windows builds the diagnostics-only MSVC helper without a signing credential. A fan-in job collects exactly four CLI binaries and creates the final checksum list. Existing signing secrets are used by `scripts/sign-device-helper.sh` before hashing/embedding: Rust gets hardened runtime and timestamp, no Bun JIT entitlements. When existing notarisation credentials are present the visible helper is submitted separately before embedding; outer Tauri notarisation cannot inspect its hidden bytes. Missing credentials produce explicit warnings, not a signed/notarised claim.

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
