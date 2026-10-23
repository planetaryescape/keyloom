# ZMK capture waits on serial writes without its own deadline

ZMK capture now awaits every serial write and close (D-429), but it puts no deadline of its own on them. A transport whose `write` or `close` never settles would leave `startZmkCapture` or `finish()` waiting forever.

## Where it happens

In `src/firmware/zmk/typing-capture.ts`:

- `await session.write(TYPING_START)` runs before the two-second start race, so a hung START write is never timed out.
- `finish()` awaits the in-flight keepalive (`await pingWrite`) and the STOP write before its 500 ms OFF race.
- `close()` is awaited without a bound.

QMK capture has the same shape (`src/firmware/qmk/typing-capture.ts`). Today this is safe, because the legacy stty/polling backend's write and close are synchronous underneath and settle immediately. The Rust helper's client enforces its own write and close deadlines (500 ms and 1 s in [32](../blueprint/32-device-helper-protocol.md#backpressure-has-a-failure-outcome)). So the invariant is currently "the transport settles every write and close within its deadline", and nothing in the capture enforces it.

Two smaller gaps in the same lifecycle:

- On a failed start, a rejected `close()` is swallowed to keep the start error primary. The cleanup uncertainty is not reported anywhere.
- After a malformed or overlong line, the capture marks the recording incomplete and closes without sending `KLTYPE STOP`. The firmware stops streaming when its keepalive lapses or DTR drops, but the host doesn't tell it to stop.

## What would fix it

When the Rust serial adapter lands, test a never-settling write and close against the real adapter and confirm its deadline fires. Or add a bounded race in the capture as a backstop for both QMK and ZMK. Report cleanup uncertainty after a failed start alongside the primary error. Send a best-effort STOP before closing on a framing failure, while the port is still alive.

Status: fixed in b0c3ca3 (PR 182), released in v0.54.0.

Both capture readers bound START, keepalive and STOP writes to 750 ms and close to 1250 ms, preserve the start error ahead of cleanup uncertainty, and send a best-effort STOP after a ZMK framing failure. `test/firmware/toolchain/key-capture-deadlines.test.ts` covers never-settling operations, shared finish/close, late completions, helper error precedence and framing cleanup.

Originally recorded as should-fix in the 2026-10-21 review of the 24d TypeScript half.
