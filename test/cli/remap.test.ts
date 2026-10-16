// keyloom remap and keyloom sync on the MacBook (21): setup without root, the doctor, apply through sync, Disable remapping and the
// exit-chord proof, against a fake kanata and a temporary home folder.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import type { DoctorProbe } from "../../src/firmware/kanata/doctor.ts";
import { getBoardSync } from "../../src/persistence/syncs.ts";
import { MAC, remapperWorld } from "../helpers/remapper-world.ts";

// The real kanata folder, as it is before these tests run. BK's own install may live there, so the check is that nothing changed, not
// that it is empty: every path with its size and mtime, compared at the end.
const REAL_KANATA = join(process.env.HOME ?? "", "Library", "Application Support", "kanata");

function snapshot(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const stat = lstatSync(path);
      out[path] = `${stat.isDirectory() ? "dir" : stat.isSymbolicLink() ? "link" : "file"} ${stat.size} ${stat.mtimeMs}`;
      if (stat.isDirectory()) walk(path);
    }
  };
  out[dir] = `dir ${lstatSync(dir).mtimeMs}`;
  walk(dir);
  return out;
}

const realKanataBefore = snapshot(REAL_KANATA);

let w: ReturnType<typeof remapperWorld> | undefined;
afterEach(async () => {
  await w?.stopAll();
  w = undefined;
});

async function cli(world: ReturnType<typeof remapperWorld>, args: string[], probe?: DoctorProbe) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  const code = await runCli([...args, "--data-dir", world.app.dataDir], io, {}, { remapper: { ...world.over, ...(probe ? { probe } : {}) } }, world.deps);
  return { code, out, err };
}

const machine = (over: Partial<Record<string, { code: number; out: string }>> = {}): DoctorProbe => ({
  kanataBin: () => undefined,
  kanataVersion: async () => undefined,
  exec: async (cmd) => over[cmd[0] as string] ?? { code: 1, out: "" },
  exists: () => false,
  readText: async () => undefined,
  hello: async () => {
    throw new Error("connection refused");
  },
});

describe("keyloom remap", () => {
  test("setup writes the plist and an identity config in keyloom's folder, and prints the one root command without running it", async () => {
    const world = (w = remapperWorld());
    const r = await cli(world, ["remap", "setup", "--format", "json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.root_command).toMatch(/^sudo sh -c 'cp ".*dev\.keyloom\.kanata\.plist" \/Library\/LaunchDaemons\//);
    expect(out.plist_path.startsWith(world.home)).toBe(true);
    const plist = readFileSync(out.plist_path, "utf8");
    expect(plist).toContain("127.0.0.1:5829");
    expect(plist).toContain("--release-grab-on-lock");
    // Stopped by the exit chord stays stopped: launchd restarts only after a crash.
    expect(plist).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/);
    expect(plist).not.toMatch(/cmd|danger-enable/);
  });

  test("the doctor on a machine with nothing installed says what is missing and prints the root command", async () => {
    const world = (w = remapperWorld());
    const r = await cli(world, ["remap", "doctor", "--format", "json"], machine());
    const out = JSON.parse(r.out);
    const byName = Object.fromEntries(out.findings.map((f: { name: string; status: string }) => [f.name, f.status]));
    expect(byName["kanata"]).toBe("fail");
    expect(byName["Karabiner VirtualHID driver"]).toBe("fail");
    expect(byName["LaunchDaemon"]).toBe("fail");
    expect(out.root_command).toContain("launchctl bootstrap system");
  });

  test("the doctor warns that Karabiner-Elements 16.x breaks kanata 1.12, and knows the driver pairs", async () => {
    const world = (w = remapperWorld());
    const probe: DoctorProbe = {
      ...machine({ pkgutil: { code: 0, out: "version: 6.5.0\n" }, ioreg: { code: 0, out: '"Product" = "Apple Internal Keyboard / Trackpad"' } }),
      kanataBin: () => "/opt/homebrew/bin/kanata",
      kanataVersion: async () => "1.12.0",
      readText: async (p) => (p.endsWith("Info.plist") ? "<key>CFBundleShortVersionString</key>\n<string>16.3.0</string>" : undefined),
    };
    const r = await cli(world, ["remap", "doctor", "--format", "json"], probe);
    const f = JSON.parse(r.out).findings as Array<{ name: string; status: string; detail: string }>;
    expect(f.find((x) => x.name === "kanata")?.status).toBe("ok");
    expect(f.find((x) => x.name === "Karabiner VirtualHID driver")).toMatchObject({ status: "ok" });
    expect(f.find((x) => x.name === "Karabiner-Elements")?.detail).toContain("can't use");
    expect(f.find((x) => x.name === "built-in keyboard")?.status).toBe("ok");
  });

  test("a driver of the wrong protocol is a failure that names both protocols", async () => {
    const world = (w = remapperWorld());
    const probe: DoctorProbe = { ...machine({ pkgutil: { code: 0, out: "version: 8.5.0\n" } }), kanataBin: () => "/k", kanataVersion: async () => "1.12.0" };
    const f = JSON.parse((await cli(world, ["remap", "doctor", "--format", "json"], probe)).out).findings as Array<{ name: string; status: string; detail: string }>;
    expect(f.find((x) => x.name === "Karabiner VirtualHID driver")).toMatchObject({ status: "fail", detail: expect.stringContaining("protocol 7") });
  });

  test("sync puts the head on kanata and says it verified; Disable remapping and sync turn it off and on", async () => {
    const world = (w = remapperWorld());
    const sync = await cli(world, ["sync", world.layoutId, "--format", "json"]);
    expect(sync.code).toBe(0);
    expect(JSON.parse(sync.out)).toMatchObject({ status: "synced", board_id: MAC });
    expect(readFileSync(world.paths.kbd, "utf8")).toContain("keyloom-rev_");
    const off = await cli(world, ["remap", "disable", "--format", "json"]);
    expect(off.code).toBe(0);
    expect(world.fake.running()).toBe(world.paths.safe);
    const status = await cli(world, ["sync", "status", "--format", "json"]);
    expect(JSON.parse(status.out).boards[0]).toMatchObject({ state: "behind", why: "remapping_off" });
    const on = await cli(world, ["sync", world.layoutId, "--format", "json"]);
    expect(on.code).toBe(0);
    expect(world.fake.running()).toBe(world.paths.kbd);
  });

  test("confirm-exit-chord is what lets auto-apply turn on", async () => {
    const world = (w = remapperWorld());
    expect((await cli(world, ["autosync", "on", MAC])).code).not.toBe(0);
    expect((await cli(world, ["remap", "confirm-exit-chord"])).code).toBe(0);
    expect(getBoardSync(world.app.db, MAC).provenAt).not.toBeNull();
    expect((await cli(world, ["autosync", "on", MAC])).code).toBe(0);
  });

  test("disable with kanata not running fails with the way out", async () => {
    const world = (w = remapperWorld());
    world.fake.stop();
    const r = await cli(world, ["remap", "disable"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("Left Control + Space + Escape");
  });

  test("nothing in these tests touched the real home folder", () => {
    expect(snapshot(REAL_KANATA)).toEqual(realKanataBefore);
  });
});
