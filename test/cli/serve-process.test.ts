// `keyloom serve` as the desktop app drives it (D-321, D-323): a real process, because stdin closing and a second server on one data directory are process behaviour.
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP_PROTOCOL } from "../../src/api/desktop-protocol.ts";
import { databasePath } from "../../src/persistence/paths.ts";
import { tempDir } from "../helpers/tmp.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";

const MAIN = join(import.meta.dir, "../../src/cli/main.ts");

function spawnServe(dataDir: string, ...flags: string[]) {
  return spawnCommand("serve", dataDir, ...flags);
}

function spawnCommand(command: "serve" | "web", dataDir: string, ...flags: string[]) {
  const proc = Bun.spawn(["bun", MAIN, "--data-dir", dataDir, command, "--no-open", ...flags], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
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
    "keyloom web is another name for keyloom serve",
    async () => {
      const proc = spawnCommand("web", tempDir(), "--port", "0");
      await firstLine(proc, /keyloom is running at http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/);
      proc.kill("SIGTERM");
      await proc.exited;
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

  test(
    "the record names the version and protocol, and --client-protocol for another protocol refuses to start (exit 10)",
    async () => {
      const dir = tempDir();
      const proc = spawnServe(dir, "--port", "0", "--client-protocol", String(DESKTOP_PROTOCOL));
      await firstLine(proc, /keyloom is running at/);
      const record = JSON.parse(readFileSync(join(dir, "serve.json"), "utf8"));
      expect(record.protocol).toBe(DESKTOP_PROTOCOL);
      expect(record.version).toBe(JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8")).version);
      proc.kill("SIGTERM");
      await proc.exited;

      const other = tempDir();
      const refused = spawnServe(other, "--port", "0", "--client-protocol", String(DESKTOP_PROTOCOL + 1));
      expect(await refused.exited).toBe(10);
      expect(await new Response(refused.stderr).text()).toMatch(/protocol 2.*speaks protocol 1/s);
      expect(existsSync(join(other, "serve.json"))).toBe(false);
    },
    SLOW_RUNNER_MS,
  );

  test(
    "a server from before the check: --reuse says so and exits 10, --replace stops it and serves",
    async () => {
      const dir = tempDir();
      const old = spawnServe(dir, "--port", "0");
      await firstLine(old, /keyloom is running at/);
      // What 0.56.0 wrote: no version, no protocol.
      const record = JSON.parse(readFileSync(join(dir, "serve.json"), "utf8"));
      delete record.version;
      delete record.protocol;
      writeFileSync(join(dir, "serve.json"), JSON.stringify(record));
      let replacement: ReturnType<typeof spawnServe> | undefined;
      try {
        const reuse = spawnServe(dir, "--port", "0", "--reuse", "--client-protocol", String(DESKTOP_PROTOCOL));
        expect(await reuse.exited).toBe(10);
        const said = await new Response(reuse.stderr).text();
        expect(said).toContain("keyloom cannot attach: ");
        expect(said).toContain("keyloom can replace it: Use this app's keyloom");
        expect(old.killed).toBe(false);

        replacement = spawnServe(dir, "--port", "0", "--replace", "--client-protocol", String(DESKTOP_PROTOCOL));
        const url = await firstLine(replacement, /http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/);
        expect(await old.exited).toBe(0);
        expect(JSON.parse(readFileSync(join(dir, "serve.json"), "utf8")).url).toBe(url);
      } finally {
        old.kill("SIGTERM");
        replacement?.kill("SIGTERM");
        await old.exited;
        await replacement?.exited;
      }
    },
    SLOW_RUNNER_MS,
  );

  test(
    "--replace never signals a process that merely has a recycled pid",
    async () => {
      const dir = tempDir();
      const bystander = Bun.spawn(["sleep", "60"]);
      let replacement: ReturnType<typeof spawnServe> | undefined;
      try {
        // Alive, but nothing answers at the URL: not a keyloom server.
        writeFileSync(join(dir, "serve.json"), JSON.stringify({ pid: bystander.pid, url: "http://127.0.0.1:9/?t=x", startedAt: "z" }));
        replacement = spawnServe(dir, "--port", "0", "--replace");
        await firstLine(replacement, /keyloom is running at/);
        expect(bystander.killed).toBe(false);
        expect(bystander.exitCode).toBeNull();
      } finally {
        replacement?.kill("SIGTERM");
        await replacement?.exited;
        bystander.kill("SIGKILL");
      }
    },
    SLOW_RUNNER_MS,
  );

  test(
    "a data directory a newer keyloom migrated is refused by serve and by an ordinary command (exit 10), and --replace leaves its server alone",
    async () => {
      const dir = tempDir();
      const db = new Database(databasePath(dir), { create: true });
      db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
      db.query("INSERT INTO schema_migrations VALUES (999, 'from_the_future', 0)").run();
      db.close();

      const serve = spawnServe(dir, "--port", "0");
      expect(await serve.exited).toBe(10);
      expect(await new Response(serve.stderr).text()).toMatch(/schema 999.*Upgrade keyloom/s);

      const list = Bun.spawn(["bun", MAIN, "--data-dir", dir, "layout", "list"], { stdout: "pipe", stderr: "pipe" });
      expect(await list.exited).toBe(10);

      // A live server (as another keyloom) on that directory is not stopped by a replace this binary couldn't follow through on.
      const live = tempDir();
      const first = spawnServe(live, "--port", "0");
      await firstLine(first, /keyloom is running at/);
      const future = new Database(databasePath(live), { readwrite: true });
      future.query("INSERT INTO schema_migrations VALUES (999, 'from_the_future', 0)").run();
      future.close();
      try {
        const replace = spawnServe(live, "--port", "0", "--replace");
        expect(await replace.exited).toBe(10);
        expect(first.killed).toBe(false);
        expect(first.exitCode).toBeNull();
      } finally {
        first.kill("SIGTERM");
        await first.exited;
      }
    },
    SLOW_RUNNER_MS,
  );

  test(
    "a plain serve waits behind a held directory lock and starts only after it is released",
    async () => {
      const dir = tempDir();
      const marker = join(tempDir(), "released");
      const lock = join(import.meta.dir, "../../src/server/directory-lock.ts");
      const holder = Bun.spawn(["bun", "-e", `
        import { acquireDirectoryLock } from ${JSON.stringify(lock)};
        import { writeFileSync } from "node:fs";
        const release = await acquireDirectoryLock(${JSON.stringify(dir)}, { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), deadline: Date.now() + 10000 });
        console.log("held");
        await new Promise((r) => setTimeout(r, 1500));
        writeFileSync(${JSON.stringify(marker)}, String(Date.now()));
        release();
      `], { stdout: "pipe", stderr: "pipe" });
      await new Response(holder.stdout.pipeThrough(new TextDecoderStream())).body?.getReader().read();
      const proc = spawnServe(dir, "--port", "0");
      try {
        const said = await firstLine(proc, /keyloom is running at/);
        const startedAt = Date.now();
        await holder.exited;
        expect(startedAt).toBeGreaterThanOrEqual(Number(readFileSync(marker, "utf8")));
        expect(said).toContain("running");
      } finally {
        proc.kill("SIGTERM");
        await proc.exited;
      }
    },
    SLOW_RUNNER_MS,
  );

  test(
    "several --reuse starts at once leave exactly one server; the rest attach to it",
    async () => {
      const dir = tempDir();
      const procs = Array.from({ length: 4 }, () => spawnServe(dir, "--port", "0", "--reuse", "--client-protocol", String(DESKTOP_PROTOCOL)));
      const outputs = new Map<ReturnType<typeof spawnServe>, string>();
      try {
        // The starter never exits on its own; the attachers exit 0 once they have printed where the server is.
        await Promise.all(procs.map(async (p) => outputs.set(p, await firstLine(p, /keyloom is (already )?running at \S+/))));
        const starters = procs.filter((p) => !/already/.test(outputs.get(p)!));
        expect(starters).toHaveLength(1);
        for (const p of procs) if (p !== starters[0]) expect(await p.exited).toBe(0);
        expect(starters[0]!.exitCode).toBeNull();
      } finally {
        for (const p of procs) p.kill("SIGTERM");
        await Promise.all(procs.map((p) => p.exited));
      }
    },
    SLOW_RUNNER_MS,
  );

  test(
    "two --replace runs against an old server leave one new server, and the old one gone",
    async () => {
      const dir = tempDir();
      const old = spawnServe(dir, "--port", "0");
      await firstLine(old, /keyloom is running at/);
      const record = JSON.parse(readFileSync(join(dir, "serve.json"), "utf8"));
      delete record.version;
      delete record.protocol;
      writeFileSync(join(dir, "serve.json"), JSON.stringify(record));
      const procs = [1, 2].map(() => spawnServe(dir, "--port", "0", "--replace", "--client-protocol", String(DESKTOP_PROTOCOL)));
      try {
        const outputs = await Promise.all(procs.map((p) => firstLine(p, /keyloom is (already )?running at \S+/)));
        expect(outputs.filter((o) => !/already/.test(o))).toHaveLength(1);
        expect(await old.exited).toBe(0);
        const loser = procs[outputs.findIndex((o) => /already/.test(o))]!;
        expect(await loser.exited).toBe(0);
        const winner = procs.find((p) => p !== loser)!;
        expect(winner.exitCode).toBeNull();
      } finally {
        old.kill("SIGTERM");
        for (const p of procs) p.kill("SIGTERM");
        await Promise.all([old.exited, ...procs.map((p) => p.exited)]);
      }
    },
    SLOW_RUNNER_MS,
  );

  test(
    "doctor refuses a data directory a newer keyloom migrated (exit 10, schema_too_new) instead of reading its tables",
    async () => {
      const dir = tempDir();
      const db = new Database(databasePath(dir), { create: true });
      db.run("PRAGMA journal_mode = WAL");
      db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
      db.query("INSERT INTO schema_migrations VALUES (999, 'from_the_future', 0)").run();
      db.close();
      const doctor = Bun.spawn(["bun", MAIN, "--data-dir", dir, "doctor"], { stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(doctor.stdout).text(), new Response(doctor.stderr).text()]);
      expect(await doctor.exited).toBe(10);
      expect(err).toContain("schema_too_new");
      expect(err).toMatch(/schema 999.*Upgrade keyloom/s);
      expect(out).not.toContain("layouts");
    },
    SLOW_RUNNER_MS,
  );
});
