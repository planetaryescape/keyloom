// Test-only CLI entry: ordinary commands are unchanged; touch exercises the production selectors/owner.
// Never use this entry for a release. The paired executable must independently identify as synthetic.
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { runCli } from "../src/cli/main.ts";
import { defaultHidTransport } from "../src/firmware/toolchain/hid-default.ts";
import { defaultSerialTransport } from "../src/firmware/toolchain/serial-default.ts";
import { shutdownDeviceConnections } from "../src/app/device-connections.ts";
import { extractHelper } from "../src/firmware/toolchain/device-helper/extract.ts";
import { packagedHelper } from "../src/firmware/toolchain/device-helper/packaged.ts";
import { NATIVE_CAPABILITIES, transportIdentitySchema } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";

if (process.argv[2] !== "--synthetic-touch-smoke") {
  process.exitCode = await runCli(process.argv.slice(2));
} else {
  if (!packagedHelper) throw new Error("synthetic helper must be paired");
  const pair = extractHelper(await Bun.file(packagedHelper.asset).bytes(), packagedHelper.manifest, pkg.version);
  const version = Bun.spawn([pair.path, "--version"], { env: {}, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(version.stdout).text(), new Response(version.stderr).text(), version.exited]);
  if (code !== 0) throw new Error(`synthetic identity failed: ${stderr}`);
  const identity = transportIdentitySchema.extend({ syntheticBackend: z.literal(true), syntheticCapture: z.literal(true) }).parse(JSON.parse(stdout));
  if (JSON.stringify(identity.capabilities) !== JSON.stringify(NATIVE_CAPABILITIES)) throw new Error("combined synthetic capabilities required");
  try {
    const [hid, serial] = await Promise.all([defaultHidTransport(), defaultSerialTransport()]);
    const [hids, ports] = await Promise.all([hid.list(), serial.list()]);
    if (hids.length !== 1 || ports.length !== 1) throw new Error("expected both synthetic endpoints from one helper");
    const port = ports[0]!;
    await serial.touch(port.path, 1200);
    await serial.touch(port.path, 1201);
    console.log(JSON.stringify({ syntheticOnly: true, installedTouchBauds: [1200, 1201], bothTransports: true }));
  } finally { await shutdownDeviceConnections(); }
}
