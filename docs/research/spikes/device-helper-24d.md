# 24d has synthetic sessions and a direct macOS serial candidate

Status: D-431 adds a compile-gated direct macOS backend over base `449a4e2fcd4cdf4ac8a82a1ca17ff4083fed969e`. Pure/PTY tests and the arm64 source candidate build/doctor pass. On 2026-10-22, a physical Glove80 capture passed after the D-432 identity and close fixes ([S59](S59.md)); Intel cross-target clippy passes. The slice-2 installed synthetic smoke repeat is blocked by sandbox process introspection. Physical discovery, port access and DTR behavior remain unobserved. The slice-2 section records the current sequence and gates.

Slice-1 status: implementation candidate on `feat/device-helper-serial-synthetic` over `3bf16e4f65fb914287d36f96284f134470b8c2ce`. Rust matrix, full Bun suite and the installed synthetic PTY smoke passed locally on macOS arm64 (2026-10-21). No physical port was enumerated, opened, captured, reset or flashed. No real `serialport` implementation or crate was added.

## Build and exercise the installed candidate with synthetic bytes

These are the acceptance commands; the results observed on 2026-10-21 are under the software checks below. Use pinned Bun 1.3.14 and Rust 1.99.1, `CARGO_NET_OFFLINE=true`, `RUSTC_WRAPPER=` and `CARGO_BUILD_JOBS=5` in the build environment. Queue heavy commands on BK's machine. On Intel use `bun-darwin-x64` and its corresponding output name.

```sh
cd native/device-helper
agent-work run -- cargo build --locked --release --features synthetic-serial-capture
cp target/release/keyloom-device target/keyloom-device-synthetic-serial-capture
codesign --force --sign - target/keyloom-device-synthetic-serial-capture
cd ../..
agent-work run -- bun scripts/build-binaries.ts --target bun-darwin-arm64 \
  --device-backend native-serial --out-dir dist/native-serial-candidate-test \
  --helper "$PWD/native/device-helper/target/keyloom-device-synthetic-serial-capture"
bun scripts/smoke-native-serial-candidate.ts \
  dist/native-serial-candidate-test/keyloom-darwin-arm64 \
  native/device-helper/target/keyloom-device-synthetic-serial-capture
```

Sign the copied helper only after the last Cargo command that could rewrite it. The smoke verifies its synthetic markers and the installed pair's helper hash/serial capabilities before discovery. It imports the public Glove80 template into scratch HOME/cache/data, records twice through a PTY, then kills the owned helper during a third recording. It checks two firmware events per recording, observed child exit, persisted incompleteness and analysis exit 2 containing `recording is incomplete`. The matching macOS CI step builds and checks the serial helper beside the existing HID smoke.

## One owner handles HID reports and serial chunks

`native/device-helper/src/connection.rs` wraps the existing fixed-size HID traits and the new serial traits in small enums. `transport.rs` retains the single session owner, lease-through-close, identity relist, open-before-data acknowledgement, shared sequence, bounded queues, sticky loss, failed/closed ordering and final close receipt. References have per-transport generations; leases include the transport namespace. Synthetic serial and HID cannot coexist in one compiled binary, but reference invalidation is scoped and has a unit test with both namespaces populated.

Serial writes carry strict base64, omit `reportId`, admit 1–4096 decoded bytes and acknowledge exactly that length. Incoming serial data uses the same bounds. HID continues requiring `reportId: 0` and exactly 32 bytes. Serial output holds 16 shared chunks; the backend queue holds at most 16 chunks. The fake generates overflow on demand. The combined native/output data budget remains below the 256-KiB/1024-event ceiling even with encoded frame overhead. HID retains 510 native plus 510 shared reports.

The TS serial adapter encodes UTF-8 once, awaits chunks of at most 4096 bytes in order, checks each accepted length and uses the 500-ms write deadline. An uncertain write prevents later queued writes. The session-aware client rejects wrong-sized HID events before consumer delivery. `setup.ts` shares extraction and ownership receipts; `owner.ts` retains the old HID exports and owns only the statically selected backend. `serial-default.ts` opts in only for `native-serial`, and app cleanup shuts down either candidate. The existing app/lab and ZMK capture implementations needed no edits.

`serial.touch` stays unsupported with no effect in every build. The candidate adapter explains that keyboard restarts are unavailable. Real capture baud/DTR behavior, restart touches, native serial enumeration and other-platform serial remain separate work.

## Software checks pass; none of them is hardware evidence

Observed on macOS arm64 with Rust 1.99.1 and Bun 1.3.14:

- Rust: `cargo fmt --check`; `cargo clippy --locked --all-targets -- -D warnings` and `cargo test --locked` for the default build and for `--features synthetic-hid`, `synthetic-serial` and `native-hid`, all passing. The `synthetic-serial` run executes 7 serial contract tests (`tests/serial.rs`) covering 1/4096/4097-byte boundaries, open before data, wrong-transport writes, a relist making old references stale, a write racing close, overflow during the close drain, a lost write response with exactly one native attempt, and a failed close. A further 7 unit tests in the crate cover scoped reference invalidation and frame bounds.
- The real-child Bun test, with `KEYLOOM_TEST_SYNTHETIC_SERIAL` pointing at a compiled `synthetic-serial` helper: `test/firmware/toolchain/device-helper-serial.test.ts` 11 passed, 0 failed.
- Installed smoke: `scripts/smoke-native-serial-candidate.ts` over a candidate CLI compiled with a `synthetic-serial-capture` helper (helper SHA-256 `92d017c1bde0b2bdec1476d73c49b673e685ac19f7185a689ef43fb9b46e259d`). Doctor reported exactly `["serial.list","serial.open"]`. Two PTY recordings of the imported Glove80 template each saved 2 events with `ended_by: host` and no warnings. A third, interrupted by helper death, saved `Recording incomplete: … helper_exited`, and `lab analyse` refused it with exit 2.
- Full Bun suite: 2,800 passed, 225 skipped, 0 failed; `tsc --noEmit` and `depcruise` passed.
- Regression sensitivity: temporarily removing the client's exact capability-count check made the new handshake test fail; restoring it returned the suite to green.

These checks establish the protocol, adapter and app path against a scripted fake. They establish nothing about a real CDC port, macOS permissions, baud/DTR behaviour or a physical Glove80.

## Implement these traits for the real port in slice 2

Historical slice-1 handoff, superseded by the slice-2 implementation below.

Implement `SerialBackend` and `SerialDevice` in `native/device-helper/src/serial.rs`, then wire a compile-gated real backend into `ConnectionBackend::Serial` in `main.rs`. `SerialBackend::list` returns metadata-only `SerialEndpoint` values; `open(&SerialEndpoint)` returns a device after the existing owner acquires a lease and rechecks identity. `SerialDevice` supplies `write(&[u8])`, timed `read() -> Result<Option<Vec<u8>>, &'static str>`, nonblocking `pending()` and checked `close()`.

Each incoming chunk must contain 1–4096 bytes; retain at most 16 native chunks and report overflow, never silently discard. A successful write means the entire chunk was accepted once. Bound native reads/writes so close and heartbeat supervision remain effective. Keep the lease until close is observed; failed close must not claim release. The TS adapter assumes arbitrary chunk boundaries and byte preservation; strict UTF-8, line limits, firmware semantics and half selection remain in existing ZMK code.

Read the prior platform-continuation audit's serial packet before configuring real ports. Native enumeration must preserve the exact marker `keyloom/NPQRSTVWXYZ0-L`, select the central half independently of list order, and never expose a caller-supplied native path. Baud/DTR/error-cleanup behavior and serialport's close/error limitations still require source and authorized physical evidence. Enable a future `native-serial` Rust feature only with those checks; the builder currently requires a supplied helper because that feature does not exist.

## Slice 2 owns the macOS port with checked transitions

Implementation base: `449a4e2fcd4cdf4ac8a82a1ca17ff4083fed969e` (`origin/main` after PR 144). The slice-2 worker leaves an uncommitted candidate for the orchestrator to review and commit. D-431 replaces the `serialport` macOS candidate with direct IORegistry/POSIX ownership; the slice-1 results and earlier crate comparison above remain historical evidence. Hardware checks remain stopped.

Compile from source without a supplied helper:

```sh
bun scripts/build-binaries.ts --target bun-darwin-arm64 \
  --device-backend native-serial --out-dir dist/native-serial-source-test
dist/native-serial-source-test/keyloom-darwin-arm64 --version
```

Use Rust 1.99.1, Bun 1.3.14, `CARGO_NET_OFFLINE=true`, `RUSTC_WRAPPER=` and five Cargo workers. Native Mac CI runs clippy/tests and the source builder for both Mac targets, then only version and helper-only doctor. The worker's sandbox cannot reach the shared queue socket, so its Cargo commands run directly under the explicit brief exception. Neither native discovery nor a real device command is part of these checks.

### Capture verifies baud before explicitly changing DTR

`registry.rs` owns shared CF/IOKit property and registry-reference lifetimes; HID uses the same helpers. `serial_macos.rs` lists `IOSerialBSDClient` callout paths and walks its registry parents to the nearest USB device, which supplies VID/PID/serial/product; the interface number comes from an entry between the port and that device. A hub further up never lends its serial. It never opens a node during discovery. The opaque endpoint key contains registry ID plus callout path, so path reuse changes identity; equal USB serials do not merge endpoints. Results sort by key and refuse more than 256 endpoints. The device buffers no native chunks; the owner's shared output queue holds at most 16.

The owner acquires its lease and relists before backend open. The backend then performs this sequence:

1. Resolve the registry service by entry ID and compare its endpoint metadata and path with the expected attachment.
2. Open the callout with `O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC`; map permission, busy and disappeared-node errors. Resolve the registry entry ID again and require the full endpoint metadata and callout path to still match before any ioctl or termios call. If it disappeared or changed, perform checked fd-close only and return `stale_device` with `effect: possible`. Only a matching post-open identity proceeds to `TIOCEXCL`.
3. Read termios, apply Darwin `cfmakeraw` behavior, force CS8/no parity/one stop bit, disable software and all Darwin hardware flow control, set `CLOCAL | CREAD`, clear HUPCL and set VMIN/VTIME to zero. Set both speeds to 115200, apply `TCSANOW`, then read back and verify speeds, framing, raw mode, flow control and HUPCL.
4. Check `TIOCSDTR`, then check `TIOCMGET` and require its DTR bit. Only then return the device.
5. On a setup failure before successful baud readback, only close the fd: do not introduce another explicit line transition at an unverified rate. After verified baud, attempt the normal checked DTR-low/exclusive-release/fd-close sequence. If cleanup cannot confirm release, exit the helper while the owner still holds the lease. Otherwise return the original error with `effect: possible`. Pre-open failures retain `effect: none`.

Reads use a 50-ms poll and return at most 4096 bytes. Pending reads use zero-timeout poll and retain no queue. Readable bytes precede a simultaneous hangup; disconnect remains sticky once the bytes drain. Writes use one 500-ms total deadline, advance through partial writes without replaying accepted bytes, and succeed only when the entire input was accepted. A partial write that times out reports failure with possible effects.

Close checks `TIOCCDTR`, attempts `TIOCNXCL` even after a DTR error, and checks fd close even after either ioctl fails. The fd is consumed once and never retried. Any close failure prevents the owner publishing release and causes process exit. Drop only closes an fd left by an abandoned owner; it adds no line transition. No method changes the verified 115200 capture rate. `serial.touch` remains unsupported and absent from capabilities.

The OS may assert DTR during open itself. An early error may close at an inherited 1200/1201 rate before software has established capture settings; HUPCL may also still be inherited then. The helper reports uncertainty, but software ordering cannot prove a half did not restart or what baud/DTR state firmware observed. Driver stalls during setup/close also require native physical observation; bounded polling alone does not certify every driver ioctl.

### Pure tests and PTYs establish software behavior only

- Synthetic registry records cover missing callout/USB metadata, empty serial, duplicate serial numbers, path reuse under a new registry ID, nearest interface, deterministic order and the 256-endpoint bound. An injected resolver changes the registry snapshot between the pre-open and post-open checks: missing entries, reused paths and changed metadata close the newly opened PTY fd without configuration and report `stale_device`/`possible`. Removing the post-open check makes this test fail.
- Pure termios mutation tests reject wrong input/output speeds, framing, raw flags, flow control and HUPCL readback. Injected configuration tests require exclusive/get/set/get/DTR/modem order, stop before DTR on bad readback, and preserve possible effects and the safe-cleanup decision after DTR assertion fails verification. A transport-owner test checks that this effect reaches the wire.
- Injected reads deliver a full 4096-byte chunk and another pending chunk before a simultaneous hangup becomes disconnect. Injected writes cover a partial-progress deadline and advancing through tails. Injected close checks attempt all three release steps after each failure.
- Anonymous `openpty` tests establish actual Darwin raw-mode/115200 readback, byte-preserving read/write, nonblocking pending, idle read polling, and partial-write timeout against a full PTY buffer. This PTY accepted 1022 bytes before requiring a reader, so exact-4096 chunk behavior is tested through injection, not represented as PTY capacity. PTY modem/DTR ioctls return errors; an injected close observer requires one successful close of the owned fd and no second close. It avoids inspecting a closed fd number that another parallel test could reuse. No physical DTR transition was observed.
- Removing HUPCL from the readback mask temporarily made the readback-mismatch test fail; restoring the verifier made it pass. The source-built arm64 candidate compiles without `--helper`, reports version 0.46.1 and helper-only doctor returns exactly `["serial.list","serial.open"]`. Intel cross-target clippy also passes; native Intel execution belongs to CI.

The worker's repeat of `scripts/smoke-native-serial-candidate.ts` reached installed synthetic capture but stopped at the Python driver's child-process assertion: sandboxed `pgrep` returned `Cannot get process list`. The helper hash/synthetic checks, installation and doctor preceded that failure. The slice-1 passing result above is not a passing repeat for this tree. The orchestrator must rerun the unchanged smoke outside this sandbox, together with CI/full-suite acceptance.

Direct optional `libc =0.2.191` reuses the locked definitions for termios, polling and syscalls instead of maintaining target ABI declarations. Its MIT notice already exists in `THIRD-PARTY-NOTICES.txt`; no new crate version or third-party implementation was copied. Darwin flow-control constants missing from libc come from the installed SDK's `sys/termios.h`. `native-serial` fails compilation off macOS rather than advertising a misleading working candidate. Ordinary release builds still use diagnostics/legacy; neither software checks nor successful compilation adopt native serial.
