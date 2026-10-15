// Preloaded before every test file (bunfig.toml). A test that forgets its fake zapp must hit this
// refusal, never the real one, and a test that forgets its volumes directory must never resolve the
// real mount root: a real flash rewrites the keyboard BK types on.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mock } from "bun:test";
import * as volumes from "../../src/firmware/zmk/volumes.ts";

const dir = mkdtempSync(join(tmpdir(), "keyloom-no-flash-"));
mkdirSync(dir, { recursive: true });
const zapp = join(dir, "zapp");
writeFileSync(zapp, '#!/bin/sh\necho "the real zapp is blocked in tests; pass a fake" >&2\nexit 97\n');
chmodSync(zapp, 0o755);
process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;

// Where a Glove80's boot drive appears on a real machine. Tests give the flash a temporary directory instead.
const REAL_ROOTS = ["/Volumes", "/run/media", "/media", "/mnt"];
const refuse = (what: string): never => {
  throw new Error(`${what}: tests must flash into a temporary directory (pass volumesRoot); the real mount root would write to a real keyboard`);
};

// Bun updates the real module's exports in place when it is mocked, so the real function is kept here first.
const realVolumeFinderAt = volumes.volumeFinderAt;
mock.module("../../src/firmware/zmk/volumes.ts", () => ({
  ...volumes,
  defaultVolumesRoot: () => refuse("defaultVolumesRoot()"),
  defaultVolumeFinder: () => refuse("defaultVolumeFinder()"),
  lsblkFinder: () => refuse("lsblkFinder()"),
  volumeFinderAt: (root: string) => {
    const r = resolve(root);
    if (REAL_ROOTS.some((p) => r === p || r.startsWith(`${p}/`))) refuse(`volumeFinderAt(${root})`);
    return realVolumeFinderAt(root);
  },
}));
