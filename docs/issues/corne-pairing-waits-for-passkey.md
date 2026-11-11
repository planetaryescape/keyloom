# The Corne waited for a typed passkey on every new pairing

Status: fixed in `234c5380` (PR #275), released in v0.73.0. Flashed 2026-11-11 as `bld_01M757322H9F4K1B4SPSW6QRF1`; both halves verified (`fl_01M7582CDWT9M1GNYBJH0YG0S1`), and that build's left and right `.config` have `# CONFIG_ZMK_BLE_PASSKEY_ENTRY is not set`. A pairing on hardware is not yet confirmed. The flash itself stranded the right half; see [uf2-open-failure-taken-as-written](uf2-open-failure-taken-as-written.md).

Reported 2026-11-11: "when i try to connect it spins and spins and then just stops spinning". The Corne Choc Pro BT was on an unused profile, the first computer had stopped receiving keys, and the second computer listed the keyboard under nearby devices.

## Cause

The fix for [a stale pairing](zmk-repairing-rejected-by-taken-profile.md) set `CONFIG_BT_SMP_ALLOW_UNAUTH_OVERWRITE=y` in the Keebart recipe. ZMK's `app/Kconfig` @ `edf5c0814fd3ea202e43aad2d68fd32e882a518c` (lines 182-183) declares:

```
config BT_SMP_ALLOW_UNAUTH_OVERWRITE
    imply ZMK_BLE_PASSKEY_ENTRY
```

So the flag also turned on passkey entry. With it on, `auth_passkey_entry` in `app/src/ble.c` holds the pairing until six digits and Enter are typed on the keyboard, and swallows every other key until then. The computer spins until it times out. keyloom's settings page still showed "Pairing passkey" as off, because the layout has no setting for it and the option's default is off.

On BK's Corne the digits sit on a layer, so the code is hard to type at all.

## Evidence

- The flashed build `bld_01M6RKSP483Y1ZQ7P46P9R4FTQ` (flash `fl_01M6RMKTNPT2FJ41B6QK90YE76`) came from `rev_01M6RKSJVAPP1E5CEXNCRBYAXJ`. The build cache's `corne_choc_pro.conf` names that revision, and its left `.config` has `CONFIG_ZMK_BLE_PASSKEY_ENTRY=y`.
- The layout's settings carry no `CONFIG_ZMK_BLE_PASSKEY_ENTRY`, so nothing but the `imply` turned it on.
- The previous build `bld_01M6KFJCFD7P12SJSKF1WV5HCH` had the overwrite flag off ([earlier issue](zmk-repairing-rejected-by-taken-profile.md)), so nothing implied passkey entry there.

## Fix

`boards/keebart/corne-choc-pro-bt/board.json` sets `CONFIG_ZMK_BLE_PASSKEY_ENTRY=n` after the overwrite flag. `imply` is a weak default, so an explicit `n` wins. The generator writes layout settings after the recipe's lines, so a layout that turns "Pairing passkey" on still gets it; `test/boards/keebart.test.ts` covers both.

## Verification still to do

Select an unused profile and pair a computer without typing anything.
