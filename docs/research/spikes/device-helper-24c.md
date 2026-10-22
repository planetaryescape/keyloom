# Native HID candidate: ownership and interrupted capture

Status: implementation candidate, not adopted. The arm64 physical capture gate passed on 2026-10-22 ([S59](S59.md)); Intel and the default switch remain. Ordinary release builds still use diagnostics-only helpers and legacy TypeScript transports. An explicit compile-time candidate now reaches the real CLI/app HID path. Serial and native Linux/Windows delivery remain required separate slices.

No production native backend discovery, operational open, capture, reset or flash was performed. In the initial full test run, pre-existing legacy HID/serial metadata inventory tests ran before a guard gap was discovered; that incident and correction remain recorded below. All subsequent device journeys used compiled synthetic-only backends.

## Build and exercise the actual CLI without a keyboard

```sh
cd native/device-helper
cargo clippy --locked --all-targets --features native-hid -- -D warnings
cargo test --locked --features native-hid
cargo test --locked --features synthetic-hid -- --nocapture
cargo build --locked --release --target aarch64-apple-darwin --features synthetic-capture
cp target/aarch64-apple-darwin/release/keyloom-device target/keyloom-device-synthetic-capture
codesign --force --sign - target/keyloom-device-synthetic-capture
cd ../..
bun scripts/build-binaries.ts --target bun-darwin-arm64 \
  --device-backend native-hid --out-dir dist/native-candidate-test \
  --helper "$PWD/native/device-helper/target/keyloom-device-synthetic-capture"
bun scripts/smoke-native-hid-candidate.ts \
  dist/native-candidate-test/keyloom-darwin-arm64 \
  native/device-helper/target/keyloom-device-synthetic-capture
```

Use the corresponding x64 target on Intel. `synthetic-capture` includes only the synthetic backend and a fixed two-event firmware passage; it cannot compile with `native-hid`. Before any capture method, the smoke checks `syntheticBackend: true`, `syntheticCapture: true`, and that the installed host's embedded helper hash matches that exact synthetic executable. It installs through the actual installer into scratch paths, then drives real `lab start` commands over an OS PTY: normal stop, a new recording, and helper death. It verifies saved incomplete warnings after reopening the CLI and analysis refusal before replay. It observes helper exit; requesting a kill alone is insufficient. Runtime PATH contains neither Rust nor node_modules. No runtime backend environment variable or executable override exists.

For a separately authorized native experiment, the same builder flag without `--helper` compiles `native-hid`. It requires a Mac target and a separate output directory; ordinary release commands remain unchanged. Building does not authorize invoking that native binary's device methods. Physical capture and reset have separate consent gates.

The static selection module routes `defaultHidTransport()` to one app-owned verified helper lifetime only in candidate builds. CLI `finally` and server drain go through an app lifecycle boundary. Server drain waits for in-flight lab starts and stops, sync work, and manual editor flashes to settle before shutting down the helper. Failed setup, channel loss and failed cleanup do not silently create another helper. Doctor validates exactly the candidate HID capabilities without device discovery; diagnostics-default doctor still requires empty capabilities. The reviewed typed application-error boundary maps only busy/permission refusals to actionable HTTP 409 and CLI exit 2/stable kind; unknown errors stay internal failures. It is app/CLI policy, not Rust policy.

## Backend evidence and Apple API ownership

Both inspected HIDAPI pins silently discard queued macOS input:

| Crate | VCS pin | Archive SHA-256 |
|---|---|---|
| `hidapi 2.6.3` | `ef8ee38edf81d8e48267e6c4f79cda57d8ca225a` | `03b876ecf37e86b359573c16c8366bc3eba52b689884a0fc42ba3f67203d2a8b` |
| `hidapi 2.6.7` | `8729463f8a96b6d4671b7ef114b5ead65ccd7469` | `818c0e1d27887aaf76fe737042e27a66b796a7b099e6d2e1a72d106c2dff3fa6` |

In 2.6.7, `etc/hidapi/mac/hid.c:907–908` calls `return_data(dev, NULL, 0)` once `num_queued > 30`. The shared-device feature changes open exclusivity, not loss reporting. The report-descriptor API requires an opened handle. A hidraw/libusb choice does not fix this macOS callback and libusb risks detaching the keyboard driver. HIDAPI's Rust wrapper is MIT; its bundled C offers GPLv3/BSD/original-HIDAPI options. None of that implementation is copied or compiled here.

The direct adapter reads registry metadata/descriptor without `IOHIDDeviceOpen`, admits only one vendor application collection `ff60:61` with unnumbered 32-byte input/output, and rejects more complex descriptors. It rechecks registry ID, VID/PID/serial/descriptor before and after nonexclusive open. This conservative descriptor admission still needs comparison with the actual board.

Current Apple documentation and the installed official SDK header were checked on 2026-10-21. Registry property creation returns an owned CF object; `core-foundation 0.10.1` wraps the create rule and checks CF types before downcasting. `IOHIDDeviceOpen` documents seize as the explicit exclusive option; this adapter passes none. Runloop scheduling is required for asynchronous callbacks; input buffers are preallocated; unregister callbacks are nullable. The runloop HID APIs used here are available from macOS 10.5 with no deprecation annotation in that SDK. `IORegistryEntryCreateCFProperty` is documented from macOS 10.0. This does not certify a minimum product OS; Bun's own runtime floor remains separate. Dispatch-queue cancellation is an alternative from 10.15, not mixed with this runloop owner.

The owner has separately allocated `Rc<UnsafeCell<...>>` buffer/state. `Rc` also keeps the device non-Send. Callbacks never reconstruct `&mut MacDevice`; temporary state references end before pumping the runloop or calling synchronous native writes. Reference-counted interior-cell allocations avoid relying on a `Box`'s address stability or deep-unique mutable retag as an aliasing proof. Only the owner runloop dispatches these callbacks. Wrong length/ID, removal and callback queue overflow are sticky failures. Close unregisters/unschedules, checks `IOHIDDeviceClose`, then releases the CF object before the lease. If native close fails, the helper exits without I/O rather than publishing release or dropping the lease first; parent EOF marks siblings and outstanding effects unknown. A successful synchronous SetReport has no partial-byte count and never causes a tail retry. Unnumbered IOKit reports do not get the HIDAPI/hidraw prefix.

## Bounded contract

- Each helper receives a 128-bit OS-random nonce through pinned `getrandom 0.3.4`; it prefixes both reference/session IDs. List generations expire unopened references; active sessions survive refresh. Old tokens fail even in raw requests to a new helper, before any native effect. Entropy failure exits before discovery. On macOS the crate uses `getentropy` (available from 10.12), below this candidate's deployment target; no device backend is involved.
- User-owned nonsymlink lease files hold OS `flock` until confirmed handle close. Fixed FNV-1a endpoint-key hashing remains consistent across releases; a collision refuses busy, not selection. This prevents competing helpers, not third-party HID clients.
- Eight sessions, 32 pending requests including pings, 256 endpoints and 256 close tombstones are bounded. A valid metadata list that would exceed the 65536-byte frame returns capacity and exposes no new references; it is never silently truncated or emitted oversized. Control capacity counts actual frames, not batches. Separate native callback/shared IPC queues each hold 510 reports, below the 1024-event/256-KiB ceiling.
- Open response precedes data. Data and terminal events share sequence numbers. Close drains accepted reports, confirms resource release, queues closed/finalSeq under the tombstone lock, then admits repeated-close receipts. Parent close receipts retain no recording callback closures.
- Native reads target 50 ms. Parent list/open/session-write/close deadlines are 5 s/2 s/500 ms/1 s; the one-shot `hid.write` budget is 3.5 s to cover its 2 s open, 500 ms write and 1 s close. Fallback termination waits up to 2 s for observed exit. One-second nonoverlapping pings serve parent liveness. An independent five-second writer-in-progress watchdog cannot be refreshed by those pings. Fatal paths do no diagnostic I/O. No automatic write replay, failover or recording restart exists.
- `transport-v1.schema.json` supplements frozen diagnostics-v1. Regenerate with `bun scripts/gen-device-helper-schema.ts`. Rust/Bun share malformed requests and literal firmware packets. Firmware meaning and timestamps remain TS policy.

## Honest persisted results

For QMK capture, concurrent finish shares one stop/close promise. Keepalives do not accumulate. Missing stop acknowledgement, write/close failure, helper death, sequence gaps and reported drops cannot silently become complete. The existing warnings persist the `Recording incomplete:` marker. Analysis refuses such traces before replay/proposals. CLI sessions JSON/JSONL include `incomplete` and `warnings`; table rows visibly say incomplete. Ordinary unflagged rows say recorded, not a new proof of physical completeness. This evidence does not cover ZMK. ZMK serial interruption classification and persistence were added later on the legacy transport (D-429); the Rust serial backend remains 24d work.

The existing web alert and session refresh show the same saved outcome. The first screenshot batch exposed a phone-hidden alert; the final batch corrected it. [Durable four-theme/width fixture evidence](../ui-audit/device-helper-24c/README.md) records exact UI blob hashes. This is not released-app or physical acceptance.

## Safety correction and verification history

The first full run executed the legacy Mac HID/serial metadata tests, which intentionally left registry listing real. That violated the stricter no-enumeration brief; no IDs were logged and operational writes/capture/touch remained blocked. The run was canceled. The preload now empties direct legacy inventories and permits USB parsing only through registered synthetic profiler fixtures. Explicit current PATH lookup preserves those fixtures. This correction does not retroactively authorize the initial inventory.

The original candidate had one passing whole suite (2738/222 skipped/0 failed) and a later 401-expected/404-received HTTP guard failure. The isolated file passed. Independent frozen-checkout investigation did not reproduce it and introduced no speculative fix. The frozen combined TypeScript source at `f4e4d41` passed 2748 tests, 224 skipped, zero failures (2972 tests/317 files, 161.37 s). The only subsequent code changes move a Rust test module and make the synthetic lost-response marker read its actual atomic counter. Historical success is not a waiver and the historical socket failure is not claimed fixed.

The original supervisor also survived blocked stdout when pings continued. The corrected real-OS-pipe oracle stops every stdout read after open, holds stdin through observed exit, and continues pings. Synthetic-only stderr markers prove the helper received pings, rather than merely counting parent enqueue. The revised oracle first observed 10 pings and exit 1 in 5433 ms; the final native check observed 10 and exit 1 in 5633 ms, both under the unchanged 6500-ms bound. Default diagnostics retain the original three OS-pipe/closed-stderr lifetime tests. Overflow and lost-response tests retain their own explicit failure/effect assertions.

Revised local native checks passed: diagnostics 4 unit/3 lifetime, native feature 6 unit, synthetic feature 7 unit/5 real-child tests; fmt/clippy passed. Final targeted TS passed 32 with one opt-in soak skip across eight files; typecheck, dependency boundaries, workflow syntax and relative links passed. Dependency-cruiser still warns that its TypeScript transpiler does not support this repo's TypeScript major. A fresh synthetic helper measured five threads and three numeric FDs before/after 100 open/close cycles; RSS increased from 2720 to 3280 KiB, so flat memory is not claimed. Two earlier ten-minute streams passed. The revised ten-minute stream delivered 10867 writes/reports without restart (601.73 s), image SHA-256 `c4b3c30e2130820348a020e28893c1413f7f1aa7af560c74ff1b9327048a9550`. That image predates the list-byte guard and actual-counter marker, not the capture/lease/watchdog loop; the final binary is not claimed to have that exact ten-minute receipt. Final current-source native unit/child and actual installed CLI journeys passed separately, including the list bound and counter. The final native production-feature pair's doctor reports exactly the three HID capabilities, without discovery; the ordinary installed build still reports none. The native candidate and synthetic-capture helper passed ad-hoc signature verification, not notarization. Receipts/hashes are in the candidate handoff. No physical CPU/latency/resource comparison is claimed.

Smallest physical gate: separately authorize metadata discovery and capture on one already-compatible Moonlander, synthetic passage/scratch data only, including ordinary typing, idle stop/reopen, unplug, helper/parent death, actual descriptor/framing, permissions and release. Reset is not included. Both Mac architectures need their own installed/native evidence. Do not switch ordinary production defaults or remove old FFI until those gates pass.

## Sources

- [HIDAPI 2.6.7 immutable crate source](https://docs.rs/crate/hidapi/2.6.7/source/etc/hidapi/mac/hid.c)
- [Apple registry property ownership](https://developer.apple.com/documentation/iokit/1514293-ioregistryentrycreatecfproperty)
- [Apple matching-services ownership](https://developer.apple.com/documentation/iokit/1514494-ioservicegetmatchingservices)
- Official installed SDK: `IOKit.framework/Headers/hid/IOHIDDevice.h`, scheduling/callback/close/SetReport declarations and discussions. No SDK implementation was copied.
