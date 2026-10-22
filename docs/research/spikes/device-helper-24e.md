# Rung 24e implements an explicit Linux candidate; S60 is open

Status: implementation and local synthetic checks complete; pinned Linux CI/runtime results and all physical-device observations remain pending. Ordinary Linux releases remain diagnostics/legacy (D-433/D-434).

Source: uncommitted `feat/device-helper-linux` worktree based on `f6833532e4deaecd76221f4d0b4b4cb84a570d48`, the supplied PR 150 head. GitHub fetch failed (DNS unavailable), so no claim about a newer remote head is made. The orchestrator owns rebase and commit. Date: 2026-10-22, macOS arm64 implementation host, Rust 1.99.1 and Bun 1.3.14.

## Build and diagnose the candidate on Linux x64

```sh
bun scripts/build-binaries.ts --device-backend native --target bun-linux-x64 \
  --out-dir dist/native-linux-candidate
dist/native-linux-candidate/keyloom-linux-x64 --data-dir /tmp/keyloom-linux-doctor \
  doctor --device-helper-only
```

The builder selects `native-linux`, pairs the helper hash/version with the CLI and wires the combined native adapters. A separate output directory is mandatory. Default Linux builds still select `legacy` and an empty-capability helper. Candidate doctor expects all seven capabilities and labels hardware acceptance pending. Helper-only doctor performs no device discovery.

The Ubuntu 22.04 CI job runs musl clippy/tests, builds this candidate, checks that the ELF has neither an interpreter nor dynamic dependencies, then installs it through the real installer into scratch storage. The installed smoke checks eight concurrent cold doctor calls, capabilities, candidate wording, extraction hash, corruption refusal and import after helper failure. It sends no device requests. CI then rebuilds the diagnostics helper before the ordinary release-mapping smoke. These steps are configured, not observed passing by this worker.

## Discovery and framing follow the USB owner and hidraw contract

`linux_sysfs.rs` reads metadata under `/sys/class/hidraw/*/device` and `/sys/class/tty/ttyACM*`, walking to the nearest USB device for VID/PID/serial/product and reading the interface number below it. Missing serial remains absent even when a hub above has one. Resolved sysfs path plus dev node identifies the endpoint; tty renumbering changes the key. No by-id link is required. `hid_linux.rs` reuses the existing conservative QMK descriptor parser.

The [kernel hidraw contract](https://docs.kernel.org/hid/hidraw.html) requires a report-ID byte on output, including zero for an unnumbered report, while unnumbered input starts with payload. The adapter writes 33 bytes and accepts exactly 32 input bytes. A short write fails without sending a tail report. Pure regression tests run on macOS; an additional Linux-only PTY test exercises the actual fd write/read path. No keyboard report delivery was observed.

Both backends open nonblocking descriptors with close-on-exec, verify the opened character device against the dev-node metadata and repeat sysfs discovery before I/O. The shared owner retains leases and bounds output. An indistinguishable reconnect that recreates the same path/metadata remains the S57 limitation.

## Linux owns line control while sharing the portable raw-termios core

`serial_termios.rs` contains the existing macOS raw 115200/8N1 builder and verifier, with platform-specific flow-control masks. Linux configures and reads back termios before asserting and verifying DTR. Touch orders identity recheck, exclusive ownership, exact baud set/readback, DTR-low and one checked close. Post-open serial failures have possible effects and are never replayed.

Linux uses [termios2/BOTHER](https://man7.org/linux/man-pages/man2/TCGETS.2const.html) for integer 1200/1201 speeds rather than passing 1201 to standard `cfsetospeed`. The kernel structure differs from libc termios; the adapter uses libc's separate `termios2` ABI. [TIOCMBIS/TIOCMBIC](https://man7.org/linux/man-pages/man2/TIOCMGET.2const.html) take a pointer to the DTR bit mask; the adapter verifies line state through TIOCMGET. [TIOCEXCL](https://man7.org/linux/man-pages/man2/TIOCEXCL.2const.html) prevents later opens but cannot evict existing holders. Both capture and touch explicitly clear exclusivity before closing. [HUPCL](https://man7.org/linux/man-pages/man3/termios.3.html) would lower modem lines on final close, so capture and touch clear it and own the transition explicitly. No external implementation was copied and no crate/version was added.

Read/write ENODEV/ENXIO/EIO and poll hangup map to disconnected. Line cleanup accepts only ENODEV/ENXIO as proof of removal. EIO, ENOTTY and other line errors fail cleanup; an unconfirmed release exits while retaining the lease. S60 must establish the actual CDC driver's unplug errnos, DTR timing and behavior after parent/helper death. Open can itself assert DTR before configuration, and an early failure can close at an inherited trigger rate. Software ordering does not prove the absence of a firmware restart.

## Permission diagnosis opens no device

A read-only access check can add `permissionDenied: true` to HID/serial list records. The generated supplementary schema and TS adapters retain this advisory hint. Normal doctor names denied hidraw read/write access with the observed VID/PID-scoped udev remedy, or denied ttyACM access with the owning dialout/uucp group remedy. Lab maps authoritative open EACCES to the corresponding instruction; the wire returns `permission_denied`, `retry: after_user_action`. No rule is installed. No root or world-writable-node remedy is suggested.

Bun tests use synthetic endpoints whose open/write/touch methods throw if called; doctor still produces the two remedies. Hints can become stale; the actual open remains authoritative.

## Local checks distinguish pinned results from provisional dependency checks

Pinned repository checks passed:

- `cargo fmt --check`.
- `cargo test --locked --offline`: 10 unit tests plus 3 diagnostics lifetime tests. Portable Linux tests cover fake sysfs, missing/duplicate serials, hub ancestry, tty renumbering, dangling links, unreadable fake nodes, input/output framing and injected touch success/failure/mismatched-rate ordering.
- `cargo clippy --locked --offline --all-targets -- -D warnings` for diagnostics.
- Focused Bun run: 70 passed, 13 skipped, zero failed across nine files. Skips require compiled synthetic helpers or the optional soak/Windows gates.
- `bun run typecheck`; `bun run depcruise` (665 modules, no violations; dependency-cruiser warns that its transpiler range excludes the repository's TypeScript 7).
- Builder guard invocations reject shared `dist`, Linux single-transport macOS features, and a Mac-to-Linux source build without a prebuilt helper.

The repository-pinned native check could not download `libc 0.2.191` and `cfg-if 1.0.5`; the cache has 0.2.190/1.0.4 and crates.io DNS failed. Repository pins and Cargo.lock remain unchanged. A separate `/tmp/keyloom-stage6-compile` manifest points to this worktree's source, selects cached libc 0.2.190 and patches cached cfg-if 1.0.4. With those provisional dependencies:

- Linux musl `cargo check` and all-target clippy with `-D warnings` passed.
- A static musl debug helper and all Linux test executables linked (`cargo test --no-run`). They were not executed on macOS.
- macOS `native-macos` all-target clippy and 34 unit tests passed, including the existing raw-termios/PTY and touch tests after factoring the shared core.

These results do not establish a successful build with the pinned native dependencies. The full Bun suite was submitted through `agent-work`, but the sandbox denied the Pueue socket before execution; focused tests ran directly. No installed Linux candidate, Linux PTY result or CI success is claimed locally.

## S60 needs an authorized Linux host and keyboards

No real device was discovered, opened, touched, restarted or flashed. Unobserved: physical HID read/write framing, Moonlander capture/reset, Glove80 CDC capture and 1200/1201 restart, ordinary typing, busy-port/ModemManager behavior, permission remediation on a distro, unplug errno/close behavior, parent/helper death against firmware, runtime floor and resource comparisons. PTYs cannot establish USB line state.

The exact next action is for the orchestrator to review and commit the uncommitted diff, rebase onto freshly fetched main after PR 150 merges, then run the Ubuntu 22.04 device-helper CI job using the unchanged pins. Record candidate installation/doctor and Linux PTY results in this spike. Keep S60 open and ordinary Linux defaults unchanged until separately authorized physical acceptance. Worker handoff, file map and local logs: `/tmp/keyloom-stage6-worker-report.md`.
