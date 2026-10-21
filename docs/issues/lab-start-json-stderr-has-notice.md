# `lab start --format json` puts the privacy notice on stderr before a JSON error

When `keyloom lab start --format json` fails to begin capture (busy, permission denied, restart required), stderr holds the human recording notice followed by the JSON error object. A script that parses the whole stderr stream as one JSON document fails.

## Where it happens

`beginRecording` calls `opts.announce?.(passage)` before `deps.startCapture` (`src/app/lab.ts`, `beginRecording`). That order is deliberate: the person is told before the first key is heard. The CLI's `announce` writes the notice to stderr unconditionally (`src/cli/commands/lab.ts`, the `lab start` action). The existing tests read the error with `err.trim().split("\n").at(-1)`, so they don't catch it.

## What would fix it

Keep the notice before capture, but in JSON mode emit it as part of the structured output (or on stdout as its own JSON line) instead of as plain text on stderr. Then stderr carries only the error object. `lab start` needs an interactive terminal anyway, so this mainly matters for wrappers that capture stderr.

Not fixed: raised by the independent review of the 24c failure-lifecycle delta on 2026-10-21. This behaviour predates that delta.
