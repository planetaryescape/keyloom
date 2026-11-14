# Local container storage removes most warm build overhead

Real scratch-CLI builds on macOS with Colima show faster West and QMK builds when source reads and compiler output stay inside Docker. These measurements use public layouts, pinned sources and fresh build markers. The runs accessed no keyboard.

## Warm builds finish in about 16–27 seconds

| Scenario | Secure baseline | First staged build | Warm build |
|---|---:|---:|---:|
| Keebart Corne Choc Pro BT | 260.53 s | 199.93 s | 25.59 s |
| foostan Corne | 176.43 s | 58.66 s | 18.54 s |
| Moonlander Rev B | 128.76 s | 40.39 s | 16.30 s |
| Glove80 | 23.99 s | 26.85 s, includes new image | 24.96 s |

Keebart also built a changed keymap in 24.69 seconds and a changed idle-timeout setting in 27.17 seconds. Each artifact contains its new build marker. Each build compiled from source with fresh output.

The baseline binary came from `6034e1c22713f40e7ce2f3a91d1a3d30f934cd6d`. The first successful West cache binary came from `fade3a9b5cc68328cc6b233ac2655af23fe81e51`. QMK's first staged build used `96e854149a46c54b4470bd6f39ae5b41810aab33`. Corne's optimized builds, warm Moonlander and bounded Glove80 used `590c4ab7f86d27bf73313d5d4308b4f44d9bdd26`, after dependency PR339 merged.

These elapsed times come from individual runs. They are not controlled statistical estimates. Host loads varied and the harness records them. Downloads and the original images were already warm. “First staged” includes new archives and a Docker volume, but does not represent a fresh installation. No Linux or Docker Desktop performance claim follows from these measurements.

Glove80 already compiles inside Nix storage. Its small timing differences show no clear speed gain. The new `-j2 --cores 2` limit bounds its two derivations to four compiler workers. A Docker process monitor recorded 50 samples and a peak of four compiler processes. A private one-job/five-core experiment took 25.92 seconds and peaked at five workers across 59 samples. That result did not justify changing the agreed two-half schedule.

## Warm sources still produce a fresh build

These measurements distinguish four retained inputs: downloaded repositories, Docker images, host source archives and a completed Docker source volume.
The first staged build can reuse downloads and images while still creating archives and filling the volume.
A warm build reuses the source volume, not compiler output or a previous firmware artifact.
West uses a fresh build directory. QMK copies source into private storage and removes `.build` before Make.

ZMK emulation also retains finished result logs keyed by the generated inputs, emulator scripts, firmware/image identity and resolved dependency manifest.
A result-cache hit skips compilation entirely. Keep that case separate from a warm-source build or an emulation that actually compiles.
[The ZMK guide](../blueprint/06-firmware-zmk.md#emulate-runs-zmk-itself-on-the-host-with-a-mock-keyboard) describes the result cache.

## Source reads caused most of West's overhead

Keebart's first baseline CMake configuration took 77.7 seconds. Moving only output into container storage still took 233.37 seconds overall under higher host load. Moving both source reads and output reduced the first configuration to 2.7 seconds. The second half configured in 1.9 seconds.

The first complete source staging remained costly. Its 199.93-second run spent about 169 seconds preparing sources under recorded high load. Warm builds avoid that work. QMK also avoids copying its full source tree into the host run folder before every build.

## Completed source volumes stay read-only

[D-583 through D-585](../blueprint/14-decision-log.md) retain the source boundaries introduced by D-580 through D-582:

- Host Git reads only trusted pinned snapshots outside writable mounts. Stable debug snapshots never supply later inputs.
- A separate copy container receives individual read-only archives and fills a new Docker volume. It receives no generated firmware source.
- Only successful staging publishes the protected host volume record. The identity includes the pinned source inputs and image.
- West mounts the completed source volume read-only, including its flattened manifest and Git configuration. Generated config, modules and compiler output stay private.
- QMK mounts the source volume read-only, copies it into private storage and adds the guarded generated keymap. Existing artifact and ELF checks remain.
- Each run keeps its unique host path and lock through container exit. Compiler output never populates a future source cache.

A failed or cancelled copy publishes no reusable volume. If Docker prunes a volume, the next build recreates it from trusted archives. A hard process kill can leave an unpublished orphan volume. That orphan is never reused, but occupies space until Docker removes it.

Source archives omit macOS xattrs and ACLs with `COPYFILE_DISABLE=1`. An earlier prototype created AppleDouble `._*.yaml` files that Zephyr tried to parse. Another prototype omitted West's `zephyr.base` setting, so West tried writing into read-only metadata. The v3 cache namespace fixes both observed failures.

## Reproduce through a scratch CLI

Use a compiled CLI built from the candidate and a scratch data directory with a public imported layout:

```sh
AGENT_WORK_IDLE_SECONDS=0 agent-work run -- \
  /path/to/candidate/keyloom --data-dir /path/to/scratch --verbose build <layout>
```

For Moonlander, add `--board-rev revb`. Build the same layout again to measure source-cache reuse. Apply a scratch layout change through the CLI before measuring changed-input behavior. Keep downloads, image setup and first source staging separate from warm results.

The owner's preserved evidence lives in `.orchestrate/keyloom-quality-review/evidence/r2-performance/` beside the repository. `timed-cli-build.py` records the command, binary hash, source identity, host load, append-only build output and real exit code. `verified-speed-artifacts.json` records artifact hashes, UF2 families and marker checks. `binary-source-identities.json` identifies the actual source behind early harness headers that named the checkout. Original logs remain unchanged.

Focused tests cover failed archives, cancellation, publication, pruning and warm reuse. Real Docker probes cover read-only source/Git and orphan workspace isolation. These probes establish mount behavior, while the board builds establish firmware compatibility within their recorded source limits.

## Recheck the implementation without changing the measurements

The build/storage contracts still match release source `b38c0d4a4baff6e23958990dac2f47aa0c839599` (v0.80.6).
This source check adds no new timings or firmware compatibility evidence.
Inspect the publication boundary and the per-run paths from the repository:

```sh
git show b38c0d4a4baff6e23958990dac2f47aa0c839599:src/firmware/toolchain/source-volume.ts
git show b38c0d4a4baff6e23958990dac2f47aa0c839599:src/firmware/toolchain/workspace.ts
git show b38c0d4a4baff6e23958990dac2f47aa0c839599:src/firmware/zmk/west-workspace.ts
```

Read Git metadata only in the repository or trusted source snapshots.
Never run host Git in a debug snapshot or a directory that a firmware container could change.
A pinned HEAD does not make that metadata safe.
The old writable-cache reproduction changed a tracked Makefile and configured host command execution through Git's `core.fsmonitor`.
D-580 removes that trust path rather than checking the old metadata again.
