// The setup doctor for the MacBook remapper (21): reads the kanata and driver versions, whether the daemon is installed and
// listening, and prints the one command BK has to run as root. Everything here only reads; it starts nothing, writes nothing
// and never asks for sudo (D-231). The probe is injectable, so tests describe a machine instead of being on one.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type KanataEndpoint, hello } from "./client.ts";
import { type KanataBoardRevision } from "./board-config.ts";
import { findKanata, kanataVersion } from "./binary.ts";
import { DAEMON_LABEL, DAEMON_PLIST_PATH } from "./plist.ts";
import type { RemapperPaths } from "./paths.ts";
import { readHeader } from "./header.ts";

export type Finding = {
  name: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
  /** What to do about it, when there is something. */
  fix?: string;
};

export type DoctorProbe = {
  kanataBin(): string | undefined;
  kanataVersion(bin: string): Promise<string | undefined>;
  exec(cmd: string[]): Promise<{ code: number; out: string }>;
  exists(path: string): boolean;
  readText(path: string): Promise<string | undefined>;
  hello(endpoint: KanataEndpoint): Promise<{ version: string; protocol: number | null }>;
};

export function realProbe(): DoctorProbe {
  return {
    kanataBin: () => findKanata(),
    kanataVersion,
    async exec(cmd) {
      try {
        const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
        const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
        return { code: await proc.exited, out: `${out}${err}` };
      } catch (err) {
        return { code: 127, out: (err as Error).message };
      }
    },
    exists: existsSync,
    readText: (p) => readFile(p, "utf8").catch(() => undefined),
    hello: (e) => hello(e),
  };
}

/**
 * The driver protocol each Karabiner-DriverKit-VirtualHIDDevice release speaks (software-remappers.md, from the driver's
 * client_protocol_version.hpp): 6.x is protocol 5, 8.x is protocol 7. kanata 1.12 speaks 5 and the unreleased 1.13 speaks 7.
 */
export function driverProtocol(version: string): number | undefined {
  const major = Number(version.split(".")[0]);
  if (major === 6) return 5;
  if (major >= 8) return 7;
  return undefined;
}

const kanataProtocol = (version: string): number | undefined => {
  const [major, minor] = version.split(".").map(Number);
  if (major === 1 && (minor ?? 0) <= 12) return 5;
  if (major === 1 && (minor ?? 0) >= 13) return 7;
  return undefined;
};

export type DoctorInput = {
  rev: KanataBoardRevision;
  paths: RemapperPaths;
  /** Where the Karabiner-Elements config is read (read-only), to see whether it still grabs the built-in keyboard. */
  karabinerJson: string;
};

export type DoctorReport = { findings: Finding[]; rootCommand: string | null };

const DRIVER_PKG = "org.pqrs.Karabiner-DriverKit-VirtualHIDDevice";
const KE_PLIST = "/Applications/Karabiner-Elements.app/Contents/Info.plist";

export async function runRemapperDoctor(input: DoctorInput, probe: DoctorProbe = realProbe()): Promise<DoctorReport> {
  const { rev, paths } = input;
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  let needsRoot = false;

  // kanata itself.
  const bin = probe.kanataBin();
  let version: string | undefined;
  if (!bin) {
    add({ name: "kanata", status: "fail", detail: "kanata isn't installed", fix: `brew install kanata (keyloom targets ${rev.kanataVersion})` });
  } else {
    version = await probe.kanataVersion(bin);
    if (version === rev.kanataVersion) add({ name: "kanata", status: "ok", detail: `${version} at ${bin}` });
    else add({ name: "kanata", status: "warn", detail: `${version ?? "an unknown version"} at ${bin}; keyloom writes configs for ${rev.kanataVersion}`, fix: `install kanata ${rev.kanataVersion}` });
  }

  // The driver kanata talks to, and whether a Karabiner-Elements upgrade would swap it for one kanata can't use.
  const pkg = await probe.exec(["pkgutil", "--pkg-info", DRIVER_PKG]);
  const driver = /version:\s*(\S+)/.exec(pkg.out)?.[1];
  if (pkg.code !== 0 || !driver) {
    add({ name: "Karabiner VirtualHID driver", status: "fail", detail: "the driver kanata needs isn't installed", fix: `install Karabiner-DriverKit-VirtualHIDDevice ${rev.driverVersions.at(-1)}` });
  } else if (rev.driverVersions.includes(driver)) {
    add({ name: "Karabiner VirtualHID driver", status: "ok", detail: `${driver} (protocol ${driverProtocol(driver)}), which kanata ${rev.kanataVersion} can use` });
  } else {
    const wants = kanataProtocol(version ?? rev.kanataVersion);
    const has = driverProtocol(driver);
    add({
      name: "Karabiner VirtualHID driver", status: has !== undefined && has === wants ? "ok" : "fail",
      detail: `${driver} (protocol ${has ?? "unknown"}); kanata ${version ?? rev.kanataVersion} speaks protocol ${wants ?? "unknown"}`,
      fix: has === wants ? "" : `kanata ${rev.kanataVersion} works with driver ${rev.driverVersions.join(" or ")}`,
    });
  }
  const kePlist = await probe.readText(KE_PLIST);
  const ke = kePlist === undefined ? undefined : /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(kePlist)?.[1];
  if (ke) {
    const major = Number(ke.split(".")[0]);
    if (major >= 16) add({ name: "Karabiner-Elements", status: "warn", detail: `${ke} bundles driver 8.x, which kanata ${rev.kanataVersion} can't use`, fix: `don't upgrade past the driver kanata ${rev.kanataVersion} supports until kanata 1.13 is released` });
    else add({ name: "Karabiner-Elements", status: "warn", detail: `${ke} is installed. A Karabiner-Elements 16.x upgrade replaces the driver with one kanata ${rev.kanataVersion} can't use, so don't upgrade it` });
  }

  // The built-in keyboard, which the device filter names exactly.
  const io = await probe.exec(["ioreg", "-r", "-c", "AppleEmbeddedKeyboard", "-l"]);
  if (io.code === 0 && io.out.includes(rev.deviceName)) add({ name: "built-in keyboard", status: "ok", detail: `"${rev.deviceName}" is present, which is the name keyloom tells kanata to take` });
  else if (io.code === 0) add({ name: "built-in keyboard", status: "warn", detail: `no keyboard named "${rev.deviceName}" was found; run \`kanata --list\` and compare`, fix: "S36 records the name on this model" });
  else add({ name: "built-in keyboard", status: "unknown", detail: "couldn't read the keyboard list" });

  // Karabiner-Elements must leave the built-in keyboard alone, or both would grab it.
  const kj = await probe.readText(input.karabinerJson);
  if (kj === undefined) add({ name: "Karabiner config", status: "ok", detail: `${input.karabinerJson} doesn't exist, so nothing competes for the keyboard` });
  else {
    const ignores = /"ignore"\s*:\s*true/.test(kj) && /"vendor_id"\s*:\s*0\b/.test(kj);
    add({
      name: "Karabiner config", status: ignores ? "ok" : "warn",
      detail: ignores ? "it ignores the built-in keyboard" : "it doesn't ignore the built-in keyboard, so Karabiner-Elements and kanata would both grab it",
      ...(ignores ? {} : { fix: "run `keyloom import` to get the edit that disables your Karabiner rules for the built-in keyboard" }),
    });
  }

  // Permissions: macOS keeps them where an unprivileged process can't read them.
  add({
    name: "Input Monitoring and Accessibility", status: "unknown",
    detail: "macOS doesn't let keyloom read these grants",
    fix: "System Settings > Privacy & Security: allow the kanata binary under both. `kanata --macos-request-permissions` asks macOS to list it",
  });

  // The daemon and its port.
  const plistInstalled = probe.exists(DAEMON_PLIST_PATH);
  if (!plistInstalled) {
    needsRoot = true;
    add({ name: "LaunchDaemon", status: "fail", detail: `${DAEMON_PLIST_PATH} isn't installed`, fix: "run `keyloom remap setup`, then the root command below" });
  } else add({ name: "LaunchDaemon", status: "ok", detail: `${DAEMON_LABEL} is installed` });

  let port: Awaited<ReturnType<DoctorProbe["hello"]>> | undefined;
  try {
    port = await probe.hello({ port: rev.tcpPort });
    add({ name: "kanata TCP port", status: "ok", detail: `kanata ${port.version} is answering on 127.0.0.1:${rev.tcpPort}` });
  } catch (err) {
    add({ name: "kanata TCP port", status: plistInstalled ? "warn" : "fail", detail: `nothing answers on 127.0.0.1:${rev.tcpPort} (${(err as Error).message})`, fix: plistInstalled ? `sudo launchctl kickstart -k system/${DAEMON_LABEL}` : "install the LaunchDaemon first" });
  }

  const file = await probe.readText(paths.kbd);
  if (file === undefined) add({ name: "keyloom.kbd", status: "unknown", detail: `${paths.kbd} doesn't exist yet; the first Apply writes it` });
  else {
    const h = readHeader(file);
    add({ name: "keyloom.kbd", status: h?.intact ? "ok" : "warn", detail: h ? (h.intact ? `written by keyloom for ${h.layoutId} at ${h.revisionId}` : "written by keyloom, then edited by hand") : "not written by keyloom" });
  }

  return { findings, rootCommand: needsRoot ? rootInstallCommand(paths.plist) : null };
}

/** The one command BK runs to install and start the daemon. keyloom never runs it (D-231). */
export function rootInstallCommand(plistSource: string): string {
  return `sudo sh -c 'cp "${plistSource}" ${DAEMON_PLIST_PATH} && chown root:wheel ${DAEMON_PLIST_PATH} && chmod 644 ${DAEMON_PLIST_PATH} && launchctl bootstrap system ${DAEMON_PLIST_PATH}'`;
}

/** The command that stops the daemon for good, for the rollback section of the runbook and for "Disable remapping" when kanata hangs. */
export const rootRemoveCommand = `sudo launchctl bootout system/${DAEMON_LABEL}`;
