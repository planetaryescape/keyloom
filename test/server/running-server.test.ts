// The record a server leaves in the data directory, and how little of a damaged one is trusted (D-454).
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { announceServer, liveServer, readRecord } from "../../src/server/running-server.ts";
import { tempDir } from "../helpers/tmp.ts";

const write = (dir: string, body: string) => writeFileSync(join(dir, "serve.json"), body);

describe("serve.json", () => {
  test("records the version and protocol of the keyloom that wrote it, and the owner's removal leaves a newer record alone", () => {
    const dir = tempDir();
    const forget = announceServer(dir, "http://127.0.0.1:1/?t=x", { version: "0.57.0", protocol: 1 });
    expect(JSON.parse(readFileSync(join(dir, "serve.json"), "utf8"))).toMatchObject({ pid: process.pid, version: "0.57.0", protocol: 1 });
    expect(readRecord(dir)).toMatchObject({ version: "0.57.0", protocol: 1 });
    write(dir, JSON.stringify({ pid: 4242, url: "http://127.0.0.1:2/?t=y", startedAt: "z" }));
    forget();
    expect(readRecord(dir)?.pid).toBe(4242);
  });

  test("a record without them is an old one: version and protocol are absent", () => {
    const dir = tempDir();
    write(dir, JSON.stringify({ pid: 4242, url: "http://127.0.0.1:2/?t=y", startedAt: "z" }));
    const r = readRecord(dir)!;
    expect(r.pid).toBe(4242);
    expect("version" in r).toBe(false);
    expect("protocol" in r).toBe(false);
  });

  test("wrong types never reach the caller", () => {
    const dir = tempDir();
    const base = { pid: 4242, url: "http://127.0.0.1:2/?t=y", startedAt: "z" };
    write(dir, JSON.stringify({ ...base, version: 5, protocol: "1" }));
    expect(readRecord(dir)).toEqual({ ...base });
    write(dir, JSON.stringify({ ...base, protocol: 1.5, version: "x".repeat(200) }));
    expect(readRecord(dir)).toEqual({ ...base });
  });

  test("a prototype key is not copied onto the record", () => {
    const dir = tempDir();
    write(dir, `{"pid":4242,"url":"http://127.0.0.1:2/?t=y","__proto__":{"version":"9.9.9","protocol":1},"constructor":{"protocol":1}}`);
    const r = readRecord(dir)!;
    expect(r.version).toBeUndefined();
    expect(r.protocol).toBeUndefined();
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
  });

  test("a pid that would signal a group or init, a non-object, or garbage is no record", () => {
    const dir = tempDir();
    for (const body of ["null", "[]", "7", "not json", JSON.stringify({ pid: 0, url: "u" }), JSON.stringify({ pid: -1, url: "u" }), JSON.stringify({ pid: 1, url: "u" }), JSON.stringify({ pid: "12", url: "u" }), JSON.stringify({ pid: 1.5, url: "u" }), JSON.stringify({ pid: 12 })]) {
      write(dir, body);
      expect(readRecord(dir)).toBeUndefined();
      expect(readRecord(dir)).toBeUndefined();
    }
  });

  test("liveServer treats a record naming a live process that is not a keyloom server as no server", async () => {
    const dir = tempDir();
    // This test process is alive but answers nothing at that URL; liveServer skips its own pid, so use the parent.
    write(dir, JSON.stringify({ pid: process.ppid, url: "http://127.0.0.1:9/?t=x", startedAt: "z" }));
    expect(await liveServer(dir, 300)).toBeUndefined();
  });

  test("a record that changes while the probe is out, because the server that answered has gone, is looked at again and the successor comes back", async () => {
    const dir = tempDir();
    const gone = Bun.spawn(["sleep", "30"]);
    let probes = 0;
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        // The first server answers, exits, and its successor announces, all while liveServer is waiting.
        if (probes++ === 0) {
          gone.kill();
          await gone.exited;
          write(dir, record("successor", process.ppid));
        }
        return new Response("[]");
      },
    });
    try {
      write(dir, record("first", gone.pid));
      const found = await liveServer(dir, 1000);
      expect(found && "startedAt" in found ? found.startedAt : found).toBe("successor");
      expect(probes).toBe(2);
    } finally {
      server.stop(true);
      gone.kill();
    }
    function record(startedAt: string, pid: number): string {
      return JSON.stringify({ pid, url: `http://127.0.0.1:${server.port}/?t=x`, startedAt });
    }
  });

  test("a server that answered and then dropped or changed its record while its process lives is draining, not absent", async () => {
    for (const change of ["removed", "replaced"]) {
      const dir = tempDir();
      const server = Bun.serve({
        port: 0,
        fetch: () => {
          if (change === "removed") rmSync(join(dir, "serve.json"));
          else write(dir, JSON.stringify({ pid: process.ppid, url: `http://127.0.0.1:${server.port}/?t=x`, startedAt: "other" }));
          return new Response("[]");
        },
      });
      try {
        write(dir, JSON.stringify({ pid: process.ppid, url: `http://127.0.0.1:${server.port}/?t=x`, startedAt: "first" }));
        expect(await liveServer(dir, 1000)).toEqual({ draining: true, pid: process.ppid });
      } finally {
        server.stop(true);
      }
    }
  });

  test("a record whose process is alive but did not answer is still no server, even if the record then goes", async () => {
    const dir = tempDir();
    write(dir, JSON.stringify({ pid: process.ppid, url: "http://127.0.0.1:9/?t=x", startedAt: "first" }));
    expect(await liveServer(dir, 300)).toBeUndefined();
  });
});
