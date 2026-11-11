import { expect, test } from "bun:test";
import { join } from "node:path";
import { DESKTOP_PROTOCOL } from "../../src/api/desktop-protocol.ts";
import { RESTART_EXIT_CODE } from "../../src/api/restart.ts";
import { tempDir } from "../helpers/tmp.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";

const projectRoot = join(import.meta.dir, "../..");

// The lab asks for a restart when the keyboard helper can't be closed (restart_required), and that helper fails cleanup again on the way
// out. The restart must still exit RESTART_EXIT_CODE, or the desktop app counts a crash and three restarts open its problem window (R5-15).
test(
  "a restart whose drain and helper cleanup both fail still exits with the restart code and says the cleanup failed",
  async () => {
    const dataDir = tempDir();
    const script = `
      import { mock } from "bun:test";
      mock.module(${JSON.stringify(join(projectRoot, "src/app/device-connections.ts"))}, () => ({
        drainDeviceConsumers: async () => { throw new Error("synthetic drain failure"); },
        shutdownDeviceConnections: async () => { throw new Error("synthetic cleanup failure"); },
      }));
      const { runCli } = await import(${JSON.stringify(join(projectRoot, "src/cli/main.ts"))});
      let err = "";
      let asked = false;
      const io = {
        out: () => {},
        err: (chunk) => {
          err += chunk;
          const url = /http:\\/\\/127\\.0\\.0\\.1:\\d+\\/\\?t=\\S+/.exec(err)?.[0];
          if (url === undefined || asked) return;
          asked = true;
          const token = new URL(url).searchParams.get("t");
          void fetch(new URL("/api/restart", url), { method: "POST", body: "{}", headers: { "x-keyloom-token": token, "content-type": "application/json" } });
        },
        isTTY: false,
      };
      const code = await runCli(["--data-dir", ${JSON.stringify(dataDir)}, "--format", "json", "serve", "--port", "0", "--no-open", "--exit-on-stdin-close", "--client-protocol", "${DESKTOP_PROTOCOL}"], io);
      process.stdout.write(JSON.stringify({ code, err }));
      process.exit(0);
    `;
    const child = Bun.spawn([
      process.execPath,
      "--preload", "./test/helpers/no-real-flash.ts",
      "--preload", "./test/helpers/isolate-data-dir.ts",
      "--preload", "./test/helpers/no-paid-model.ts",
      "-e", script,
    ], { cwd: projectRoot, env: {}, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill(), SLOW_RUNNER_MS - 2_000);
    try {
      const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(stdout, stderr).not.toBe("");
      const { code, err } = JSON.parse(stdout) as { code: number; err: string };
      expect(code).toBe(RESTART_EXIT_CODE);
      // The cleanup failure still prints, with the drain's own failure as its cause.
      const last = JSON.parse(err.trim().split("\n").at(-1) ?? "") as { error: { code: string; cause?: { code: string } } };
      expect(last.error.code).toBe("cleanup_unconfirmed");
      expect(last.error.cause?.code).toBeDefined();
    } finally {
      clearTimeout(watchdog);
      child.kill();
      await child.exited;
    }
  },
  SLOW_RUNNER_MS,
);
