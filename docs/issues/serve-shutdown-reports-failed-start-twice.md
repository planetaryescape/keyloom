# Server shutdown reports a failed start twice

`serve.ts` passes both `started.then(() => engine.stop())` and `started.then(() => reviews.stop())` to `drainDeviceConsumers` (`src/cli/serve.ts`, the stop hook). If `started` rejects, the same reason appears twice in the resulting `AggregateError`. Cleanup still waits for both and closes the helper afterwards, so this only makes the shutdown error noisier.

## What would fix it

Pass one drain that awaits `started` once and then stops both, while keeping each stop's own failure separate.

Not fixed: found in the 2026-10-21 review of the 24c failure-lifecycle delta. The spawn-classification problem that shared this file was fixed in `b5a3a6d` on PR 141.
