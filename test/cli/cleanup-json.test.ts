import { expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { tempDir } from "../helpers/tmp.ts";

const projectRoot = join(import.meta.dir, "../..");
const cliResultSchema = z.strictObject({ code: z.number(), out: z.string(), err: z.string() });
const cliErrorSchema = z.strictObject({
  schema_version: z.literal(1),
  error: z.strictObject({ code: z.string(), message: z.string() }),
});
const resultsSchema = z.tuple([cliResultSchema, cliResultSchema]);
const parseError = (text: string) => {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (cause) { throw new Error(`expected one JSON error document, got ${JSON.stringify(text)}`, { cause }); }
  return cliErrorSchema.parse(value);
};

test("a cleanup failure replaces an operation error with one JSON document", async () => {
  const dataDir = tempDir();
  const deviceConnectionsPath = join(projectRoot, "src/app/device-connections.ts");
  const mainPath = join(projectRoot, "src/cli/main.ts");
  const script = `
    import { mock } from "bun:test";
    let failCleanup = true;
    mock.module(${JSON.stringify(deviceConnectionsPath)}, () => ({
      drainDeviceConsumers: async () => {},
      shutdownDeviceConnections: async () => {
        if (failCleanup) throw new Error("synthetic cleanup failure");
      },
    }));
    const { runCli } = await import(${JSON.stringify(mainPath)});
    const results = [];
    for (const shouldFailCleanup of [true, false]) {
      failCleanup = shouldFailCleanup;
      let out = "";
      let err = "";
      const io = {
        out: (chunk) => { out += chunk; },
        err: (chunk) => { err += chunk; },
        isTTY: false,
      };
      const code = await runCli(
        ["--data-dir", ${JSON.stringify(dataDir)}, "--format", "json", "layout", "show", "ghost"],
        io,
      );
      results.push({ code, out, err });
    }
    process.stdout.write(JSON.stringify(results));
  `;
  const child = Bun.spawn([
    process.execPath,
    "--preload", "./test/helpers/no-real-flash.ts",
    "--preload", "./test/helpers/isolate-data-dir.ts",
    "--preload", "./test/helpers/no-paid-model.ts",
    "-e", script,
  ], { cwd: projectRoot, env: {}, stdout: "pipe", stderr: "pipe" });
  let watchdogFired = false;
  const watchdog = setTimeout(() => {
    watchdogFired = true;
    child.kill();
  }, 8_000);
  let stdout = "";
  let stderr = "";
  let exitCode: number;
  try {
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) {
      child.kill();
      await child.exited;
    }
  }
  expect(watchdogFired).toBe(false);
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const [cleanupFailed, cleanupConfirmed] = resultsSchema.parse(JSON.parse(stdout));
  expect(cleanupFailed.code).toBe(1);
  expect(cleanupFailed.out).toBe("");
  expect(parseError(cleanupFailed.err)).toEqual({
    schema_version: 1,
    error: {
      code: "cleanup_unconfirmed",
      message: "keyboard helper termination could not be confirmed; restart keyloom before using the keyboard connection again",
    },
  });
  expect(cleanupConfirmed.code).toBe(3);
  expect(cleanupConfirmed.out).toBe("");
  expect(JSON.parse(cleanupConfirmed.err)).toEqual({
    schema_version: 1,
    error: { code: "not_found", message: 'no layout "ghost"' },
  });
});

test("a synchronous no-child launch keeps the CLI setup error without a cleanup warning", async () => {
  const dataDir = tempDir();
  const deviceConnectionsPath = join(projectRoot, "src/app/device-connections.ts");
  const mainPath = join(projectRoot, "src/cli/main.ts");
  const ownerPath = join(projectRoot, "src/firmware/toolchain/device-helper/owner.ts");
  const clientPath = join(projectRoot, "src/firmware/toolchain/device-helper/transport-client.ts");
  const errorsPath = join(projectRoot, "src/firmware/toolchain/device-helper/errors.ts");
  const appFixturePath = join(projectRoot, "test/helpers/command-shift.ts");
  const script = `
    import { mock } from "bun:test";
    const { CandidateHidOwner } = await import(${JSON.stringify(ownerPath)});
    const { DeviceTransportClient } = await import(${JSON.stringify(clientPath)});
    const { HelperFailure } = await import(${JSON.stringify(errorsPath)});
    const original = new HelperFailure("helper_unavailable");
    const manifest = { release: "0.0.0", protocol: 1, target: "aarch64-apple-darwin", sha256: "0000000000000000000000000000000000000000000000000000000000000000" };
    const owner = new CandidateHidOwner(async () => {
      const client = await DeviceTransportClient.connect("/synthetic", manifest, () => { throw original; });
      return { transport: {}, shutdown: () => client.shutdown() };
    });
    mock.module(${JSON.stringify(deviceConnectionsPath)}, () => ({ drainDeviceConsumers: async () => {}, shutdownDeviceConnections: () => owner.shutdown() }));
    const { runCli } = await import(${JSON.stringify(mainPath)});
    const { commandShiftApp } = await import(${JSON.stringify(appFixturePath)});
    const { app, layoutId } = await commandShiftApp();
    let out = "", err = "";
    const io = { out: (chunk) => { out += chunk; }, err: (chunk) => { err += chunk; }, isTTY: false };
    const lab = {
      terminal: { isInteractive: true, typing: async () => "" },
      lab: { startCapture: async () => { await owner.transport(); throw new Error("unreachable"); }, replay: () => async () => ({}) },
    };
    const code = await runCli(["--data-dir", app.dataDir, "--format", "json", "lab", "start", layoutId, "--text", "hello"], io, {}, undefined, undefined, lab);
    process.stdout.write(JSON.stringify({ code, out, err }));
    app.db.close();
  `;
  const child = Bun.spawn([
    process.execPath,
    "--preload", "./test/helpers/no-real-flash.ts",
    "--preload", "./test/helpers/isolate-data-dir.ts",
    "--preload", "./test/helpers/no-paid-model.ts",
    "-e", script,
  ], { cwd: projectRoot, env: {}, stdout: "pipe", stderr: "pipe" });
  let watchdogFired = false;
  const watchdog = setTimeout(() => { watchdogFired = true; child.kill(); }, 8_000);
  let stdout = "", stderr = "", exitCode = -1;
  try {
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) { child.kill(); await child.exited; }
  }
  expect(watchdogFired).toBe(false);
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  const result = cliResultSchema.parse(JSON.parse(stdout));
  expect(result.code).toBe(1);
  expect(result.out).toContain("keyloom is recording this keyboard's key presses");
  const errorLine = result.err.trim().split("\n").at(-1);
  if (!errorLine) throw new Error("CLI did not print an error document");
  const error = parseError(errorLine);
  expect(error.error.code).toBe("bug");
  expect(error.error.message).toContain("helper_unavailable");
  expect(error.error.code).not.toBe("cleanup_unconfirmed");
});
