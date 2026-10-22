# 31: Rust owns device resources; TypeScript owns the product

Status: D-433 implements the native HID and serial helper as the release default on Apple Silicon Macs. Intel Macs and Linux retain legacy TypeScript transports and diagnostics-only helpers. [S59](../research/spikes/S59.md) records arm64 Moonlander/Glove80 capture, unplug and reopen evidence after D-432. This branch adds combined ownership and explicit 1200/1201-baud touch; physical reset/touch and installed desktop acceptance belong to the orchestrator. [Stage 5 evidence and pending acceptance](../research/spikes/device-helper-native-default.md).

Build a small Rust executable behind the existing HID and serial transport seams. Keep the layout model, validator, agent and application in TypeScript (D-418). The goal is reliable resource ownership and failure handling, not a rewrite or an unmeasured speed claim.

BK's reason: "we've learnt a lot from implementing it so tht could enable us to move faster and avoid some footguns". Reuse the firmware protocols, fixtures and known device behavior. Test the assumptions we have not observed on hardware rather than translating them into Rust and calling them safe (D-419).

## Diagnose the installed pair

```sh
keyloom --data-dir /tmp/keyloom-doctor-scratch doctor --device-helper-only
```

Apple Silicon release builds pair the CLI with `native-macos`: one child advertises three HID capabilities and four serial capabilities, including both touch rates. Doctor verifies the exact pair without device I/O and reports "native backend in use". Intel and Linux pairs advertise no device capabilities and report "diagnostics only". Source invocation reports `not_bundled`.

One lazy app/CLI owner supplies both default transports. Setup failure is latched, unconfirmed cleanup stays visible, and consumer drain precedes child shutdown. The desktop launches the released CLI sidecar; that CLI embeds and owns the same helper. The `native-hid` and `native-serial` build overrides remain available with separate output directories. Neither automatic fallback nor a runtime selector is supported.

The [24c](../research/spikes/device-helper-24c.md) and [24d](../research/spikes/device-helper-24d.md) records preserve development evidence. [D-433](14-decision-log.md#d-433-the-native-helper-is-the-default-on-apple-silicon-intellinux-stay-legacy-until-their-own-hardware-evidence-2026-10-22-stage-5) supersedes their default-selection restrictions for arm64 only. Legacy macOS FFI remains necessary for Intel.

## Scope is device I/O on three operating systems

| In this extension | Stays outside the helper |
|---|---|
| Discover QMK raw-HID endpoints and USB CDC serial ports | General USB/bootloader inventory, board derivation and layout selection |
| Open exact endpoints, own handles, read/write reports or serial bytes | Decode QMK/ZMK event protocols, infer positions, interpret firmware timing |
| Configure safe capture serial settings and explicit baud/DTR touch | Decide whether capture, reboot, sync or flashing is allowed |
| Close/cancel, detect loss, bound buffering and isolate native failures | Build in Docker, invoke flash tools, discover/copy UF2 volumes, verify flashed firmware |
| Implement native macOS, Linux and Windows backends | Port the whole app, desktop shell or kanata to Windows |

D-420 requires Linux and Windows in the design and delivery plan, not an unspecified future possibility. Q37 assumes macOS arm64/x64, Linux x64 and Windows x64 initially. Q38 assumes Windows device support plus a minimal installed CLI journey, not complete product parity. All three platforms must satisfy the same wire contract; capabilities that lack proof remain unavailable.

No BLE transport, general keylogger, OS keyboard hook, input injection, arbitrary device-path opener, privileged service, custom driver installation or independent helper updater is planned.

## The process owns handles, not policy

```text
 React / CLI / agent
          |
 TypeScript app: validation, consent, sync, lab, persistence
          |
 QMK/ZMK protocol encoders and decoders (unchanged authority)
          |
 HidTransport / SerialTransport adapters
          |
 DeviceHelperClient: schema validation, lifecycle, trusted binary
          | private stdin / stdout; bounded diagnostic stderr
 keyloom-device (Rust child)
          |
 single-owner native sessions, bounded I/O and queues
          |
 macOS IOKit / Linux HID+TTY / Windows HID+COM
          |
 keyboard firmware (unchanged)
```

Each CLI or server process lazily owns one helper. The desktop still owns the Bun server, and the server owns the helper; Tauri does not start another copy. Closing a browser tab does not kill an app-owned recording or sync job. On server shutdown, the server drains in-flight lab operations, sync work and manual editor flashes before closing the helper (D-421, D-422).

The helper does not read SQLite, provider credentials, board files or layout revisions. Spawn with a minimal platform environment and private pipes, not inherited secrets or shell interpolation. It binds no socket. A subprocess limits crash propagation; it is not a security sandbox against the same OS user.

### Locations

The diagnostics crate, client/launcher, schema and fixtures now exist. The HID/session and serial implementations are compile-gated. Apple Silicon releases enable both with `native-macos`; Intel and Linux keep diagnostics only (D-433). S59 records the arm64 capture evidence; Stage 5 records touch and release acceptance separately.

| Location | Responsibility | Allowed dependencies |
|---|---|---|
| `native/device-helper/` | One Cargo binary crate; protocol, supervisor, per-platform adapters | Rust libraries and OS APIs; no desktop framework or application model |
| `src/firmware/toolchain/device-helper/` | Diagnostics client, manifest verification, child lifetime and selected HID/serial adapters | Existing toolchain interfaces; protocol schemas; no app or web imports |
| `native/device-helper/protocol/v1.schema.json`, `transport-v1.schema.json` | Diagnostics wire schema and candidate transport supplement | No domain layout schema |
| `test/fixtures/device-helper/` | Synthetic valid/invalid messages and expected effects | Shared by Rust and Bun tests; no real recordings |
| Existing QMK/ZMK capture modules | Firmware commands, parsing, clocks, loss interpretation | Existing transport seam only |

Generate or mechanically check Rust and TS wire representations against the canonical schema; do not maintain unrelated handwritten contracts. Round-trip and rejection tests in both languages are the gate, not successful code generation alone. Keep the browser free of native/process imports through dependency-cruiser.

## Adapt the existing seams rather than expose native machinery

Retain dependency injection through `HidTransport` and `SerialTransport`. Map helper references to the legacy handle/path fields only inside adapters during migration; no caller should derive native identity from their spelling. Change path-shaped serial selection to an opaque reference where needed, and update matching tests. Persist neither references nor sessions.

HID and serial expose awaitable write/close (`Promise<void>`); serial data reaches TypeScript as raw byte chunks and the ZMK capture adapter performs strict streaming UTF-8 decoding with a bounded line framer. The legacy stty/polling adapter remains in use on Intel and Linux. Await ZMK start, keepalive, stop and cleanup writes; a transport error must become an incomplete capture rather than an unhandled rejection. Serialize keepalives so slow writes cannot accumulate them (D-422).

The helper receives firmware bytes from existing encoders. It never sends a start, keepalive, stop or reboot command on its own. On orderly lab stop, TypeScript sends the firmware stop, waits for its bounded response, then awaits transport close. On a crash it cannot promise a stop command was sent; test firmware timeout/DTR behavior and report the interruption (D-423).

Current global sync serialization stays authoritative. Add a cross-process, per-endpoint lease for every helper open, one-shot write and touch, because OS HID access may be shared and CLI/server helpers can coexist. Acquire before device I/O, use OS-released advisory locks on Unix and a user-scoped named mutex on Windows, and release on termination. Derive lease identity from verified native endpoint identity, not the ephemeral wire reference; validate that rule in S58–S62. An active capture returns `busy` to a conflicting sync/reset. No process may steal a session. This lease prevents competing keyloom helpers, not arbitrary third-party programs.

## Experience: keep the machinery out of the way

No new design concept for the private helper: it has no human surface. Q42 assumes the public experience inherits [23](23-design-concept.md), **the keyboard under the light** (D-425). The board, its keys and the user's changes remain the objects people think about.

| Moment | Intended feel and behavior |
|---|---|
| Open keyloom | The same quiet board stage. Starting a helper adds no splash, modal or backend badge |
| Start a recording | The existing lab announces recording only after the firmware start acknowledgment. No green state merely because a process spawned |
| Stop | The existing control stays reachable and briefly says it is stopping. Completion means data is finalized and the transport is closed; no frozen UI while a native read waits |
| Unplug or helper crash | The lab stops, retains the existing local partial-result policy, and clearly labels missing/uncertain data. It offers an explicit new start after reconnect, never automatic recording |
| A write response is lost | Sync says it could not verify the action. Keep the saved layout and last verified device state; do not turn the light green or replay the write |
| Permission denied | Name the keyboard and one platform-specific next step. Logs/OS codes stay under Details or doctor; no generic "Rust helper error" toast |
| Reconnect | Rediscovery is quiet. Active work stays interrupted until the user starts a new session or the existing sync recovery flow establishes a safe next step |

### Three journeys must still join up

1. **Edit to keyboard:** edit/chat -> checked proposal -> Apply -> existing sync -> transport request -> external flash/verification. Moving I/O changes none of the authorization or verification steps. A transport acknowledgment proves only what [32](32-device-helper-protocol.md) says, never that firmware changed.
2. **Record to result:** explicit lab start -> select the exact board/half -> acquire transport -> firmware start -> ordered bytes -> explicit stop -> firmware stop -> closed session -> complete or incomplete local trace. Preserve device clocks and existing dropout warnings. Incomplete traces may be inspected, but must not generate confident timing proposals; wire a conservative analysis refusal through the existing lab API/CLI without dropping evidence.
3. **Diagnose to retry:** doctor identifies a missing/mismatched helper or a permission limitation without device I/O -> user follows a scoped remedy -> doctor/list checks -> user explicitly starts the failed action again. Starting doctor never starts capture or touches the bootloader.

No extra sidebar or notification stack. Reuse the existing lab, sync detail and doctor output. Public wording is constructed in TypeScript from error codes. If UI states change, capture both themes at 1440×900 and 390×844, check reduced motion and keyboard access, and run the existing screenshot gate. Do not invent new motion for a helper restart.

## CLI coverage uses existing commands

Extend `keyloom doctor` with a device-helper check and structured detail: availability, host/helper versions, protocol version, target, supported transport capabilities, and a stable failure code. Preserve its existing table/JSON and exit behavior. A device not attached is not a corrupt helper; successful enumeration does not prove write permission. Unsupported unrelated tools remain separate checks.

The user-facing capture command remains `keyloom lab start <layout>`; it already needs an interactive terminal. Ctrl-C still ends capture. Existing keyboard detection and sync commands consume the adopted adapters where relevant. Do not expose the helper's raw write/touch protocol to the agent or invent a public `keyloom device send` command (D-030, D-422).

Private helper invocation: `keyloom-device --stdio`; `--version` reports manifest identity without loading a transport. Invalid invocation exits 2. Clean EOF/shutdown exits 0; fatal protocol/backend supervisor failure exits 1. The parent treats any unexpected exit, including 0 while requests are active, as failure. All user operations remain verified through the installed `keyloom` CLI.

## Adoption is a recorded decision for each backend

Run phase 0 and rungs 24b–24f in [13](13-roadmap.md). S58 creates the old/new contract corpus. S59–S61 establish native and physical evidence; S62 proves packaging, lifetime and budgets.

Adopt a backend only when:

- Existing app/CLI behavior passes through the installed helper adapter, including permission refusal and interrupted capture.
- The independent protocol corpus agrees on correct behavior. Known old bugs are fixed against specifications, not reproduced for parity.
- Native resource ownership leaves the corresponding TypeScript path; inventory any remaining unsafe Rust/FFI and who owns cleanup.
- Unplug, stop, overflow, parent death, helper death and lost acknowledgments produce bounded, truthful outcomes, with no silent retry.
- A physical-device run authorized in that session confirms report delivery, ordinary typing after stop and the claimed restart behavior. Generic or unavailable boards remain unverified.
- The installed target and applicable desktop bundle pass cold start, concurrent version, update and rollback checks. Record resource costs and justify any material regression.

Keep the legacy implementation as an explicitly selected comparison backend during development, never automatic failover after a possibly effective operation. Production defaults switch per proven backend; remove obsolete FFI/polling code only after its callers and platforms have replacements. Reverting means selecting a prior matched release or changing the default before an operation begins.

If the experiment fails, keep TypeScript and retain the evidence. Fixing a discovered transport bug does not depend on adopting Rust. The decision is whether this helper earns its added process and release work, not whether Rust is generally a better language.
