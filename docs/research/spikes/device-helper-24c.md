# Native HID candidate: ownership and interrupted capture

Status: implementation candidate, not adopted or physically verified. Production builds still use diagnostics-only helpers and legacy TypeScript transports. No candidate native backend discovery, operational device open, capture, reset or flash was performed. The first full test attempt did execute pre-existing legacy HID and serial metadata-only inventory tests before their guard gap was discovered; the correction is recorded below. Serial and native Linux/Windows delivery remain separate required slices.

## Build and test without a keyboard

```sh
cd native/device-helper
cargo clippy --locked --all-targets --features native-hid -- -D warnings
cargo test --locked --features native-hid
cargo clippy --locked --all-targets --features synthetic-hid -- -D warnings
cargo test --locked --features synthetic-hid
cargo build --locked --features synthetic-hid
cp target/debug/keyloom-device target/debug/keyloom-device-synthetic
cd ../..
KEYLOOM_TEST_SYNTHETIC_HID="$PWD/native/device-helper/target/debug/keyloom-device-synthetic" \
  bun test test/firmware/toolchain/device-helper-hid.test.ts
```

The two features cannot coexist. `synthetic-hid` compiles no production device adapter; its `--version` must report `syntheticBackend: true` before Bun tests admit it. Default tests block the production launcher. Do not run a `native-hid` executable with `--stdio` as an experiment without permission: that feature contains real device operations.

`cargo test` without features retains all original diagnostics real-OS-pipe lifetime tests and their unchanged 6500-ms budget. The feature builds have a separate bounded-output supervisor: control-queue exhaustion is a fatal exit and need not wait for the idle watchdog. They do not reuse the diagnostic-only test's assertion that a blocked writer must survive at least five seconds. The synthetic native overflow test holds a real stdout pipe unread, then resumes reading and requires an ordered `failed(overflow, detected)` followed by `closed(failed)`.

## Why the adapter is direct IOKit

The inspected `hidapi 2.6.3` crate has archive SHA-256 `03b876ecf37e86b359573c16c8366bc3eba52b689884a0fc42ba3f67203d2a8b` and VCS pin `ef8ee38edf81d8e48267e6c4f79cda57d8ca225a`. Its Rust wrapper is MIT; bundled HIDAPI offers GPLv3/BSD/original-HIDAPI alternatives. No HIDAPI source is copied or compiled here.

Its macOS callback in `etc/hidapi/mac/hid.c` silently removes an older input report once its internal queue exceeds roughly 30 reports. Its report-descriptor API also needs an opened handle. Those are concrete mismatches with metadata-only discovery and explicit capture loss. The shared-device feature addresses nonexclusive open, not silent loss. A hidraw/libusb feature would not fix this macOS queue; libusb also risks disturbing the keyboard driver. We therefore use the platform APIs directly, with `core-foundation 0.10.1` for CF ownership rather than copying the C implementation.

`macos.rs` reads IORegistry properties and the descriptor without calling `IOHIDDeviceOpen`. Admission requires the vendor application usage `ff60:61`, exactly one unnumbered 32-byte input and output report, and no feature reports or global push/pop. More complicated descriptors are refused, not guessed. This conservative admission still needs comparison with the actual board descriptor.

An owner thread resolves the exact registry ID, compares VID/PID/serial/descriptor before open and again afterward, and opens nonexclusively. Its timed CF runloop invokes bounded callbacks on that same thread. Stable boxed `UnsafeCell` buffers/state permit callback mutation without holding Rust references across the runloop call. Removal, wrong report ID/length and queue overflow are sticky failures. The owner unregisters callbacks, unschedules the runloop and closes/releases the native object before dropping its lease. Direct IOKit writes pass the report ID separately; unlike HIDAPI/hidraw, they must not add a prefix byte. `IOHIDDeviceSetReport` exposes success/error, not a partial-byte count; there is no tail retry.

## Implemented contract

- Opaque list generations invalidate old unopened references. A refresh preserves active sessions. Rechecking the selected immutable registry ID avoids reopening a reused caller path.
- Unix owner-only, nonsymlink lease files use OS-released `flock`, held until the native handle is dropped. A fixed FNV-1a endpoint-key hash names locks consistently across helper releases; a collision refuses busy rather than selecting a device. The lease prevents competing helpers, not third-party HID clients.
- One owner serializes reads, writes and close. Eight sessions, 32 pending requests, 256 listed endpoints and 256 closed tombstones are bounded. Control and data queues are separate. Native callback and IPC queues each hold at most 510 reports, below the combined 1024-event/256-KiB budget; the IPC data budget is shared across sessions and is deliberately stricter than the per-session ceiling.
- Open waits for the writer to publish its response before reading events. Data and terminal events share sequence numbers. Close drains accepted reports, drops the handle/lease, then sends `closed` and a matching `finalSeq`. A repeated closed ID is idempotent. New writes are rejected as soon as close is admitted.
- Native reads target 50 ms. Parent list/open/write/close deadlines are 5 s/2 s/500 ms/1 s. Deadline or malformed channel failure terminates the child, waits up to 2 s for exit, fails siblings and latches the client unavailable. There is no restart, failover or write replay. The helper's no-I/O watchdog requires hello/ping activity within five seconds; the parent sends nonoverlapping one-second heartbeats.
- `transport-v1.schema.json` supplements the frozen diagnostics schema. Regenerate it with `bun scripts/gen-device-helper-schema.ts`. Bun mechanically compares the generated schema; Rust and Bun consume the same malformed-operation corpus. Firmware decoding remains in TypeScript.

The explicit `packagedHidTransport()` factory verifies/extracts the installed pair through the existing manifest/hash boundary. A diagnostics-only pair refuses its required HID capabilities. The factory is not selected by `hid-default.ts`, and the release builder still compiles without features. Installed native selection, the doctor capability transition, applicable signing/desktop evidence and removal of the old FFI path remain adoption work, not implied by this factory.

## Interrupted recordings

QMK finish caches its promise, so concurrent callers send one stop/close and receive the same trace. Keepalives never overlap or accumulate; finish waits for an admitted keepalive before stopping. A missing stop acknowledgement, stop-write failure, native/session error or close failure cannot return `endedBy: host`. Firmware sequence gaps/drop reports and interrupted termination add `Recording incomplete:` warnings.

The existing persistence schema stores those warnings alongside partial events. Analysis refuses such a saved trace before constructing a replay or proposing changes. The current web problem alert displays that refusal and explains that the partial recording remains saved; the sessions list refreshes even after refused analysis. Selecting a saved incomplete session reaches the same refusal. There is no new helper screen, visual component or automatic recording restart. CLI immediate output retains the non-host `ended_by`; saved warnings retain the reason after reopening.

## Test-guard correction

The first full-suite attempt ran the pre-existing `hid-macos.test.ts` and `serial.test.ts` metadata tests, which intentionally left IORegistry listing real. That was not authorized by the stricter no-enumeration brief. Their pass lines are recorded; no device identifiers or recordings are retained. Operational HID writes/capture/serial touch remained blocked by the preload. The owned full run was canceled after discovery of this gap.

The preload now supplies empty legacy HID/serial buses and refuses real USB inventory. Only profiler scripts registered by `fakeBinDir` may reach the USB parser. The first blanket USB guard incorrectly hid those fixtures; a further correction passes the current PATH explicitly to `Bun.which`, as the existing subprocess runner already does. Focused firmware/doctor checks then passed. The final full-suite result must be checked independently. These changes prevent a repeated metadata experiment; they do not retroactively authorize the initial one.

## Observed evidence and remaining gates

Local macOS arm64 checks established compilation, five native-feature unit tests, five synthetic-feature unit tests and three synthetic real-child tests. Targeted Bun tests cover cross-process busy with zero refused native opens, malformed/stale references with zero effects, leading-zero report preservation, lost acknowledgement with exactly one native write attempt, ordered overflow, response reordering, data-before-open, missing sequence, malformed data, trailing events, pending capacity, QMK device clocks, concurrent finish and 100 explicit open/close cycles. These observations do not establish electrical framing, permission behavior, native handle counts or physical reliability.

Local final checks: feature-only clippy passed; native-feature unit tests passed 5/0, synthetic unit tests 6/0 and synthetic real-child tests 3/0. The targeted Bun suite passed 23 with one opt-in soak skip across five files. Two separately run ten-minute synthetic streams passed with 10,576 and 10,725 writes/reports respectively. A fresh synthetic process measured four threads and three numeric file descriptors both before and after 100 open/close cycles; RSS rose from 2688 to 3232 KiB, so flat memory is not claimed. Native hardware resource behavior and CPU/latency comparisons remain unmeasured.

One guarded whole suite passed 2738/222 skipped/0 failed (166.77 s). A final frozen-source suite returned 2739/223 skipped/1 failed (214.02 s): the pre-existing keyboard HTTP guard test expected 401 but received 404. Its isolated six-test file passed; the cause is not established and this candidate is not merge-ready while that full-check discrepancy remains unresolved. A synthetic native rerun also collided with the concurrently running soak's lease; after the soak ended, all native tests passed without weakening the lease or replaying a write.

The rebuilt diagnostics-default CLI passed the actual scratch installer, eight cold concurrent doctors, corruption refusal and import afterward, without Rust/node_modules on runtime PATH. This verifies the retained packaging path, not installed native selection. Screenshots were inspected in both themes at 1440×900 and 390×844; the first batch exposed a phone-hidden error, and the final batch confirmed the existing alert on both widths. Desktop/phone SSR regressions, contrast tests and the mechanical design detector passed. Final raw logs and exact hashes live in the run-owned `stage24c` evidence directory. A failing or unrun gate is not converted to a pass.

Smallest physical gate: separately authorize metadata discovery and nonexclusive capture of one already-compatible Moonlander on the named macOS host, using only a synthetic passage and scratch data. Check ordinary typing before/during/after, stop/reopen, idle stop, unplug and helper/parent death, plus actual descriptor/framing/permission behavior and process resource release. No reset is included. One-shot reset needs its own explicit permission. Both advertised Mac architectures need their own native/installed evidence; Linux/Windows remain unverified. Do not enable a production default until the installed native selection and these gates pass.
