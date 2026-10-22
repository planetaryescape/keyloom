# keyloom takes a boot drive's mount point before the drive is mounted on it

On macOS, `/Volumes/<label>` appears as an empty directory on the system volume before the UF2 drive is mounted over it. keyloom's volume finder accepted any directory with the label, so it picked up the bare mount point.

Every hands-free Glove80 flash before v0.53.0 opened that directory first, failed with EACCES, and wrote successfully on the retry once the mount landed (`fl_01M5H0ADAT3TRZ8KB1YNM0K9FJ` and `fl_01M5H46GCDD0H58WXKJHV7N30N` each log one refused write). v0.53.0 added the D-438 mount binding, which records the device and inode when the drive appears and refuses a retry if they change. The mount replaced the bare directory's identity, so the retry was refused and nothing was written.

On BK's Glove80 under the published v0.53.0 (`fl_01M5HZ4V726WBAZXY47PYD9C16`, 2026-10-22 15:09), keyloom restarted the right half into its bootloader, logged "GLV80RHBOOT refused the write (EACCES); trying again", then "the mount identity changed at /Volumes/GLV80RHBOOT". The right half stayed in its bootloader with its old firmware. It returned to build BAFNJPGEVV5Y after the same build was copied to the drive by hand.

Polling `stat /Volumes/GLV80RHBOOT` every 100 ms after `keyloom flash --reboot-only --board moergo/glove80 --half right` showed the sequence (macOS 27, FSKit FAT mount):

```
15:13:31.381 absent
15:13:33.452 dev=16777229 ino=563339168        bare directory on the system volume
15:13:33.805 dev=16777238 ino=1                 GLV80RHBOOT mounted (msdos, fskit)
```

Fix: the finder counts a directory only when its device differs from the mount root's (D-439). Tests whose drives are plain folders turn the check off through the test preload; `test/firmware/zmk/mount-binding.test.ts` covers a bare mount point being skipped and a flash that waits for the mount.

Status: fixed on branch `fix-mount-point-wait`. Hardware check pending: a hands-free Glove80 flash from the release that carries the fix.
