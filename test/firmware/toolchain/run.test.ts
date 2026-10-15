import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { LockTimeoutError, withLock } from "../../../src/firmware/toolchain/lock.ts";
import { LogSink, capture, run } from "../../../src/firmware/toolchain/run.ts";
import { parseDfFreeBytes } from "../../../src/firmware/toolchain/docker.ts";
import { parseUsbDevices } from "../../../src/firmware/toolchain/usb.ts";
import { tempDir } from "../../helpers/tmp.ts";

describe("run", () => {
  test("streams both outputs line by line, splits carriage-return progress, and logs every line", async () => {
    const dir = tempDir();
    const log = new LogSink(join(dir, "logs", "x.log"));
    const seen: string[] = [];
    const r = await run({
      cmd: ["sh", "-c", "echo one; echo err >&2; printf 'a\\rb\\rc\\n'; printf 'no newline'"],
      log,
      onLine: (l, s) => seen.push(`${s}:${l}`),
    });
    log.close();
    expect(r.exitCode).toBe(0);
    expect(seen).toContain("stdout:one");
    expect(seen).toContain("stderr:err");
    expect(seen).toEqual(expect.arrayContaining(["stdout:a", "stdout:b", "stdout:c", "stdout:no newline"]));
    const logged = (await Bun.file(join(dir, "logs", "x.log")).text()).split("\n");
    expect(logged).toEqual(expect.arrayContaining(["one", "err", "a", "b", "c", "no newline"]));
  });

  test("a failing command reports its exit code", async () => {
    expect((await run({ cmd: ["sh", "-c", "exit 3"] })).exitCode).toBe(3);
  });

  test("a timeout sends SIGTERM and says so", async () => {
    const started = Date.now();
    const r = await run({ cmd: ["sh", "-c", "exec sleep 30"], timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.signalCode).toBe("SIGTERM");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("a process that ignores SIGTERM is killed after the grace period, and onKill runs first", async () => {
    const order: string[] = [];
    const r = await run({
      cmd: ["sh", "-c", "trap '' TERM; while true; do sleep 0.1; done"],
      timeoutMs: 200,
      killGraceMs: 300,
      onKill: () => void order.push("onKill"),
    });
    expect(order).toEqual(["onKill"]);
    expect(r.timedOut).toBe(true);
    expect(r.signalCode).toBe("SIGKILL");
  });

  test("an abort signal stops the process and is reported as aborted, not timed out", async () => {
    const c = new AbortController();
    setTimeout(() => c.abort(), 100);
    const r = await run({ cmd: ["sh", "-c", "exec sleep 30"], signal: c.signal });
    expect(r.aborted).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  test("capture returns stdout and stderr", async () => {
    const r = await capture(["sh", "-c", "echo out; echo err >&2"]);
    expect(r).toMatchObject({ exitCode: 0, stdout: "out", stderr: "err" });
  });
});

describe("withLock", () => {
  test("runs one holder at a time", async () => {
    const dir = join(tempDir(), "x.lock");
    const order: string[] = [];
    const hold = (name: string, ms: number) =>
      withLock(dir, async () => {
        order.push(`${name} in`);
        await Bun.sleep(ms);
        order.push(`${name} out`);
      }, { timeoutMs: 5000, pollMs: 20 });
    await Promise.all([hold("a", 150), hold("b", 10)]);
    expect(order).toEqual(["a in", "a out", "b in", "b out"]);
  });

  test("a lock left by a dead process is taken over; one held by a live process is waited on, then times out", async () => {
    const dir = join(tempDir(), "x.lock");
    await Bun.$`mkdir -p ${dir}`;
    await Bun.write(join(dir, "pid"), "2147483646"); // no such process
    expect(await withLock(dir, async () => "got it", { timeoutMs: 1000 })).toBe("got it");

    await Bun.$`mkdir -p ${dir}`;
    await Bun.write(join(dir, "pid"), String(process.ppid)); // alive
    let waited: number | undefined;
    await expect(withLock(dir, async () => "no", { timeoutMs: 150, pollMs: 20, onWait: (pid) => void (waited = pid) })).rejects.toBeInstanceOf(LockTimeoutError);
    expect(waited).toBe(process.ppid);
  });

  test("the lock is released when the work throws", async () => {
    const dir = join(tempDir(), "x.lock");
    await expect(withLock(dir, async () => { throw new Error("boom"); }, { timeoutMs: 1000 })).rejects.toThrow("boom");
    expect(await withLock(dir, async () => "again", { timeoutMs: 1000 })).toBe("again");
  });
});

describe("parsers", () => {
  test("df output to free bytes", () => {
    const out = "Filesystem     1024-blocks      Used Available Capacity Mounted on\noverlay          102626232  38012960  59354924      39% /";
    expect(parseDfFreeBytes(out)).toBe(59354924 * 1024);
    expect(parseDfFreeBytes("garbage")).toBeUndefined();
  });

  test("system_profiler JSON: devices nest under hubs, and ids may carry a vendor name", () => {
    const json = {
      SPUSBDataType: [
        { _name: "USB31Bus", _items: [{ _name: "Hub", _items: [{ _name: "Moonlander Mark I", product_id: "0x1972", vendor_id: "0x3297", manufacturer: "ZSA Technology Labs" }] }, { _name: "Mouse", product_id: "0x1969", vendor_id: "apple_vendor_id" }] },
      ],
    };
    const devices = parseUsbDevices(json);
    expect(devices).toEqual([
      { productId: "0x1972", vendorId: "0x3297", name: "Moonlander Mark I", maker: "ZSA Technology Labs" },
      { productId: "0x1969", vendorId: "", name: "Mouse", maker: "" },
    ]);
    expect(parseUsbDevices({ SPUSBDataType: [] })).toEqual([]);
    expect(parseUsbDevices(null)).toEqual([]);
  });
});
