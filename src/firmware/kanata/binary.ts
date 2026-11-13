// Finding and running the kanata binary, for `--check` only. keyloom never starts kanata as a remapper: the LaunchDaemon
// does, and only BK installs that (D-231).
import { existsSync } from "node:fs";
import { keptTool } from "../toolchain/kept-tools.ts";
import type { PinDeps } from "../toolchain/tool-pins.ts";

const CANDIDATES = ["/opt/homebrew/bin/kanata", "/usr/local/bin/kanata"];

/**
 * The kanata keyloom uses: one named by KEYLOOM_KANATA_BIN, the one on PATH, Homebrew's, then the one keyloom downloaded into its own folder
 * on a Mac without Homebrew (D-560). A kanata the person installed comes first, so keyloom's own copy is only the fallback, and only while it
 * is still the pinned program (keptTool).
 */
export function findKanata(env: Record<string, string | undefined> = process.env, pin: PinDeps = {}): string | undefined {
  const fromEnv = env.KEYLOOM_KANATA_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const onPath = Bun.which("kanata");
  if (onPath) return onPath;
  return CANDIDATES.find((c) => existsSync(c)) ?? keptTool("kanata", env, pin);
}

export async function kanataVersion(bin: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return /kanata\s+(\d+\.\d+\.\d+\S*)/.exec(out)?.[1];
  } catch {
    return undefined;
  }
}

/** `kanata --check`: reads the file and exits. It does not grab a keyboard, needs no driver and needs no root. */
export async function kanataCheck(bin: string, path: string): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn([bin, "--check", "--no-wait", "-c", path], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  // kanata colours its log lines; the person reads this, so the escapes go.
  // biome-ignore lint: ANSI escape
  const output = `${out}${err}`.replace(/\u001b\[[0-9;]*m/g, "").trim();
  return { ok: code === 0 && output.includes("config file is valid"), output };
}

/** The SHA-256 of a file, as lowercase hex, or undefined when it can't be read. */
export async function fileSha256(path: string): Promise<string | undefined> {
  try {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(path).arrayBuffer());
    return hasher.digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * A config that asks for kanata's `cmd` action, which runs a program. It is the shape of kanata's own `parse_cmd` test
 * (parser/src/cfg/tests.rs @ v1.12.0). A kanata built without the `cmd` feature refuses it with "cmd is not enabled for this kanata
 * executable" (parser/src/cfg/cmd.rs); one built with it accepts it. Homebrew builds kanata with its default features, which leave `cmd`
 * out (Formula/k/kanata.rb: `cargo install *std_cargo_args`; Cargo.toml `default = ["tcp_server", "win_sendinput_send_scancodes", "zippychord"]`).
 */
export const CMD_PROBE_CONFIG = `(defcfg danger-enable-cmd yes)
(defsrc a)
(deflayer base a)
(defalias run (cmd true))
`;

export type CmdCheck = "refuses" | "allows" | "unknown";

/**
 * Whether a kanata binary refuses to run programs from its config (D-498). The daemon runs kanata as root and reads keyloom.kbd from the
 * person's home folder, so a kanata with `cmd` would turn a swapped config into root. `check` is `kanataCheck` on the probe's file.
 */
export function cmdCheckResult(r: { ok: boolean; output: string }): CmdCheck {
  if (r.ok) return "allows";
  // kanata reports errors through miette, which wraps long lines and starts each continuation with a box-drawing rule, so the phrase
  // is matched with those rules and line breaks read as spaces.
  return r.output.replace(/[\u2500-\u257f]/g, " ").replace(/\s+/g, " ").includes("cmd is not enabled") ? "refuses" : "unknown";
}
