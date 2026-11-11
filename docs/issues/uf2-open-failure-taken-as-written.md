# A copy that failed on open was taken as written, and the stranded half could not be flashed again

Status: fixed in `2a0f2db9`, with review fixes in `a8e38e1c` (D-498). Tests cover a drive that comes back, one that does not, an interrupted open on a drive that stays, and an open shared drive with the other half running. Not yet seen on hardware with the fix.

Reported 2026-11-11 while flashing the passkey fix to the Keebart Corne (`syn_01M757322D3P4KPQ2EX1VX4P0B`, flash `fl_01M757CB3GQ4MDPX6PNTATECJY`, build `bld_01M757322H9F4K1B4SPSW6QRF1`).

## What happened

From the flash log:

```
keyloom: the right half runs keyloom build Q7P46P9R4FTQ; closing /dev/cu.usbmodem2101 at 1200 baud restarts it into its bootloader
keyloom: KEEBART is mounted at /Volumes/KEEBART; writing
keyloom: copy ended with "EINTR: interrupted system call, open '/Volumes/KEEBART/firmware.uf2'", and KEEBART has unmounted, so the write is taken as done
keyloom: after the flash the right half reports nothing; expected keyloom/1B4SPSW6QRF1-R
```

The error came from `open`, so no byte reached the drive. `KEEBART` was mounted again later, and the right half was still in its bootloader. keyloom's rule from [uf2-copy-enxio-taken-as-done](uf2-copy-enxio-taken-as-done.md) treats any copy error followed by an unmount as the bootloader taking the file, which holds for a write cut off at its end but not for a file never opened.

`keyloom flash --build bld_01M757322H9F4K1B4SPSW6QRF1` then refused: "Not writing to KEEBART: its shared drive could belong to either half. KEEBART is already mounted". The left half was on USB at the time running `keyloom/Q7P46P9R4FTQ-L:1663E2EF7AEFCC10`, so the drive could only be the right half's. The flash was finished by copying `right.uf2` to `KEEBART` by hand; the right half came back as `keyloom/1B4SPSW6QRF1-R:C26DDDEA2A85118A` (its own chip ID), and keyloom then flashed and verified the left half (`fl_01M7582CDWT9M1GNYBJH0YG0S1`).

## Fix

- A write whose error has `syscall: "open"` wrote nothing. If the drive is gone, keyloom waits up to 60 s for it to mount again, rebinds the mount, its identity and the file path, and writes it, at most twice. A shared drive that comes back is written only while every other half is seen running on USB, because a peer entering its bootloader would mount the same label. The sync's open after a full write is not counted. If it does not come back, the flash fails saying nothing was written. An interrupted open on a drive that stays mounted is retried.
- An open shared drive is attributed to the half being flashed when every other half sharing the label is on USB running firmware. A half that is not on USB still leaves the drive unattributed, because a half in its bootloader shows no firmware.
