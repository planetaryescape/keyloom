# A locked Mac refuses the boot drive, and keyloom says it didn't appear

macOS doesn't mount a new external drive while the screen is locked. On 2026-10-22 at 17:01, with BK's Mac locked, `keyloom flash` from v0.53.1 (`fl_01M5J5HNFVB5N6AYY1MTXN9Q0S`) restarted the Glove80's right half into its bootloader. Every two seconds the bootloader's drive appeared and was ejected:

```
17:01:48.241 loginwindow  CopySLMountApprovalCallback | DiskArb - Allow = NO
17:01:48.243 loginwindow  CopySLMountApprovalCallback | DiskArb - wholeDisk != nil, calling DADiskEject
17:01:48.264 diskarbitrationd  dispatched response, kind = disk mount approval, dissented, status = 0xF8DA0008
17:01:49.364 diskarbitrationd  ejected disk, success
```

`ioreg -n Root -d1` reported `"CGSSessionScreenIsLocked"=Yes`. keyloom reported "GLV80RHBOOT didn't appear within 15 seconds of restarting the right half", then asked for the bootloader key combination and waited two minutes. Neither helps, because the half was already in its bootloader. The half then stays there, not typing, until the Mac is unlocked and its drive is written. Nothing was written, so its firmware is intact.

A hands-free flash or auto-sync that starts on a locked Mac fails the same way.

Proposed fix:
- Before restarting a half on macOS, check the session's screen-lock state and refuse with "Unlock your Mac first: macOS doesn't mount the keyboard's boot drive while the screen is locked."
- If the Mac locks during the wait, say the same instead of "didn't appear".

Status: open.
