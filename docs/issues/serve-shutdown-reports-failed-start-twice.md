# Server shutdown reports a failed start twice

`serve.ts` passes both `started.then(() => engine.stop())` and `started.then(() => reviews.stop())` to `drainDeviceConsumers` (`src/cli/serve.ts`, the stop hook). If `started` rejects, the same reason appears twice in the resulting `AggregateError`. Cleanup still waits for both and closes the helper afterwards, so this only makes the shutdown error noisier.

## What would fix it

Pass one drain that awaits `started` once and then stops both, while keeping each stop's own failure separate.

Status: fixed in ef2e8f0 (PR 177), released in v0.54.0. Shutdown awaits startup once before draining both engine stops; startup rejection remains visible once, and each stop failure is preserved. `test/cli/serve-shutdown.test.ts` verifies rejected startup alongside helper failure and two independently failing stops.

Found in the 2026-10-21 review of the 24c failure-lifecycle delta. The spawn-classification problem that shared this file was fixed by PR 141 (`da99297` on main).

