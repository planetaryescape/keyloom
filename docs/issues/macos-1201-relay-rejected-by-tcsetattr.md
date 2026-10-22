# The 1201 relay fails on macOS because tcsetattr refuses the rate

When a Glove80 half has no keyloom serial port of its own, keyloom asks the left half to restart it over the split link by closing the left half's port at 1201 baud (D-133). On macOS that touch never worked.

On 2026-10-22 at 20:20, with the right half's cable unplugged, `keyloom flash --reboot-only --board moergo/glove80 --half right` from the installed v0.53.1 chose the relay ("closing the left half's … at 1201 baud asks it to restart the right half"). It then failed with "keyboard connection: io_failed".

Setting the rate by hand on the left half's port showed why:

```
tcsetattr(ispeed=ospeed=1201)  -> EINVAL (Invalid argument); readback stays 9600
ioctl(IOSSIOSPEED, 1201)       -> ok; tcgetattr readback 1201/1201
```

`stty -f <port> 1201` fails the same way ("stty: tcsetattr: Invalid argument"), so the legacy route Intel Macs still use is broken too.

Closing the left half's port after `IOSSIOSPEED` 1201 restarted the right half into its bootloader within about 3 seconds while the left half kept running, both with the right half's cable plugged in (20:25) and through the fixed helper (20:45, `lineStateApplied: true`, GLV80RHBOOT mounted at 20:45:08).

Fix (D-440): the native macOS touch sets the speed with `IOSSIOSPEED`, then verifies both speeds with `tcgetattr` as before.

Status: fixed in d9d7f81 (PR 165), released in v0.53.2, for the native helper on Apple Silicon. Intel Macs still touch through `stty` and keep the bug until they move to the native helper. Not yet observed: the relay through the installed v0.53.2 with the right half on battery.
