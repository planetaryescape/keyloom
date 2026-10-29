# Keebart Corne needs its first manual bootloader entry

Status: board support implemented on `fix/keebart-corne`; firmware build and physical acceptance in progress. Baseline `origin/main` at `e894e6dc25bb1c5f658832107f61eea201a6520c`, 2026-10-29. D-460 records the recipe and encoder scope.

The existing `foostan/corne` definition has 42 positions and builds `nice_nano_v2` with `corne_left` and `corne_right` shields. The Keebart Corne Choc Pro BT has 46 positions, with integrated left and right nRF52840 board targets. Its physical layout and targets come from [Keebart/zmk-config at 98c5a118](https://github.com/Keebart/zmk-config/tree/98c5a1181ff7db1f480f684f714126922d55b8f0/boards/arm/corne_choc_pro).

## Factory firmware did not respond to a USB bootloader request

`keyloom keyboard detect` observed `Corne Choc BT`, vendor `0x1d50`, product `0x615e`, alongside the two Glove80 halves. A single 1200-baud touch addressed only the Corne endpoint, selected by its USB IDs and serial identity. The command completed; no KEEBART volume appeared. Device identity remained present afterward. This proves the attempted entry did not produce an available boot drive, not that every firmware variant lacks software entry.

Keebart's supplied guide specifies double-pressing the underside reset button to mount KEEBART. ZMK Studio's [core protocol](https://github.com/zmkfirmware/zmk-studio-messages/blob/main/proto/zmk/core.proto) exposes device info, lock state, locking and settings reset; it supplies no bootloader request. Settings reset was not attempted. Neither Glove80 half was reset or flashed.

## Continue from the prepared firmware

Use the installed CLI's `flash --help` to select the successful build, then connect and enter the bootloader on the right half first and left half second. The recipe names both KEEBART drives and assigns the matching UF2 to each. A mounted bootloader must be identified before copying; never select a drive merely because another keyboard has a similar name.

Acceptance requires both halves to reconnect with the new build markers and the resulting layout to be exercised on the keyboard. A successful compilation or UF2 copy alone does not establish that the layout works. The right half's connection was not independently established from the initial USB inventory.

Private layout exports, device serials and owner photographs remain outside the repository. Local working evidence is in `/tmp/keyloom-keebart`, `/tmp/keyloom-corne-render` and `/tmp/keyloom-corne-*.log`; the prepared layout contains five non-factory layers and eight remapped combos. The explicit transfer preserves custom hold-tap definitions and remaps their position lists; the general cross-board proposal was not used because it omitted native passthrough behaviors.


## Docker compilation outlived the host idle cutoff

The first real build reached C compilation, then `agent-work` terminated it with `no build activity for 180s`. Its idle watcher measures host process-tree CPU and recognizes sccache delegation, but not Docker delegation. `docker top` showed the firmware job working inside its container. The retry sets `AGENT_WORK_IDLE_SECONDS=0` for this single queued build; the five-worker CMake limit and the build's own timeout remain active. No unrelated queue task was cancelled.

## Validation separates board support from physical acceptance

The focused board, geometry, generator, west-build and stage-fit checks passed: 207 tests across 17 files. Type checking passed. The dependency check reported no violations across 691 modules and 2,928 dependencies, but warned that its compiler integration does not support the installed TypeScript 7 version; this limits that check's coverage. The compiled, installed CLI recognizes the attached Keebart by its USB product name and IDs, passes board geometry checking, and generates the transferred layout.

The full suite completed with 3,303 passes, 230 skips and seven failures. Two schema-reference failures were fixed in CONTRIBUTING and pass on rerun. Two five-second timeouts pass in their focused files, and the ambiguous-left-half flash assertion passes alone. One flash-instruction assertion still fails in `test/app/firmware-zmk.test.ts:116`; it also fails from an untouched archive of `origin/main` at `e894e6dc25bb1c5f658832107f61eea201a6520c`. The seventh failure is an unnamed cleanup-hook timeout after the final board-derivation file; those board tests pass in the focused 207-test run. The full suite is not reported as green.

Local logs: `/tmp/keyloom-corne-tests.log`, `/tmp/keyloom-corne-full-tests.log`, `/tmp/keyloom-corne-rechecks.log`, `/tmp/keyloom-corne-ambiguous-test.log`, `/tmp/keyloom-corne-baseline-test.log`, `/tmp/keyloom-corne-types.log`, and `/tmp/keyloom-corne-deps.log`. The render evidence is [the eight viewport captures](../research/ui-audit/keebart-corne/README.md).
