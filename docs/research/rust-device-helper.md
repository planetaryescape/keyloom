# A Rust device helper can reuse the protocols, not every implementation detail

Reviewed 2026-10-20. Source baseline: fetched `origin/main` at `7d3ca25981a5213b8aa9e90fcf3330d5272787fd`. Local HEAD advanced during planning to `70eb66ec391017d76b1117fac233c5c39727a026` for unrelated agent UI work; its diff did not change the transport files below. Refresh this comparison before implementation.

This is a source/documentation review, not a hardware experiment. No helper was built, keyboard opened, typing captured, firmware built or device flashed. The proposed design is in [31](../blueprint/31-device-helper.md), [32](../blueprint/32-device-helper-protocol.md) and [33](../blueprint/33-device-helper-platforms.md).

Implementation follow-up: [rung 24b S58/S62 evidence](spikes/device-helper-24b.md) records the later diagnostics-only helper. The source review below is historical; no native HID/serial crate or backend has been adopted.

## How the conversation changed the recommendation

BK first asked whether hindsight justified building keyloom in Rust rather than TypeScript. The assistant recommended retaining TypeScript for the product and considering Rust for native device access. BK then proposed evaluating the helper and adopting it only if reliability justified another executable/release surface.

The assistant initially framed that as a cautious exploratory spike. BK replied: "we've learnt a lot from implementing it so tht could enable us to move faster and avoid some footguns". The assistant revised its emphasis: existing interfaces, firmware protocols, fixtures and failure records make a focused replacement credible. The plan should reuse that knowledge rather than restart discovery. Finally BK requested a blueprint "also include being able to support linux and windows".

These turns authorize planning, not a whole-core rewrite or hardware access. macOS-first sequencing, stdio framing, packaging and rollout details are blueprint assumptions, listed as Q37–Q42. The earlier references to BK's Rust CLIs were language comparisons, not requests to copy those projects. No code from another BK repository is proposed for reuse.

## Native ownership is already substantial

| Source observation | Evidence at the baseline | Consequence |
|---|---|---|
| macOS HID declares native symbols and manually releases Core Foundation/IOKit objects; callback buffer and run loop lifetimes are application-owned | `src/firmware/toolchain/hid-macos.ts:1–217` | A helper could remove this ownership from Bun; a Rust crate may still use unsafe code internally |
| Short Core Foundation strings needed `u64`/BigInt rather than JS-number pointers | `hid-macos.ts:9–11`; recorded crash in D-071 | This is a documented historical failure, not a newly reproduced crash |
| macOS serial repeats registry/property ownership logic | `src/firmware/toolchain/serial-macos.ts:1–103` | Reuse the USB-parent matching knowledge; compare crate enumeration rather than assuming equivalence |
| Linux HID uses sysfs and direct device-node I/O | `src/firmware/toolchain/hid-linux.ts:1–79` | Preserve least-privilege discovery; examine report framing below |
| Linux serial discovers ttyACM ports through USB ancestry and by-id links | `src/firmware/toolchain/serial-linux.ts:1–76` | Stable serials may help selection; a port name is not persistent identity |
| Shared reads poll every 2 ms; synchronous writes retry within a 200 ms budget on EAGAIN | `src/firmware/toolchain/polled-file.ts:1–68` | Event-loop blocking and stop responsiveness are measurement targets, not proven user-visible regressions |
| Serial open configures `stty raw -echo 115200`; touch uses platform-specific stty flags | `src/firmware/toolchain/serial.ts:1–74` | Native Windows needs a different implementation; DTR and arbitrary baud need tests, not a shell translation |
| HID session writes/close may already be async; serial writes/close are synchronous | `hid.ts:18–37`, `serial.ts:18–32` | Migrate serial callers to awaited I/O when introducing IPC |
| QMK capture checks firmware sequence gaps/drop counts; ZMK capture reports firmware DROP lines | `qmk/typing-capture.ts:39–59`, `zmk/typing-capture.ts:41–55` | Preserve those checks in TypeScript; helper sequence numbers measure a different hop |
| Existing hardware capture evidence is incomplete | S50/S51/S53 result sections in [open questions](../blueprint/15-open-questions.md) | Synthetic agreement is not evidence that physical timing, loss or disconnect behavior works |
| No Windows backend exists in the transport selectors; release targets are macOS arm64/x64 and Linux x64 | `hid-default.ts`, `serial-default.ts`, `scripts/build-binaries.ts:11–17`, `install.sh` | A Windows helper alone does not make the whole app a Windows release |

## The Linux report-ID mismatch needs a regression test

The Linux kernel's [hidraw contract](https://docs.kernel.org/hid/hidraw.html) says writes start with the report number, or zero for an unnumbered report. The payload begins at byte two. Reads of unnumbered reports do not have that prefix.

Both current Linux write paths send `report` as-is; the one-shot path explicitly comments that no report ID is needed. The current application contract calls for a 32-byte QMK payload without an ID. This is a source-level mismatch with the OS contract. It is not evidence from an actual Linux keyboard run, and no fix was made during planning.

The [hidapi 2.6.7 write contract](https://docs.rs/hidapi/2.6.7/hidapi/struct.HidDevice.html#method.write) likewise requires the ID byte. The new wire must define payload and report ID separately, then normalize at the native adapter. S58/S60 should compare against this independent specification, not enshrine the old transport's output as a golden truth. A proven independent bug may be fixed in TypeScript without waiting for Rust adoption.

## Candidate libraries narrow the work but do not prove it

| Candidate / primary source | What the source establishes | What remains open |
|---|---|---|
| [hidapi-rs README](https://github.com/ruabmbua/hidapi-rs), [HidDevice 2.6.7](https://docs.rs/hidapi/2.6.7/hidapi/struct.HidDevice.html) | Rust abstraction over HIDAPI; report-ID framing; timed reads; the device is Send but not Sync. Crate metadata declares MIT | Pin backend/features and inspect transitive licences. Verify metadata enumeration, nonexclusive access, write bounds, cancellation, collection filtering and native packaging on each target |
| [serialport-rs README](https://github.com/serialport/serialport-rs), [SerialPort 4.10.1](https://docs.rs/serialport/4.10.1/serialport/trait.SerialPort.html) | Blocking POSIX/Windows interface, RAII close, timeouts, baud and DTR controls. MPL-2.0. macOS lists both callout and dial-in ports. Default Linux enumeration uses libudev; disabling it reduces metadata quality | Test 1201 baud and actual line-state ordering, not only setter success. Avoid duplicate macOS ports. Review distribution/source obligations and Windows backend maintenance; the README requests Windows maintainers |
| [Windows HID API](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/introduction-to-hid-concepts) | Discovery identifies top-level collections; data movement uses HID APIs and ReadFile/WriteFile | Exact QMK collection and lengths, identity joins, permissions and behavior on supported keyboards |
| [Windows cancellation](https://learn.microsoft.com/en-us/windows/win32/fileio/canceling-pending-i-o-operations) | CancelIoEx is not a guarantee; cancellation races with completion, and overlapped storage cannot be reused before completion | Whether the selected crate provides bounded shutdown; if not, isolate/terminate the helper and mark effects unknown rather than claiming cancellation undid them |
| [Windows Usbser.sys](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-driver-installation-based-on-compatible-ids) | In-box CDC driver can bind automatically given the required descriptors/compatible IDs | Actual composite ZMK firmware binding on Windows, COM ancestry and DTR behavior. No blanket driver-install promise |
| [Bun executables](https://bun.sh/docs/bundler/executables) | Embedding binary assets and Windows compile targets are documented. Embedded N-API addons are now documented too | The project's pinned Bun version and release flow must prove extraction/execution/signing; file embedding is not evidence that a native asset can execute directly from Bun's virtual filesystem |

No crate is installed or selected by this review. The versions above identify the fetched API documentation, not a final dependency lock. S62 must commit `Cargo.lock`, an explicit Rust toolchain, backend features and a licence inventory before adoption. Use library APIs first; do not copy upstream source without a licence check, immutable SHA and adaptation comment.

## Reuse map at the fetched source SHA

All paths below are inside keyloom, AGPL-3.0-or-later. Counts are exact for the baseline; check changes after fetching before reuse. Keep one canonical implementation of firmware parsing and application policy.

| Piece | Existing path | Lines | Reuse / adapt |
|---|---|---:|---|
| HID seam | `src/firmware/toolchain/hid.ts` | 40 | Preserve payload contract and dependency injection; map opaque references internally |
| Serial seam | `src/firmware/toolchain/serial.ts` | 74 | Make session write/close awaitable; remove stty only for adopted backends |
| macOS native knowledge | `src/firmware/toolchain/hid-macos.ts`; `serial-macos.ts` | 217; 103 | Identity, properties and lifecycle tests; do not translate pointer declarations mechanically |
| Linux native knowledge | `src/firmware/toolchain/hid-linux.ts`; `serial-linux.ts` | 79; 76 | Matching, permissions and enumeration tests; correct framing from the independent specification |
| Polling behavior | `src/firmware/toolchain/polled-file.ts` | 68 | Characterize fairness, partial writes and cancellation before replacing |
| QMK wire and capture | `src/firmware/qmk/typing-stream.ts`; `typing-capture.ts` | 241; 112 | Keep in TS; retain firmware timing and sequence checks |
| ZMK wire and capture | `src/firmware/zmk/typing-stream.ts`; `typing-capture.ts` | 47; 117 | Keep in TS; await serial writes and preserve chunk-independent parsing |
| Firmware-compatible fakes | `test/helpers/fake-key-stream.ts`; `fake-hid.ts` | 161; 44 | Export synthetic golden traces for both language test suites; keep malformed cases independently specified |
| Hardware guard | `test/helpers/no-real-flash.ts` | 98 | Extend to native process launch; Bun module mocks do not guard Rust by themselves |
| Transport tests | `test/firmware/toolchain/hid-linux.test.ts`; `hid-macos.test.ts`; `serial.test.ts` | 65; 21; 103 | Use existing assertions as a starting point, not proof of hardware fidelity |
| Release builder | `scripts/build-binaries.ts` | 104 | Build/sign/hash helper before embedding target bytes; preserve existing standalone entry paths |
| Desktop packaging | `desktop/tauri/scripts/build.sh`; `desktop/tauri/scripts/fetch-sidecar.sh` | 10; 19 | Build script passes the app version to Tauri; fetch script maps macOS target triples to Bun release assets. Extend that sidecar chain, not a second desktop supervisor |

## What would justify adoption

Compare the same contract through both backends. Record target OS/architecture, keyboard firmware pin, helper/host hashes, crate features, permissions and exact test commands. Separate synthetic, native-OS and physical-device observations.

Required evidence: native handles leave TypeScript on the adopted path; shutdown releases resources or reports a bounded failure; incomplete event delivery is visible; uncertain writes are not retried; existing app/CLI journeys still work; the installed pair survives a cold start, update and rollback. Measure CPU/RSS/start/stop and artifact size, but do not require Rust to win every benchmark to justify a safety improvement. Record regressions and obtain an explicit trade-off decision.

Until those checks pass, this note supports a focused implementation experiment, not a claim that Rust is already more reliable.
