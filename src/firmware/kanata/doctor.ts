// The setup doctor for the MacBook remapper (21): reads the kanata and driver versions, whether the daemon is installed and
// listening, and prints the one command BK has to run as root. Everything here only reads; it starts nothing, writes nothing
// and never asks for sudo (D-231). The probe is injectable, so tests describe a machine instead of being on one.
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type KanataEndpoint, hello } from "./client.ts";
import { type KanataBoardRevision } from "./board-config.ts";
import { fileSha256, findKanata, kanataVersion } from "./binary.ts";
import { DAEMON_LABEL, DAEMON_PLIST_PATH, ROOT_KANATA_PATH } from "./plist.ts";
import type { RemapperPaths } from "./paths.ts";
import { readHeader } from "./header.ts";

/** What a finding is about, so a screen can offer the one action that fixes it without reading the sentence (D-493). */
export type FindingCode =
  | "kanata_missing" | "kanata_version" | "driver_missing" | "driver_mismatch" | "karabiner_elements" | "keyboard_name" | "karabiner_config"
  | "permissions" | "daemon_missing" | "port_closed" | "kbd_file"
  // The daemon runs keyloom's root-owned copy of kanata (D-498): `kanata_updated` compares it with the kanata on PATH, and
  // `daemon_outdated` is a daemon set up before the copy existed, which still runs kanata from a folder the person can change.
  // `kanata_replaced` is a kanata on PATH that differs from the copy without looking like a Homebrew update, which setup doesn't offer to copy.
  | "kanata_updated" | "kanata_replaced" | "daemon_outdated";

export type Finding = {
  code: FindingCode;
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
  /** A file's SHA-256, to compare kanata with the daemon's copy. Without it the doctor doesn't compare them. */
  fileHash?(path: string): Promise<string | undefined>;
  /** Where a path's links lead, to see whether kanata is in Homebrew's Cellar. Without it the path is taken as it is. */
  realPath?(path: string): string;
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
    fileHash: fileSha256,
    realPath: (p) => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    },
  };
}

/** The version in a Homebrew Cellar path (`…/Cellar/kanata/1.12.0_1/bin/kanata` is 1.12.0), or undefined for a kanata from elsewhere. */
export function cellarVersion(realPath: string): string | undefined {
  return /\/Cellar\/kanata\/([^/]+)\/bin\/kanata$/.exec(realPath)?.[1]?.replace(/_\d+$/, "");
}

/**
 * Whether a kanata that differs from the root copy looks like a Homebrew update (D-498): it lives in a Cellar folder named for the
 * version it reports, and that version isn't the copy's. Anything else, such as a binary replaced in place under the same version, is
 * offered no password step: a process running as the person can write Homebrew's folder, so a changed hash alone proves nothing.
 */
export function looksLikeHomebrewUpdate(realPath: string, version: string | undefined, copyVersion: string | undefined): boolean {
  const cellar = cellarVersion(realPath);
  return cellar !== undefined && version !== undefined && cellar === version && version !== copyVersion;
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
  /** The port keyloom talks to kanata on, when it isn't the board's (KEYLOOM_KANATA_PORT), so the doctor asks where Apply does. */
  port?: number;
};

/**
 * `needsRoot`: the daemon has to be (re)installed, which takes the root command `keyloom remap setup` prints. `kanata` is the binary on
 * PATH and the version it reports, for a screen that offers an update.
 */
export type DoctorReport = {
  findings: Finding[];
  needsRoot: boolean;
  /** `real` is where `bin`'s links lead. */
  kanata: { bin: string; real: string; version: string | undefined } | null;
  /** The version of the root copy the daemon runs, read only when it differs from the kanata on PATH. */
  copyVersion: string | undefined;
};

const DRIVER_PKG = "org.pqrs.Karabiner-DriverKit-VirtualHIDDevice";
const KE_PLIST = "/Applications/Karabiner-Elements.app/Contents/Info.plist";

export async function runRemapperDoctor(input: DoctorInput, probe: DoctorProbe = realProbe()): Promise<DoctorReport> {
  const { rev, paths } = input;
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  let needsRoot = false;

  // kanata itself.
  const bin = probe.kanataBin();
  const real = bin === undefined ? undefined : (probe.realPath?.(bin) ?? bin);
  let version: string | undefined;
  let copyVersion: string | undefined;
  if (!bin) {
    add({ code: "kanata_missing", name: "kanata", status: "fail", detail: "kanata isn't installed", fix: `brew install kanata (keyloom targets ${rev.kanataVersion})` });
  } else {
    version = await probe.kanataVersion(bin);
    if (version === rev.kanataVersion) add({ code: "kanata_version", name: "kanata", status: "ok", detail: `${version} at ${bin}` });
    else add({ code: "kanata_version", name: "kanata", status: "warn", detail: `${version ?? "an unknown version"} at ${bin}; keyloom writes configs for ${rev.kanataVersion}`, fix: `install kanata ${rev.kanataVersion}` });
  }

  // The driver kanata talks to, and whether a Karabiner-Elements upgrade would swap it for one kanata can't use.
  const pkg = await probe.exec(["pkgutil", "--pkg-info", DRIVER_PKG]);
  const driver = /version:\s*(\S+)/.exec(pkg.out)?.[1];
  if (pkg.code !== 0 || !driver) {
    add({ code: "driver_missing", name: "Karabiner VirtualHID driver", status: "fail", detail: "the driver kanata needs isn't installed", fix: `install Karabiner-DriverKit-VirtualHIDDevice ${rev.driverVersions.at(-1)}` });
  } else if (rev.driverVersions.includes(driver)) {
    add({ code: "driver_mismatch", name: "Karabiner VirtualHID driver", status: "ok", detail: `${driver} (protocol ${driverProtocol(driver)}), which kanata ${rev.kanataVersion} can use` });
  } else {
    const wants = kanataProtocol(version ?? rev.kanataVersion);
    const has = driverProtocol(driver);
    add({
      code: "driver_mismatch", name: "Karabiner VirtualHID driver", status: has !== undefined && has === wants ? "ok" : "fail",
      detail: `${driver} (protocol ${has ?? "unknown"}); kanata ${version ?? rev.kanataVersion} speaks protocol ${wants ?? "unknown"}`,
      fix: has === wants ? "" : `kanata ${rev.kanataVersion} works with driver ${rev.driverVersions.join(" or ")}`,
    });
  }
  const kePlist = await probe.readText(KE_PLIST);
  const ke = kePlist === undefined ? undefined : /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(kePlist)?.[1];
  if (ke) {
    const major = Number(ke.split(".")[0]);
    if (major >= 16) add({ code: "karabiner_elements", name: "Karabiner-Elements", status: "warn", detail: `${ke} bundles driver 8.x, which kanata ${rev.kanataVersion} can't use`, fix: `don't upgrade past the driver kanata ${rev.kanataVersion} supports until kanata 1.13 is released` });
    else add({ code: "karabiner_elements", name: "Karabiner-Elements", status: "warn", detail: `${ke} is installed. A Karabiner-Elements 16.x upgrade replaces the driver with one kanata ${rev.kanataVersion} can't use, so don't upgrade it` });
  }

  // The built-in keyboard, which the device filter names exactly.
  const io = await probe.exec(["ioreg", "-r", "-c", "AppleEmbeddedKeyboard", "-l"]);
  if (io.code === 0 && io.out.includes(rev.deviceName)) add({ code: "keyboard_name", name: "built-in keyboard", status: "ok", detail: `"${rev.deviceName}" is present, which is the name keyloom tells kanata to take` });
  // ioreg exits 0 and prints nothing when nothing matches the class: a Mac mini or a Mac Studio has no built-in keyboard (R10-14).
  else if (io.code === 0 && io.out.trim() === "") add({ code: "keyboard_name", name: "built-in keyboard", status: "fail", detail: "this Mac has no built-in keyboard", fix: "keyloom's MacBook board remaps a MacBook's own keyboard; a keyboard plugged into this Mac is a board of its own" });
  else if (io.code === 0) add({ code: "keyboard_name", name: "built-in keyboard", status: "warn", detail: `no keyboard named "${rev.deviceName}" was found; run \`kanata --list\` and compare`, fix: "if kanata --list names the built-in keyboard differently, keyloom doesn't know this Mac model yet; it can't remap it until its board names that keyboard" });
  else add({ code: "keyboard_name", name: "built-in keyboard", status: "unknown", detail: "couldn't read the keyboard list" });

  // Karabiner-Elements must leave the built-in keyboard alone, or both would grab it.
  const kj = await probe.readText(input.karabinerJson);
  if (kj === undefined) add({ code: "karabiner_config", name: "Karabiner config", status: "ok", detail: `${input.karabinerJson} doesn't exist, so nothing competes for the keyboard` });
  else {
    const ignores = /"ignore"\s*:\s*true/.test(kj) && /"vendor_id"\s*:\s*0\b/.test(kj);
    add({
      code: "karabiner_config", name: "Karabiner config", status: ignores ? "ok" : "warn",
      detail: ignores ? "it ignores the built-in keyboard" : "it doesn't ignore the built-in keyboard, so Karabiner-Elements and kanata would both grab it",
      ...(ignores ? {} : { fix: `run \`keyloom import --board apple/macbook-ansi ${input.karabinerJson}\` to get the edit that disables your Karabiner rules for the built-in keyboard` }),
    });
  }

  // Permissions: macOS keeps them where an unprivileged process can't read them.
  add({
    code: "permissions", name: "Input Monitoring and Accessibility", status: "unknown",
    detail: "macOS doesn't let keyloom read these grants",
    fix: `System Settings > Privacy & Security: allow the kanata the daemon runs, ${ROOT_KANATA_PATH}, under both`,
  });

  // The daemon and its port.
  const plistInstalled = probe.exists(DAEMON_PLIST_PATH);
  if (!plistInstalled) {
    needsRoot = true;
    add({ code: "daemon_missing", name: "LaunchDaemon", status: "fail", detail: `${DAEMON_PLIST_PATH} isn't installed`, fix: "run `keyloom remap setup`, then the root command it prints" });
  } else add({ code: "daemon_missing", name: "LaunchDaemon", status: "ok", detail: `${DAEMON_LABEL} is installed` });

  // The daemon runs keyloom's root-owned copy of kanata (D-498). A kanata upgraded since setup isn't what the daemon runs.
  if (plistInstalled && bin) {
    const setUpAgain = "run `keyloom remap setup`, then the root command it prints";
    if (!probe.exists(ROOT_KANATA_PATH)) {
      needsRoot = true;
      add({ code: "daemon_outdated", name: "kanata's root copy", status: "warn", detail: `the LaunchDaemon was set up before keyloom kept its own copy of kanata at ${ROOT_KANATA_PATH}, so it runs a kanata your account can replace`, fix: setUpAgain });
    } else if (probe.fileHash) {
      const [onPath, copy] = await Promise.all([probe.fileHash(bin), probe.fileHash(ROOT_KANATA_PATH)]);
      if (onPath === undefined || copy === undefined) add({ code: "kanata_updated", name: "kanata's root copy", status: "unknown", detail: `couldn't compare ${bin} with ${ROOT_KANATA_PATH}` });
      else if (onPath === copy) add({ code: "kanata_updated", name: "kanata's root copy", status: "ok", detail: `${ROOT_KANATA_PATH} is the same kanata as ${bin}` });
      else {
        copyVersion = await probe.kanataVersion(ROOT_KANATA_PATH);
        const was = `the LaunchDaemon still runs the copy at ${ROOT_KANATA_PATH} (${copyVersion ?? "an unknown version"})`;
        if (looksLikeHomebrewUpdate(real ?? bin, version, copyVersion)) {
          needsRoot = true;
          add({ code: "kanata_updated", name: "kanata's root copy", status: "warn", detail: `Homebrew updated kanata to ${version} at ${real ?? bin}; ${was}`, fix: setUpAgain });
        } else {
          add({
            code: "kanata_replaced", name: "kanata's root copy", status: "warn",
            detail: `kanata at ${real ?? bin} (${version ?? "an unknown version"}) changed outside Homebrew; ${was}`,
            fix: cellarVersion(real ?? bin) !== undefined ? "brew reinstall kanata" : "if you installed this kanata yourself, run `keyloom remap setup`, then the root command it prints",
          });
        }
      }
    }
  }

  let port: Awaited<ReturnType<DoctorProbe["hello"]>> | undefined;
  try {
    port = await probe.hello({ port: input.port ?? rev.tcpPort });
    add({ code: "port_closed", name: "kanata TCP port", status: "ok", detail: `kanata ${port.version} is answering on 127.0.0.1:${input.port ?? rev.tcpPort}` });
  } catch (err) {
    add({ code: "port_closed", name: "kanata TCP port", status: plistInstalled ? "warn" : "fail", detail: `nothing answers on 127.0.0.1:${input.port ?? rev.tcpPort} (${(err as Error).message})`, fix: plistInstalled ? `sudo launchctl kickstart -k system/${DAEMON_LABEL}` : "install the LaunchDaemon first" });
  }

  const file = await probe.readText(paths.kbd);
  if (file === undefined) add({ code: "kbd_file", name: "keyloom.kbd", status: "unknown", detail: `${paths.kbd} doesn't exist yet; the first Apply writes it` });
  else {
    const h = readHeader(file);
    add({ code: "kbd_file", name: "keyloom.kbd", status: h?.intact ? "ok" : "warn", detail: h ? (h.intact ? `written by keyloom for ${h.layoutId} at ${h.revisionId}` : "written by keyloom, then edited by hand") : "not written by keyloom" });
  }

  return { findings, needsRoot, kanata: bin && real ? { bin, real, version } : null, copyVersion };
}

/** The command that stops the daemon for good, for the rollback section of the runbook and for "Disable remapping" when kanata hangs. */
export const rootRemoveCommand = `sudo launchctl bootout system/${DAEMON_LABEL}`;
