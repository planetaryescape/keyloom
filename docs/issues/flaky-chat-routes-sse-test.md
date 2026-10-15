# The chat route SSE test failed once in five full runs

`test/server/chat-routes.test.ts` › "POST streams start, text, tool, proposal and done as SSE" failed once (23 ms) in a full `bun test` run on branch `rung5/integration` at `d084282`, 2026-10-15. It passed alone three times and in four further full runs, so the error text wasn't captured.

What would settle it: run the full suite in a loop with `--bail` and keep the first failing output. Suspects worth checking first: the shared `servers` list and port reuse across test files, and the fake Anthropic script ordering when other files load the machine.

2026-10-15, main `af86c45`: 12 consecutive full `bun test` runs passed while five other agents loaded the machine (outputs kept outside the repo). No failure has been seen since `d084282`. Leave this open; if it fails again, keep that run's full output.

2026-10-15, main `13ea649` plus the fixes branch: `test/server/chat-routes.test.ts` alone, 20 runs under four CPU hogs, 0 failures. The server binds port 0 and the fake Anthropic client has no timers, so neither suspect above fits; nothing on the route or in the test depends on elapsed time. Still no captured failure text, so it stays open.
