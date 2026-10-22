// Test-only installed entry. Only terminal input is scripted; CLI, capture, selectors and IPC are real.
// Never build a release with this entry. Verify the paired helper is synthetic before any list/open.
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { main, runCli } from "../src/cli/main.ts";
import { extractHelper } from "../src/firmware/toolchain/device-helper/extract.ts";
import { packagedHelper } from "../src/firmware/toolchain/device-helper/packaged.ts";
import { NATIVE_CAPABILITIES, transportIdentitySchema } from "../src/firmware/toolchain/device-helper/transport-protocol.ts";
import { defaultSerialTransport } from "../src/firmware/toolchain/serial-default.ts";
import { shutdownDeviceConnections } from "../src/app/device-connections.ts";

const mode = process.argv[2];
if (mode !== "--synthetic-windows-command" && mode !== "--synthetic-windows-touch") {
  await main();
} else {
  if (!packagedHelper) throw new Error("synthetic helper must be paired");
  const pair = extractHelper(await Bun.file(packagedHelper.asset).bytes(), packagedHelper.manifest, pkg.version);
  const child = Bun.spawn([pair.path, "--version"], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`synthetic identity failed: ${err}`);
  const identity = transportIdentitySchema.extend({ syntheticBackend: z.literal(true), syntheticCapture: z.literal(true) }).parse(JSON.parse(out));
  if (JSON.stringify(identity.capabilities) !== JSON.stringify(NATIVE_CAPABILITIES)) throw new Error("seven synthetic capabilities required");
  let exit = 0;
  if (mode === "--synthetic-windows-command") {
    // One CLI lifecycle per process: shutdown permanently closes its app-owned helper.
    exit = await runCli(process.argv.slice(3), undefined, {}, undefined, undefined, {
      terminal: { isInteractive: true, async typing(onText) { await Bun.sleep(100); onText("a"); return "a"; } },
    });
  } else {
    try {
      const serial = await defaultSerialTransport(), ports = await serial.list();
      if (ports.length !== 1) throw new Error("one synthetic serial endpoint required");
      await serial.touch(ports[0]!.path, 1200);
      await serial.touch(ports[0]!.path, 1201);
      console.log(JSON.stringify({ syntheticOnly: true, touchBauds: [1200, 1201] }));
    } finally { await shutdownDeviceConnections(); }
  }
  const flushed = (stream: NodeJS.WriteStream) => new Promise<void>((resolve) => stream.write("", () => resolve()));
  await Promise.race([Promise.all([flushed(process.stdout), flushed(process.stderr)]), new Promise((resolve) => setTimeout(resolve, 5_000).unref())]);
  process.exit(exit);
}
