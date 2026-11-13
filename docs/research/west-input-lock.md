# West dependencies no longer resolve mutable branches

D-581 locks ZMK v0.3.0's 39 active projects. The emitted manifest contains no imports or mutable revisions.
The Corne and Keebart recipes retain their source, image, targets, hardware module, and RGB module pins.

## The lock comes from exact upstream manifests

The inputs are:

- [ZMK app/west.yml at edf5c081](https://github.com/zmkfirmware/zmk/blob/edf5c0814fd3ea202e43aad2d68fd32e882a518c/app/west.yml).
- [Zephyr west.yml at dacab487](https://github.com/zmkfirmware/zephyr/blob/dacab4875df72109b96cc8977547a0dc04875bcd/west.yml).
- [Zephyr's optional submanifest at the same commit](https://github.com/zmkfirmware/zephyr/blob/dacab4875df72109b96cc8977547a0dc04875bcd/submanifests/optional.yaml).

The resolver ran in the recipe's digest-pinned ZMK image.
West's `Manifest.from_data` and `as_dict(active_only=True)` produced the project list.
The Zephyr project used its full SHA instead of `v3.5.0+zmk-fixes` during resolution.
The optional submanifest supplied no additional active projects. ZMK's nanopb project overrides Zephyr's optional nanopb entry.
ZMK's blocklist and Zephyr's disabled `optional` and `babblesim` groups remain effective.

The Keebart hardware and RGB modules do not import manifests in the build recipe.
Their pinned `zephyr/module.yml` files declare module build settings, without further source dependencies.

## Real builds verify source and package behavior

The saved successful Keebart baseline took 411933 ms at `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`.
Its scratch Zephyr HEAD file records `dacab4875df72109b96cc8977547a0dc04875bcd`, and its VERSION file says 3.5.0.
Those old writable files are supporting observations. They do not establish trust in the new cache.
The new cache fetches every project from its repository at the locked commit.

Focused checks verify immutable revisions, module preservation, cache identity, discarded writable metadata, and read-only mount arguments.
At candidate `2e847a8f`, both west recipes fetched every pinned input, then failed at `west zephyr-export`. The pinned export script writes `current_path.txt` beside itself, which a read-only source mount correctly rejects. Builds now set the pinned `ZEPHYR_BASE` and pass its exact `Zephyr_DIR` to CMake. They do not run package registration. A real CMake package lookup against the read-only pin succeeded with those explicit paths. Both firmware builds still need to pass after that correction.
No keyboard flash or hardware behavior is part of these checks.

## Update the lock with reviewed inputs

Resolve the new ZMK manifest with Zephyr fixed to a reviewed full commit.
Use West's own resolver and preserve its active project selection.
Review every remaining project's full revision, URL, path, and west command declaration.
Write the flattened projects into `src/firmware/zmk/west-inputs.json`, with the matching `zmkSha`.
Then run the focused workspace tests and both supported board builds through the scratch CLI.
A new source SHA does not inherit the old dependency lock automatically.
