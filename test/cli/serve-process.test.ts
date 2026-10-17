// `keyloom serve` as the desktop app drives it (D-321, D-323): a real process, because stdin closing and a second server on one data directory are process behaviour.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../helpers/tmp.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";

const MAIN = join(import.meta.dir, "../../src/cli/main.ts");

function spawnServe(dataDir: string, ...flags: string[]) {
  const proc = Bun.spawn(["bun", MAIN, "--data-dir", dataDir, "serve", "--no-open", ...flags], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  return proc;
}

async function firstLine(proc: ReturnType<typeof spawnServe>, wanted: RegExp): Promise<string> {
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`exited before printing ${wanted}; got: ${text}`);
    text += decoder.decode(value);
    const hit = text.match(wanted);
    if (hit) {
      reader.releaseLock();
      return hit[0];
    }
  }
}

describe("keyloom serve for the desktop app", () => {
  test(
    "port 0 picks a free port, and the server exits when stdin closes",
    async () => {
      const dir = tempDir();
      const proc = spawnServe(dir, "--port", "0", "--exit-on-stdin-close");
      const url = await firstLine(proc, /http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/);
      expect(Number(new URL(url).port)).toBeGreaterThan(0);
      expect(new URL(url).port).not.toBe("0");
      expect(JSON.parse(readFileSync(join(dir, "serve.json"), "utf8")).url).toBe(url);
      proc.stdin.end();
      expect(await proc.exited).toBe(0);
      expect(existsSync(join(dir, "serve.json"))).toBe(false);
    },
    SLOW_RUNNER_MS,
  );

  test(
    "a second server on the same data directory is refused, or reused with --reuse, and the first keeps running",
    async () => {
      const dir = tempDir();
      const first = spawnServe(dir, "--port", "0");
      const url = await firstLine(first, /http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/);
      try {
        const second = spawnServe(dir, "--port", "0");
        expect(await second.exited).not.toBe(0);
        expect(await new Response(second.stderr).text()).toContain(`already serving ${dir} at ${url}`);

        const reuse = spawnServe(dir, "--port", "0", "--reuse");
        expect(await reuse.exited).toBe(0);
        expect(await new Response(reuse.stderr).text()).toContain(`keyloom is already running at ${url}`);
        expect(first.killed).toBe(false);
      } finally {
        first.kill("SIGTERM");
        await first.exited;
      }
    },
    SLOW_RUNNER_MS,
  );

  test(
    "a record left by a crashed server does not block a new one",
    async () => {
      const dir = tempDir();
      await Bun.write(join(dir, "serve.json"), JSON.stringify({ pid: 2 ** 22 - 1, url: "http://127.0.0.1:1/?t=x", startedAt: "2026-01-01T00:00:00Z" }));
      const proc = spawnServe(dir, "--port", "0");
      await firstLine(proc, /keyloom is running at/);
      proc.kill("SIGTERM");
      await proc.exited;
    },
    SLOW_RUNNER_MS,
  );
});
