# Native HID smoke stopped during process inspection

Status: Candidate test-only fix gives process inspection five seconds. Controlled verification passed. Pending merge and CI.

At `7dad478e8a22e4d1c81eec268c41b8b5c1bae319`, Intel macOS job `132385963111` failed in the installed synthetic-capture smoke. Python raised `TimeoutExpired` because `/usr/bin/pgrep -P 4705` exceeded two seconds. Native compilation, Rust synthetic tests and the earlier TypeScript client contract passed.

The harness reached the capture prompt, then stopped before sending test input. The log does not explain why the runner's process query was slow. No unchanged CI retry ran.

A controlled diagnostic adds a 2.2-second delay before the real process query. The original two-second budget reproduces the timeout through the compiled synthetic helper and a scratch-installed CLI. The diagnostic keeps the original capture and cleanup assertions.

The candidate changes only the process-query budget. The fifteen-second recording deadline, twenty-five-second parent deadline, one-child assertion, observed helper exit, and incomplete-recording checks stay unchanged. The helper identity and embedded hash checks still run before any capture. No device discovery or physical keyboard action belongs to this smoke.

The existing [smoke driver](../../scripts/smoke-native-hid-candidate.ts) requires a CLI compiled with the matching synthetic-capture helper. CI builds that pair before invoking it. The security review ledger retains the failed Intel log and the controlled diagnostic outputs.

With only the process-query budget raised to five seconds, the same delayed diagnostic passes all original assertions. It saves two complete sessions and one incomplete session, observes helper exit, and refuses analysis of the incomplete session. This local arm64 check establishes the budget behavior, not why the Intel runner was slow.
