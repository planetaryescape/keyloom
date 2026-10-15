// Finding and running the kanata binary, for `--check` only. keyloom never starts kanata as a remapper: the LaunchDaemon
// does, and only BK installs that (D-231).
import { existsSync } from "node:fs";

const CANDIDATES = ["/opt/homebrew/bin/kanata", "/usr/local/bin/kanata"];

export function findKanata(env: Record<string, string | undefined> = process.env): string | undefined {
  const fromEnv = env.KEYLOOM_KANATA_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const onPath = Bun.which("kanata");
  if (onPath) return onPath;
  return CANDIDATES.find((c) => existsSync(c));
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
