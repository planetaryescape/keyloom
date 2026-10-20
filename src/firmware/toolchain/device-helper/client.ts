import { z } from "zod";
import { HelperFailure } from "./errors.ts";
import type { HelperManifest } from "./extract.ts";
import { identitySchema, MAX_FRAME, responseSchema } from "./protocol.ts";
import { type HelperChild, launchHelper } from "./spawn.ts";

async function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HelperFailure("timeout")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

/** One bounded diagnostics exchange, not a session/RPC framework. Each call owns and reaps its child. */
export async function diagnoseHelper(path: string, manifest: HelperManifest, launch = launchHelper) {
  const child: HelperChild = launch(path);
  const reader = child.stdout.getReader();
  const stderr = child.stderr.getReader();
  let pending = Buffer.alloc(0);
  async function frame(): Promise<unknown> {
    for (;;) {
      const end = pending.indexOf(10);
      if (end >= 0) {
        if (end + 1 > MAX_FRAME) throw new HelperFailure("protocol_error");
        const line = pending.subarray(0, end);
        pending = pending.subarray(end + 1);
        try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)); }
        catch { throw new HelperFailure("protocol_error"); }
      }
      if (pending.length >= MAX_FRAME) throw new HelperFailure("protocol_error");
      const chunk = await reader.read();
      if (chunk.done) throw new HelperFailure("helper_exited");
      if (chunk.value.length + pending.length > MAX_FRAME) throw new HelperFailure("protocol_error");
      pending = Buffer.concat([pending, chunk.value]);
    }
  }
  // Discard stderr rather than logging untrusted text or payloads; still enforce a lifetime byte budget.
  const drain = (async () => {
    let bytes = 0;
    for (;;) {
      const chunk = await stderr.read();
      if (chunk.done) return;
      bytes += chunk.value.length;
      if (bytes > MAX_FRAME) throw new HelperFailure("protocol_error");
    }
  })();
  async function request(id: string, method: string, params: Record<string, unknown>) {
    child.stdin.write(`${JSON.stringify({ v: 1, type: "request", id, method, params })}\n`);
    await child.stdin.flush();
    const parsed = responseSchema.safeParse(await frame());
    if (!parsed.success || parsed.data.id !== id) throw new HelperFailure("protocol_error");
    if (!parsed.data.ok) throw new HelperFailure(parsed.data.error.code === "version_mismatch" ? "version_mismatch" : "protocol_error");
    return parsed.data.result;
  }
  const exchange = (async () => {
    const hello = identitySchema.safeParse(await request("1", "hello", { protocol: 1, hostVersion: manifest.release, target: manifest.target }));
    if (!hello.success) throw new HelperFailure("protocol_error");
    if (hello.data.helperVersion !== manifest.release || hello.data.target !== manifest.target) throw new HelperFailure("version_mismatch");
    if (!z.strictObject({}).safeParse(await request("2", "ping", {})).success) throw new HelperFailure("protocol_error");
    if (!z.strictObject({}).safeParse(await request("3", "shutdown", {})).success) throw new HelperFailure("protocol_error");
    await child.stdin.end();
    if (pending.length !== 0 || !(await reader.read()).done) throw new HelperFailure("protocol_error");
    if (await child.exited !== 0) throw new HelperFailure("helper_exited");
    await drain;
    return hello.data;
  })();
  // A resolved drain is not a successful exchange; only its rejection races the exchange.
  const stderrFailure = drain.then(() => new Promise<never>(() => {}));
  try {
    return await deadline(Promise.race([exchange, stderrFailure]), 2_000);
  } finally {
    try { await deadline(Promise.resolve(child.stdin.end()), 500); } catch { /* A broken stdin is expected after a crash. */ }
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await deadline(child.exited, 2_000); }
    finally { await deadline(Promise.allSettled([reader.cancel(), stderr.cancel()]), 2_000); }
  }
}
