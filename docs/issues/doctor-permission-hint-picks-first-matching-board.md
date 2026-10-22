# Doctor can report another board's permission state when two identical boards are attached

`src/app/keyboard.ts` picks the first listed endpoint matching the board's VID/PID when it reads the Linux permission hint for doctor. With two identical keyboards attached, one readable and one not, doctor can attach the wrong board's access state to the board it is describing.

Only the diagnosis is affected: opening still uses the selected endpoint and reports its own `permission_denied`. Raised by Codex in the PR 152 round-2 review.

Fix: match on the running firmware's USB serial (the keyloom marker) when one is present, and fall back to VID/PID only when no serial is available.

Status: fixed on branch fix/doctor-permission-match. Doctor now selects the matching raw HID serial before falling back to VID/PID, and reports mixed permission states without guessing. `bun test test/app/device-permissions.test.ts` covers serial match, serial-less fallback and disagreement.
