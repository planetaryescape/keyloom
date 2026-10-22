# `lab start --format json` puts the privacy notice on stderr before a JSON error

When `keyloom lab start --format json` fails to begin capture (busy, permission denied, restart required), stderr holds the human recording notice followed by the JSON error object. A script that parses the whole stderr stream as one JSON document fails.

## Where it happens

`beginRecording` calls `opts.announce?.(passage)` before `deps.startCapture` (`src/app/lab.ts`, `beginRecording`). That order is deliberate: the person is told before the first key is heard. The CLI's `announce` writes the notice to stderr unconditionally (`src/cli/commands/lab.ts`, the `lab start` action). The existing tests read the error with `err.trim().split("\n").at(-1)`, so they don't catch it.

## What would fix it

Keep the notice before capture, but in JSON mode emit it as part of the structured output (or on stdout as its own JSON line) instead of as plain text on stderr. Then stderr carries only the error object. `lab start` needs an interactive terminal anyway, so this mainly matters for wrappers that capture stderr.

Status: fixed on branch fix/lab-json-notice. JSON and JSONL now emit the notice as a stdout JSON record before capture starts, leaving stderr as the structured error document; table mode keeps its stderr notice. `bun test test/cli/lab-device-errors.test.ts test/cli/lab.test.ts test/cli/cleanup-json.test.ts` covers both formats, pre-capture ordering, table output and successful recordings.
