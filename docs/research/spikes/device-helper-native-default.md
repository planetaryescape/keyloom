# Apple Silicon releases select one native HID and serial helper

Status: built on `feat/native-default-apple-silicon` over `bf857e33ce926e332d3a1d9008a4d19fed835607` (v0.48.1). D-433 selects the new default. The orchestrator reran the locked Rust matrix for all eight feature sets, the combined installed smoke and the full suite, and observed a hands-free Glove80 reflash through the native touch (below). [S59](S59.md) remains the source for the arm64 capture, unplug and reopen observations.

## The build target selects the backend

| Bun target | Host selector | Helper features | Capabilities |
|---|---|---|---|
| `bun-darwin-arm64` | `native` | `native-macos` (`native-hid` + `native-serial`) | `hid.list`, `hid.open`, `hid.write`, `serial.list`, `serial.open`, `serial.touch.1200`, `serial.touch.1201` |
| `bun-darwin-x64` | `legacy` | none | diagnostics only |
| `bun-linux-x64` | `legacy` | none | diagnostics only |

The release job builds the selected helper before signing, notarisation, hashing and embedding. The desktop fetches the released CLI unchanged as its sidecar, so it embeds that same helper. The shell starts `serve`; the CLI/server owns the helper. Existing Intel macOS FFI remains in use. Explicit backend overrides, including `legacy`, require a separate output directory. There is no runtime override or automatic fallback.

Both TS adapters share one client and owner. The helper shares references, the eight-session/operation bound, leases and shutdown receipts across both backends. Tokens include transport as well as helper nonce and list generation. HID retains its 510-report output capacity, with serial admission independently capped at 16 chunks in the shared queue. Applying the serial limit to all HID output initially prevented the unread-pipe watchdog oracle from reaching a blocked write; the combined synthetic test exposed this and passed after the separate admission limit.

## Touch verifies baud before lowering DTR

`serial.touch { deviceRef, baud: 1200 | 1201 }` acquires the same endpoint lease as capture, re-enumerates and compares the reference snapshot, re-resolves the exact registry identity before open, and checks it again after open. An active endpoint returns `busy` without opening it. The native backend opens `O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC`, sets both speeds with termios, applies them, reads back both speeds, clears DTR with `TIOCCDTR`, then closes exactly once. It does not restore the old rate or retry.

Before open, errors have `effect: none`. After a successful open, errors have `effect: possible`, including a failed identity recheck or speed verification. `ENXIO` on line control follows D-432; other errors remain failures. An unconfirmed fd close exits the helper while the lease remains held; the parent reports channel failure with possible effects. Successful `{ lineStateApplied: true }` is not a firmware acknowledgement.

The firmware polls DTR-low plus 1200/1201 at 250-ms intervals and debounces for another 250 ms. Software ordering proves neither that the USB driver delivered the unusual 1201 rate nor that the intended half restarted. An OS-initiated DTR assertion during open and early failure at an inherited trigger rate remain possible.

## Software checks have explicit environment limits

The worktree's pinned diagnostics Rust build/tests pass. The first native attempt could not obtain `libc 0.2.191` because crates.io DNS was unavailable; it became cached later in the run. The repository's pins and lock are unchanged. Locked clippy (`-D warnings`) and tests passed for native-hid, native-serial, native-macos, synthetic-hid, synthetic-capture, synthetic-serial, synthetic-serial-capture and synthetic-macos. The default-dist arm64 source build and installed native helper doctor also passed, with all seven capabilities and "native backend in use". Earlier checks against a separate cached-version manifest were supplemental and are superseded by those locked reruns.

The release-mapping arm64 builder embedded the locked combined synthetic helper without an explicit backend override. The real installer smoke passed eight cold/concurrent doctors, all seven capabilities, signature/hash verification, corrupt-cache refusal and import after failure. A separately installed test-only entry passed both touch rates through the production default selectors and shared owner, after independently verifying the paired executable's synthetic identity. The test entry is never used by a release.

In the worker's sandbox the installed CLI/PTY lab smokes stopped at the child-process assertion, because `pgrep` could not list processes there. The orchestrator reran `scripts/smoke-native-combined.ts` outside the sandbox and it passed. On both synthetic transports it covered capture, stop and reopen, helper death saved as incomplete and refused by analysis, and an observed helper exit; touch passed at 1200 and 1201.

```sh
bun scripts/smoke-native-combined.ts <compiled-native-cli> <synthetic-macos-helper>
```

TypeScript and dependency-cruiser passed. The focused helper/lifecycle suite passed 53 tests, with 18 gated checks skipped. The worker's sandboxed full run failed in socket-dependent groups. The orchestrator's unrestricted full run had 2797 passes and 5 failures, all known load-related timeouts (property, `ensureCheckout`, `mountedFiles`; `docs/issues/toolchain-tests-flaky-under-queue-load.md`). CI's full suite is the gate.

## The orchestrator owns physical and desktop acceptance

Physical touch/reset evidence comes from the orchestrator's run, not the implementation worker. On 2026-10-22, 06:11 BST, the release-mapped arm64 build (helper sha256 `0ce6774f…`, seven capabilities, "native backend in use") did the following on BK's Glove80. First, a capture started and stopped cleanly. Second, it reflashed the build both halves were already running (`flash --build bld_01M53EDCCAK3RHBAFNJPGEVV5Y`) hands-free. Each half restarted from its own native 1200-baud touch, took the UF2, and was verified running that build in 22 s (`fl_01M5H0ADAT3TRZ8KB1YNM0K9FJ`). The 1201 relay was not exercised, because both halves were on USB. The Moonlander raw-HID reset through the combined helper was not exercised, because the board was unplugged; S59's HID capture evidence covers the same HID code, which only moved behind the shared owner.

Remaining after this record: the Moonlander raw-HID reset and the 1201 relay through the combined helper, and the installed desktop app path. The supplemental synthetic CLI is a test artifact and is never published.
