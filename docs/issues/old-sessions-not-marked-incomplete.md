# Recordings saved before the incomplete marker are not refused

`incompleteRecording()` (`src/firmware/emulate/trace.ts`) recognizes only warnings that start with `Recording incomplete:`. QMK capture adopted that prefix in PR 141, and ZMK capture in D-429. Sessions saved earlier carry the older wording, for example "N report(s) from the keyboard never arrived", "the keyboard dropped N event(s)" and "the keyboard ended the stream early". So they show `incomplete: false` and pass the analysis guard.

That's no worse than before: earlier releases had no guard at all. But a person with older recordings that lost events can still get timing proposals from them.

## What would fix it

Also treat the older loss warnings as incomplete, matching their exact former texts (QMK and ZMK) in one list beside the prefix check, with tests built from those strings. Or migrate stored warnings once. Either way, a recording that is only partly recorded must not become a basis for confident timing advice.

Status: fixed in 3f797d8 (PR 173), released in v0.54.0.
`incompleteRecording()` now recognizes the legacy QMK and ZMK loss-warning text. `bun test test/firmware/emulate/trace.test.ts test/app/lab-interrupted.test.ts` verifies the old messages and confirms an old session is refused before replay.
