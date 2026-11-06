# A computer that kept a stale pairing retried forever and could never pair again

Status: fixed in `725c067c`; built and flashed 2026-11-06 as `bld_01M6RKSP483Y1ZQ7P46P9R4FTQ` (both halves report that build); the pairing itself is not yet confirmed on hardware.

Reported: "when I try to connect bluetooth on my other computer it just keeps trying and failing". The Corne Choc Pro BT was connected over Bluetooth to Hume at the time. Both halves were on USB later that afternoon, which is how the fix reached them.

## Evidence

- The Corne was connected to Hume at the time: `system_profiler SPBluetoothDataType` listed `Corne Choc BT`, vendor `0x1D50`, product `0x615e`, address `DA:62:AD:CB:C3:C4`, with the HID and BLE services.
- While connected, the keyboard does not advertise, so the other computer cannot see it. A 15-second scan from Kant (`bluetoothctl --timeout 15 scan on`, 2026-11-06 14:16) listed the Glove80 as `EB:B7:AF:61:51:1D` and no `Corne Choc BT` entry. A computer that keeps trying is therefore retrying a device it remembers, not one it just found.
- `zmk/app/src/ble.c` @ `edf5c0814fd3ea202e43aad2d68fd32e882a518c`: `update_advertising` advertises nothing while the active profile's computer is connected; `pairing_allowed_for_current_profile` refuses pairing on a bonded profile unless `CONFIG_BT_SMP_ALLOW_UNAUTH_OVERWRITE` is on and the peer address is that profile's own.
- The flashed build `bld_01M6KFJCFD7P12SJSKF1WV5HCH` had `CONFIG_BT_MAX_PAIRED=6`, `CONFIG_ZMK_SPLIT_BLE_CENTRAL_PERIPHERALS=1` (5 profiles), `# CONFIG_BT_SMP_ALLOW_UNAUTH_OVERWRITE is not set` in its left `.config`. Its keymap carried `&bt_0`–`&bt_3` and `&bt BT_SEL 4` on the setup layer and no `&bt BT_CLR`.

So the reachable failure is: the other computer holds a pairing for a profile the keyboard either does not have bonded (it dropped or cleared its side) or still has bonded to it while another profile is active. In the first case the keyboard rejects the pairing on a taken profile and the computer retries indefinitely; in the second, only selecting that profile on the keyboard reconnects it. Neither can be done from the computer.

## Fix

- `boards/keebart/corne-choc-pro-bt/board.json` now sets `CONFIG_BT_SMP_ALLOW_UNAUTH_OVERWRITE=y`, so a computer can pair again over its own stale entry instead of being refused. This is ZMK's own planned default (`ZMK_BLE_EXPERIMENTAL_SEC` implies it) and the state its test `app/tests/ble/profiles/overwrite-enabled-reconnect-without-bond-then-output-to-selection` covers. The address must still match, so it does not let one computer take another computer's profile.
- The layout's setup layer gained `&bt BT_CLR` ("Unpair") on its unused thumb, beside the profile keys, so a stuck profile can be cleared from the keyboard without a settings erase. The validator's `risky_native` warning applies, as intended (D-451).
- [06-firmware-zmk.md](../blueprint/06-firmware-zmk.md) now states the one-computer-per-profile rule, when the keyboard advertises, and why a stale pairing is refused.

## What this does not fix

A computer that tries to use a profile another computer owns is still refused: that is the one-computer-per-profile design, and the answer is to select another profile on the keyboard. The flag only covers a computer pairing over its own address.

## Verification still to do

The fix was built and flashed. `keyloom build` on the edited layout produced left and right images whose `.config` both contain `CONFIG_BT_SMP_ALLOW_UNAUTH_OVERWRITE=y`, and the generated keymap carries `&bt BT_CLR` on the setup layer. Auto-sync then flashed `bld_01M6RKSP483Y1ZQ7P46P9R4FTQ` over USB to both halves and verified both report it; the Corne reconnected to Hume over Bluetooth afterwards without intervention.

Not observed: a pairing. The remaining check is to forget the keyboard on a computer that had paired it on one profile and pair again from that computer without touching the keyboard; it should pair rather than retry. Then select that profile, press Unpair, and pair afresh. A source check and a successful flash are not a pairing.

One loose end: the build's UF2 archive in `artifacts/` was deleted by mistake during this work, so `keyloom flash --build bld_01M6RKSP483Y1ZQ7P46P9R4FTQ` reports the file is gone. A later sync or build rebuilds it; the keyboard's own proof still names that build.
