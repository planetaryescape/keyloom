# The native kanata bootstrap test exceeded its five-second budget

Status: fixed in test commit `b63e91066eabe6a15c2fd2918e692f3d24a95601`. The patch changes no production service script.

A partial build-speed suite timed out the bootstrap-retry test at 5044.24 ms. Bun killed a dangling process. The delayed assertion then received exit 143 instead of the expected exit 1. The test source at the speed candidate `9a57eda7` matches main `a69ba7c3`.

On main, the original case passed in 2189.37 ms. Both shells exited with the expected codes, 0 and 1. Both output streams closed. The second run includes the production script's real one-second retry.

A controlled diagnostic added a one-second delay to each synthetic `launchctl` call. The original five-second budget failed at 5002.96 ms and killed a child. With the existing `SLOW_RUNNER_MS` budget, the same delayed case passed all five assertions in 7177.16 ms. This establishes the budget boundary. It does not establish why the earlier suite ran slowly.

Only this native test gets the subprocess budget. Its assertions, production retry, and service guards stay unchanged. The final patch omits the diagnostic delay and trace.

Run the complete service test file:

```sh
agent-work run -- bun test test/app/kanata-service.test.ts
```

All 18 tests and 71 assertions passed. TypeScript and the changed-line scan passed. The scripts ran as the test account against temporary files and a fake `launchctl`. No administrator prompt, real service restart, or keyboard action occurred.
