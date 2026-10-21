# A helper that fails to spawn is reported as unconfirmed cleanup

When the candidate native-HID build cannot start its helper process at all, the CLI reports `cleanup_unconfirmed` (exit 1) and tells the person to restart keyloom, although no child process ever existed.

## Where it happens

At `dae7cb2`, `DeviceTransportClient`'s constructor calls `launch(path)` (`src/firmware/toolchain/device-helper/transport-client.ts`, the private constructor) before `connect()` enters its `try`. A synchronous spawn throw therefore skips the handshake cleanup that records `terminated` or `unconfirmed`. It reaches the generic catch in `packagedHidTransport` (`src/firmware/toolchain/device-helper/hid.ts`), which records ownership as `unconfirmed` because it cannot tell whether a child was acquired. `CandidateHidOwner.shutdown()` then throws `HelperCleanupUnconfirmedError`, and `runCli` prints the single `cleanup_unconfirmed` error.

The outcome is pessimistic, not unsafe: no replacement child is started and nothing claims a release that did not happen. But the person is sent to restart keyloom for a failure that a restart won't fix, and the original spawn error is hidden in JSON mode.

## What would fix it

Make a spawn throw distinguishable from a later construction failure: catch it at the launch call and raise `HelperSetupFailure(original, "no_child")`. Then add a test with a launcher that throws synchronously, asserting the original classification survives and no cleanup warning is printed.

A smaller oddity in the same area: `serve.ts` passes both `started.then(() => engine.stop())` and `started.then(() => reviews.stop())` to `drainDeviceConsumers`. If `started` rejects, the same reason appears twice in the resulting `AggregateError`.

Not fixed: found in the 2026-10-21 review of the 24c failure-lifecycle delta (`7a22a1b..dae7cb2`), recorded as should-fix rather than a merge blocker.
