// The kanata binary for `--check` tests. kanata is never run as a remapper from a test: only `--check` is called, which
// reads a file and exits without touching a keyboard. KEYLOOM_KANATA_BIN points at the release binary (21, S30 runbook).
import { existsSync } from "node:fs";

export function kanataBinary(): string | undefined {
  const fromEnv = process.env.KEYLOOM_KANATA_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const onPath = Bun.which("kanata");
  return onPath ?? undefined;
}

/** `kanata --check` on a file's text. `ok` is false with kanata's own output when it refuses the config. */
export async function kanataCheck(bin: string, text: string, dir: string, name = "check.kbd"): Promise<{ ok: boolean; output: string }> {
  const { join } = await import("node:path");
  const path = join(dir, name);
  await Bun.write(path, text);
  const proc = Bun.spawn([bin, "--check", "--no-wait", "-c", path], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { ok: code === 0, output: `${out}${err}` };
}
