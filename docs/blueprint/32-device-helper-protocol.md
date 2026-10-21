# 32: A bounded device protocol with explicit failure

Status: diagnostics-v1 subset shipped in v0.46.1, 2026-10-20 (D-426). Native/full CI, published CLI and signed/notarised desktop-bundle sidecar doctor passed; see the [release-proof record](../research/spikes/device-helper-24b.md#published-release-proof). The HID/session/event subset below has a compile-gated 24c implementation candidate (D-427); its persisted incomplete-recording guarantee is QMK-only. ZMK serial failure classification/persistence remains 24d work, and serial and production adoption remain pending under D-421 to D-424 and Q40. [S58/S62 evidence](../research/spikes/device-helper-24b.md) records local/native-CI and published evidence, plus the remaining hardware and future transport gates. [31](31-device-helper.md) owns scope and experience; [33](33-device-helper-platforms.md) owns OS behavior and shipping.

## Implemented diagnostics subset

`native/device-helper/protocol/v1.schema.json` describes request/response envelopes, with hello parameter/result definitions. Bun tests mechanically compare it with the Zod representations; Rust checks its discriminators/limits and both languages consume the shared adversarial request corpus.

Only `hello`, `ping` and `shutdown` are implemented. Hello returns `{ protocol: 1, helperVersion, target, capabilities: [] }`. Every device/session method returns `unsupported` with `effect: none`; no backend is compiled. Valid envelopes with invalid ping/shutdown params return `invalid_request`. Invalid envelopes, duplicate/nonincreasing IDs, a second hello, wrong ordering or malformed frames terminate the channel. Request IDs are bounded positive u64 decimal strings.

The frame limit is 65,536 bytes **including newline**. The Rust reader admits one queued frame; the supervisor handles requests sequentially. EOF and acknowledged shutdown exit 0; truncated/invalid input and five seconds without protocol activity exit 1. An independent watchdog also ends a blocked stdout writer. Termination requires no diagnostic I/O: a closed or stalled stderr must not prevent fatal exit or kill only the watchdog thread. Temporary process-age instrumentation is removed. The parent still discards any unexpected stderr under a 64-KiB lifetime budget.

Doctor admits one sequential hello/ping/shutdown exchange per child, with a two-second overall deadline. It requires matching response IDs, exact paired identity and empty capabilities, then waits for stdout EOF and exit 0. Failure closes stdin, terminates a still-running child and bounds exit/pipe cleanup waits. It never retries. Multiple doctor calls own independent children.

The [24c candidate](../research/spikes/device-helper-24c.md) implements the HID/session subset behind mutually exclusive `native-hid` and `synthetic-hid` compile-time features. `transport-v1.schema.json` supplements the frozen diagnostics schema; regenerate it with `bun scripts/gen-device-helper-schema.ts`. The native callback and shared IPC data queues hold at most 510 reports each, conservatively below the 1024-event/256-KiB per-session ceiling. A random helper nonce makes raw references/session IDs distinct across child lifetimes. An independent five-second stdout-write watchdog terminates even while parent pings continue. Session/control bounds and parent deadlines below are enforced. Serial methods remain unsupported. Default/release builds still compile only diagnostics; physical and installed native adoption gates have not passed.

## Version 1 uses private JSON lines

Use UTF-8 JSON, one object per newline, over anonymous stdin/stdout pipes. All transport messages go to stdout; bounded structured diagnostics go to stderr. Neither stream is a public HTTP or agent interface. JSON makes the small protocol inspectable and testable; binary framing is deferred until measured throughput requires it.

Every message has `v: 1` and `type`. Request IDs are unique positive decimal strings per helper lifetime. They correlate replies, not idempotency receipts. Device/session IDs are opaque strings allocated by the helper. Counts are nonnegative safe integers; monotonic microseconds use decimal strings to avoid JS integer loss. Binary data is strict base64. No absolute native paths, pointer values or arbitrary command strings are accepted as selectors.

### Proposed common envelopes

```json
{"v":1,"type":"request","id":"1","method":"hello","params":{"protocol":1,"hostVersion":"<release>","target":"<target>"}}
{"v":1,"type":"response","id":"1","ok":true,"result":{"protocol":1,"helperVersion":"<release>","target":"<target>","capabilities":["hid.list","hid.open","hid.write","serial.list","serial.open","serial.touch.1200"]}}
{"v":1,"type":"response","id":"2","ok":false,"error":{"code":"permission_denied","effect":"none","retry":"after_user_action"}}
{"v":1,"type":"event","sessionId":"s1","seq":1,"event":"data","receivedAtUs":"12034","bytes":"AA=="}
```

The data example illustrates the envelope, not a valid 32-byte QMK report. Exact result/params unions are defined by the operation table and implemented in the canonical schema proposed in [31](31-device-helper.md).

- `hello` must be the first request, once only. Refuse any other request before it. Host verifies protocol, exact paired release and target before device discovery; the manifest already verified the helper's file hash.
- Unknown major version, malformed JSON/base64, oversized frame, duplicate request ID or unrecognized discriminator is a protocol failure. Close sessions and exit after a best-effort fatal diagnostic. Do not keep running after message alignment is uncertain.
- Reject unknown methods and invalid parameters with `invalid_request` and `effect: none` when the envelope is valid. Ignore additional response metadata fields, but do not ignore unknown event kinds or capabilities requested by a caller. New behavioral requirements need a version change, not silent interpretation.
- Respond exactly once to each accepted request while the channel lives. A process/channel failure may leave replies absent. Responses can arrive out of request order; each session's native operations remain ordered. Require request IDs to increase numerically on receipt so duplicate detection needs only a high-water mark, not an unbounded history.
- No persistent requests, receipts or session database. Repeating an ID is an error, not a replay mechanism. After a crash, every previous reference and session is invalid.

## The method set stays small

| Method | Parameters | Successful result / effect |
|---|---|---|
| `hello` | `protocol`, `hostVersion`, `target` | `protocol`, `helperVersion`, `target`, implemented `capabilities`; loads no device |
| `ping` | Empty | Empty; refreshes parent liveness |
| `list` | `transport: hid \| serial` | `devices: Device[]`; metadata only, no operational session or line-state change |
| `hid.open` | `deviceRef` | `sessionId`; acquires lease and exact endpoint, begins receiving reports, writes none |
| `hid.write` | `deviceRef`, `reportId: 0`, `bytes` | `acceptedBytes: 32`; one-shot open/write/close with lease, no stream |
| `serial.open` | `deviceRef` | `sessionId`; 115200 baud, raw 8N1, no flow control, capture DTR behavior from platform adapter; no firmware command |
| `serial.touch` | `deviceRef`, `baud: 1200 \| 1201` | `lineStateApplied: true`; executes verified baud/DTR/close sequence, not proof of reboot |
| `session.write` | `sessionId`, `bytes`; HID also requires `reportId: 0` | `acceptedBytes`; serialized native write, not proof that firmware acted |
| `session.close` | `sessionId` | `finalSeq`; closes resources with the ordering below |
| `shutdown` | Empty | Empty after all sessions close; helper exits |

Future transport capabilities are operation-specific: `hid.list`, `hid.open`, `hid.write`, `serial.list`, `serial.open`, `serial.touch.1200`, `serial.touch.1201`. Session write/close follow an admitted open capability. Advertise only enabled, verified operations; a read-only diagnostics build can list without admitting capture or touch. Refuse unavailable operations with `unsupported`; do not substitute another transport. A capability is backend availability, not proof that the attached keyboard runs compatible firmware.

### Device records are endpoint references, not keyboard identities

`Device = { deviceRef, transport, vendorId, productId, serial?, product?, interfaceNumber?, usagePage?, usage? }`. HID requires page/usage fields; serial omits them. IDs are 16-bit integers; metadata strings are bounded to 256 UTF-8 bytes and escaped for display. Missing identity is absent, not invented from a COM number. A raw serial string stays local and is not logged.

HID discovery admits only the QMK vendor-defined usage page `0xff60`, usage `0x61`, with the expected unnumbered 32-byte report shape. Do not open the normal keyboard collection. Serial discovery admits USB-owned CDC endpoints, not arbitrary host serial files or Bluetooth modems. The application still selects the board and correct half using existing matching rules.

The helper maps each reference to native endpoint identity and a metadata snapshot. A subsequent `list` invalidates unopened references from the previous list of that transport; active sessions remain valid. Recheck identity immediately before I/O and against the opened handle where the OS permits. Invalidate on observed removal or metadata change. Refuse `stale_device` on mismatch; never reopen a different endpoint under a reused path/COM number. If the OS cannot disambiguate, return `ambiguous_device` rather than guess. Physical identity across indistinguishable reconnects remains an S57 limitation, not a guarantee of this token scheme.

## Normalize report framing in Rust; decode firmware in TypeScript

The v1 HID payload is exactly 32 bytes without an ID; `reportId` is explicitly zero. Native HIDAPI and Linux hidraw writes need an extra leading zero. macOS direct IOKit uses a separate report-ID argument. Windows report buffers/collection lengths must be normalized by the selected backend. Count `acceptedBytes` in wire payload bytes, not the native prefix. A short HID report write fails; do not send the tail as another report.

Read reports preserve report boundaries. Do not strip a byte from an unnumbered payload just because it is zero. Refuse unexpected report lengths/IDs rather than silently truncate. S58–S61 establish exact native conventions against known firmware packets.

Serial data events carry arbitrary byte chunks, not lines or decoded text. The TS adapter uses streaming UTF-8 decoding and existing line parsers. Test every split point, multiple lines in one chunk, invalid UTF-8 and incomplete trailing lines. Impose a bounded firmware-line accumulator in the TS parser as well; bounded transport chunks alone do not bound an unterminated line. Initial line limit: 4 KiB, then fail the capture as malformed/incomplete rather than drop bytes.

Firmware sequence numbers, DROP messages, device timestamps and wrap handling stay in existing TS readers. Helper `seq` detects missing IPC messages only. It cannot prove that the keyboard produced every physical event. `receivedAtUs` measures receipt relative to helper startup; never substitute it for a firmware event timestamp in typing analysis.

## One owner closes every session

```text
 helper: spawned -> handshaken -> serving -> draining -> exited
                              \-> fatal -----------> exited

 session: opening -> open -> closing -> closed
                    |                 ^
                    +-> failed -------+
```

A session's native handle lives in one worker/owner. Reuse candidate crates' resource ownership; do not put a raw pointer in an RPC table. Timed reads or OS cancellation must let the supervisor receive close while a device is idle. A Rust task cancellation is not proof that a blocking native call stopped.

- Send the open response before any event for that session. Buffer any native data arriving during open within the same bounds; overflow aborts rather than losing the first report.
- All data and terminal events share a per-session `seq` starting at 1. Serialize emission; no duplicates. Sessions may interleave.
- `session.close` is idempotent for a known closed ID. Keep at most 256 closed-session tombstones with their `finalSeq`; an unknown/expired ID is `invalid_session`. The parent caches a completed close so repeated application cleanup does not send another request. Reject new writes as soon as closing begins; settle or fail queued/in-flight writes without claiming they were undone.
- Normal close drains already accepted data, emits one `closed` event with `reason: requested`, then responds with its sequence as `finalSeq`. No later event may reference that session. Parent resolves close only after processing through `finalSeq`.
- Failure emits one `failed` event with an error and a loss state (`none_known`, `detected`, or `unknown`), then one `closed` event with `reason: failed`. Failure state is sticky. If the channel cannot deliver terminal events, EOF/timeout is the terminal fact and loss is `unknown`.
- Parent shutdown attempts existing firmware stop commands in TS, then closes sessions and sends shutdown. Unexpected EOF, a missing heartbeat or a broken stdout terminates the helper's resources without waiting for the web UI.
- No pipe handles may leak into unrelated child processes; otherwise parent death could look like a live connection. Test this on all three systems. Do not rely only on Unix signals; native Windows must meet the same behavior.

The parent owns a watchdog. If close cannot complete, it terminates the helper and waits for process exit; all sibling sessions fail visibly. If even OS termination/handle release cannot be observed within the budget, report the transport unavailable and refuse new operations. Do not claim the device was released or a write canceled merely because kill was requested.

## Backpressure has a failure outcome

Initial budgets are proposal defaults under Q40, not measured performance claims. Freeze their tested values in the wire schema/client before the first release.

| Resource | Initial bound | On exhaustion |
|---|---:|---|
| One JSON line | 64 KiB, including encoded payload | Protocol failure before unbounded allocation |
| Serial data/write chunk | 4 KiB decoded | Reject outgoing oversized chunks; split incoming bytes without reordering |
| Listed endpoints per transport | 256 | `capacity`; never silently omit matching candidates |
| Open sessions / pending requests | 8 / 32 | `capacity`, no device effect |
| Buffered data per session | 256 KiB or 1024 events, whichever comes first | Fail session with detected loss; never silently drop and continue |
| Control/response queue | 64 entries, separate from data | Fatal supervisor failure rather than starving close indefinitely |
| Native read timeout target | 50 ms | Wake owner to process control; S59–S61 must verify actual behavior |
| Hello / list / open / touch deadline | 2 s / 5 s / 2 s / 2 s | Fail or mark uncertain effect as appropriate; no implicit retry |
| Write / orderly close deadline | 500 ms / 1 s | Supervise cancellation; terminate helper if safe completion cannot be established |
| Parent fallback termination wait | 2 s | Report cleanup unconfirmed, refuse new device operations |
| Parent ping / helper liveness timeout | Every 1 s / 5 s without a ping | Close sessions and exit; stalled application must not record indefinitely |
| stderr buffer retained by parent | 64 KiB | Keep bounded sanitized diagnostics, never data payloads |

Control processing must not block on draining stdout or on native reads. Preserve each session's event order while reserving capacity for terminal/control messages. If stdout remains blocked until the liveness deadline, exit; parent marks all outstanding work unknown. Do not promise delivery of an overflow event over a pipe that cannot drain.

## Errors distinguish refusal from uncertainty

`error = { code, effect, retry, osCode? }`. `effect` is `none`, `possible`, or `confirmed_transport_only`. `retry` is `never`, `after_rediscovery`, or `after_user_action`; these are guidance to the application, never permission to replay. Omit free-form device bytes and identifiers from diagnostics.

| Code | Meaning / parent action |
|---|---|
| `permission_denied` | Opening/configuration denied; show platform-specific remedy. If any line state already changed, effect is possible, not none |
| `busy` | Another keyloom lease or OS client owns the endpoint; ask user to stop conflicting work |
| `not_found`, `stale_device`, `ambiguous_device` | Rediscover and require an exact selection before a new action |
| `unsupported`, `invalid_request`, `invalid_session`, `capacity` | Refuse with no effect when no native operation began |
| `io_failed`, `timeout`, `disconnected` | Mark possible effect if a native write/configuration began; preserve the device state as unverified |
| `overflow`, `protocol_error` | Capture is incomplete; stop and retain an explicit reason |
| `helper_unavailable`, `version_mismatch` | Parent-generated installation failure before device I/O |
| `helper_exited` | Parent-generated failure; pending effects may have happened, active capture is incomplete |

An accepted write means the OS/backend reported accepting the complete buffer. It does not mean the keyboard entered its bootloader or changed firmware. A touch success similarly confirms only the line-state operation. Existing TS verification decides the device outcome.

## Tests cross the same seam as the product

Share valid/invalid JSON fixtures and synthetic firmware byte streams across Rust and TS. Include fragmented JSON lines, joined frames, invalid encodings, unknown versions, duplicate IDs, oversized lines, response reordering, data-before-open, trailing events after close, old-session events after restart, short writes and invalid endpoints.

The synthetic native backend must script slow/blocked I/O, disconnect during a write, rejected permission, reused device paths, duplicate serials, overflow, parent death and helper crashes before/after a native effect but before its reply. Assert the native call count: zero for refused actions, exactly one attempt for a lost-response write, and no automatic session restart.

Normal Rust tests use a backend with no OS-device access. Build the synthetic integration helper without production backends, rather than trusting a runtime flag to prevent hardware access. Extend Bun's preload to reject real helper spawning. Assert that raw typing bytes, device serials and command payloads never appear in captured stderr/logs.

Run the existing TS firmware decoder/capture tests through the new adapter as well as in memory. Native CI tests process lifetime and platform APIs; it does not certify physical transport behavior. Authorized hardware evidence and installed-release checks live in [33](33-device-helper-platforms.md).
