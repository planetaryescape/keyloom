# 24d slice 1 records a synthetic Glove80 through the installed Rust helper

Status: implementation candidate on `feat/device-helper-serial-synthetic` over `3bf16e4f65fb914287d36f96284f134470b8c2ce`. Rust matrix, full Bun suite and the installed synthetic PTY smoke passed locally on macOS arm64 (2026-10-21). No physical port was enumerated, opened, captured, reset or flashed. No real `serialport` implementation or crate was added.

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

Implement `SerialBackend` and `SerialDevice` in `native/device-helper/src/serial.rs`, then wire a compile-gated real backend into `ConnectionBackend::Serial` in `main.rs`. `SerialBackend::list` returns metadata-only `SerialEndpoint` values; `open(&SerialEndpoint)` returns a device after the existing owner acquires a lease and rechecks identity. `SerialDevice` supplies `write(&[u8])`, timed `read() -> Result<Option<Vec<u8>>, &'static str>`, nonblocking `pending()` and checked `close()`.

Each incoming chunk must contain 1–4096 bytes; retain at most 16 native chunks and report overflow, never silently discard. A successful write means the entire chunk was accepted once. Bound native reads/writes so close and heartbeat supervision remain effective. Keep the lease until close is observed; failed close must not claim release. The TS adapter assumes arbitrary chunk boundaries and byte preservation; strict UTF-8, line limits, firmware semantics and half selection remain in existing ZMK code.

Read the prior platform-continuation audit's serial packet before configuring real ports. Native enumeration must preserve the exact marker `keyloom/NPQRSTVWXYZ0-L`, select the central half independently of list order, and never expose a caller-supplied native path. Baud/DTR/error-cleanup behavior and serialport's close/error limitations still require source and authorized physical evidence. Enable a future `native-serial` Rust feature only with those checks; the builder currently requires a supplied helper because that feature does not exist.
