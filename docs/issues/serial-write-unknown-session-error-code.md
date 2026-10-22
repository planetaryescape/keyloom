# A serial write to an unknown session reports invalid_request, not invalid_session

`session.write` looks up the session's transport and falls back to `"hid"` when the session is unknown (`native/device-helper/src/transport.rs`, the `unwrap_or("hid")` in the write handler). The HID field-count check then runs before the unknown-session branch. A well-formed serial write (`sessionId` and `bytes`, no `reportId`) to an expired or unknown session therefore gets `invalid_request` instead of the protocol's `invalid_session` (`docs/blueprint/32-device-helper-protocol.md`).

Both codes refuse the write with `effect: none`, so nothing is sent or replayed. The only cost is a less precise error. Raised by CodeRabbit on PR 150 against code that predates it.

Fix: return `invalid_session` for a well-formed write whose session is unknown, before the per-transport shape check, and keep malformed-request validation as it is. Add a serial test for an expired session.
