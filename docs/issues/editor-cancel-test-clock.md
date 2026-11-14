# Flash cancellation route test depends on a wall-clock window

Status: fixed by `094307f13506bf8f5fe3464b2f4f56c7662fdcad`, merged through PR 341 at `5fdc99eb354689afbf3cc7c49360b2f892f4dc85`. All eight exact-head CI jobs passed.

At `5e7af88f`, CI job `132398562801` timed out the waiting/writing cancellation test after its five-second budget.
Bun reported 13,401 ms elapsed. A later request reached the test server after teardown and returned `ConnectionRefused`.
The log does not establish why the runner delayed execution.
The unchanged file passes in isolation: 30 tests, 135 assertions, zero failures.

The fake enters writing at 400 ms and finishes at 800 ms.
The test sleeps 450 ms before requiring `flash_writing`.
A controlled 900 ms observation delay reproduces `flash_finished`, even with a sufficient overall test budget.
Increasing the budget alone cannot preserve that phase.

The fake now accepts an optional clock. Its default still reads `Date.now()`.
The cancellation test advances its own clock while preserving every real HTTP request and safety assertion.
It needs no sleeps or global clock mock. The test keeps its existing timeout.
Production flash behavior, routes and signing code do not change.
