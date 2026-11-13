// Installing Docker and flash tools from a button (D-488, D-489). Every runner here is a fake: no test runs brew,
// colima or docker, and the preload refuses a real install if one is forgotten.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type InstallRunner, brewFormulae, canInstall, installJobs, installTool } from "../../src/app/tool-install.ts";
import { serving, testPins, zappTar } from "../helpers/tool-download.ts";
import { tempDir } from "../helpers/tmp.ts";

const mac = { platform: "darwin" as const, has: (c: string) => c === "brew" };

function recorder(exitCodes: Record<string, number> = {}) {
  const calls: string[][] = [];
  const runner: InstallRunner = async (cmd, opts) => {
    calls.push(cmd);
    opts.onLine(`ran ${cmd.join(" ")}`);
    return { exitCode: exitCodes[cmd[0] ?? ""] ?? 0, timedOut: false };
  };
  return { runner, calls };
}

describe("installTool", () => {
  test("Docker is brew install colima docker, then Colima is started on the D-486 path", async () => {
    const { runner, calls } = recorder();
    const lines: string[] = [];
    const phases: string[] = [];
    const out = await installTool("docker", (l) => lines.push(l), { ...mac, runner, startDocker: async (say) => { say("colima up"); return { ok: true, version: "29.0", engine: "Colima", waitedMs: 1 }; } }, (p) => phases.push(p));
    expect(out).toEqual({ ok: true });
    expect(calls).toEqual([["brew", "install", "colima", "docker"]]);
    expect(phases).toEqual(["installing", "starting"]);
    expect(lines).toContain("colima up");
  });

  test("a Docker that installed but won't start says so, with the start's reason", async () => {
    const { runner } = recorder();
    const out = await installTool("docker", () => undefined, { ...mac, runner, startDocker: async () => ({ ok: false, engine: "Colima", reason: "Colima did not answer within 960 s." }) });
    expect(out).toEqual({ ok: false, code: "start_failed", reason: "Colima did not answer within 960 s." });
  });

  test("a brew that fails stops before any start, and says it failed", async () => {
    const { runner } = recorder({ brew: 1 });
    let started = false;
    const out = await installTool("docker", () => undefined, { ...mac, runner, startDocker: async () => { started = true; return { ok: true, version: "x", engine: "Colima", waitedMs: 0 }; } });
    expect(out).toMatchObject({ ok: false, code: "brew_failed" });
    expect(started).toBe(false);
  });

  test("Zapp and the DFU tools are their homebrew-core formulae, with nothing started after", async () => {
    expect(brewFormulae("zapp")).toEqual(["zapp"]);
    expect(brewFormulae("dfu-util")).toEqual(["dfu-util"]);
    const { runner, calls } = recorder();
    expect(await installTool("zapp", () => undefined, { ...mac, runner })).toEqual({ ok: true });
    expect(calls).toEqual([["brew", "install", "zapp"]]);
  });

  test("Codex is its Homebrew cask, with nothing started after (R3-24)", async () => {
    expect(brewFormulae("codex")).toEqual(["--cask", "codex"]);
    const { runner, calls } = recorder();
    expect(await installTool("codex", () => undefined, { ...mac, runner })).toEqual({ ok: true });
    expect(calls).toEqual([["brew", "install", "--cask", "codex"]]);
  });

  test("no Homebrew, or not a Mac: nothing runs, and the code says why", async () => {
    const { runner, calls } = recorder();
    // Zapp is downloaded instead on a Mac without Homebrew (D-561), so a tool keyloom pins no release for stands in here.
    expect(await installTool("avrdude", () => undefined, { platform: "darwin", has: () => false, runner })).toMatchObject({ ok: false, code: "no_brew" });
    expect(await installTool("docker", () => undefined, { platform: "linux", has: () => true, runner })).toMatchObject({ ok: false, code: "no_brew" });
    expect(calls).toEqual([]);
    expect(canInstall(mac)).toBe(true);
    expect(canInstall({ platform: "win32", has: () => true })).toBe(false);
  });

  test("a forgotten fake runner is refused by the test preload instead of installing", async () => {
    expect(process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS).toBe("1");
    const out = await installTool("zapp", () => undefined, mac);
    expect(out).toMatchObject({ ok: false, code: "brew_failed" });
    if (!out.ok) expect(out.reason).toContain("refusing");
  });
});

describe("installJobs", () => {
  test("starts once, joins a second click, keeps the output and ends succeeded", async () => {
    const release = Promise.withResolvers<void>();
    let runs = 0;
    const runner: InstallRunner = async (_cmd, opts) => {
      runs += 1;
      opts.onLine("==> Pouring zapp");
      opts.onLine("");
      await release.promise;
      return { exitCode: 0, timedOut: false };
    };
    const jobs = installJobs({ ...mac, runner });
    expect(jobs.get("zapp").status).toBe("idle");
    expect(jobs.start("zapp")).toMatchObject({ status: "running", phase: "installing" });
    expect(jobs.start("zapp").status).toBe("running");
    await Bun.sleep(5);
    expect(runs).toBe(1);
    expect(jobs.get("zapp").logTail).toEqual(["keyloom: brew install zapp", "==> Pouring zapp"]);
    release.resolve();
    await Bun.sleep(5);
    expect(jobs.get("zapp")).toMatchObject({ status: "succeeded", phase: null, error: null });
  });

  test("a failed install keeps its reason and code, and a new start runs again", async () => {
    let exitCode = 1;
    const runner: InstallRunner = async () => ({ exitCode, timedOut: false });
    const jobs = installJobs({ ...mac, runner });
    jobs.start("dfu-util");
    await Bun.sleep(5);
    expect(jobs.get("dfu-util")).toMatchObject({ status: "failed", errorCode: "brew_failed" });
    exitCode = 0;
    jobs.start("dfu-util");
    await Bun.sleep(5);
    expect(jobs.get("dfu-util").status).toBe("succeeded");
  });

  test("Cancel stops Homebrew through its signal, says it is stopping, and ends cancelled (R2-08)", async () => {
    let seen: AbortSignal | undefined;
    const runner: InstallRunner = (_cmd, opts) => new Promise((resolve) => {
      seen = opts.signal;
      opts.signal?.addEventListener("abort", () => resolve({ exitCode: null, timedOut: false }), { once: true });
    });
    const jobs = installJobs({ ...mac, runner });
    jobs.start("docker");
    await Bun.sleep(5);
    expect(seen?.aborted).toBe(false);
    const stopping = jobs.cancel("docker");
    expect(stopping).toMatchObject({ status: "running", phase: "stopping" });
    expect(stopping.logTail.at(-1)).toBe("keyloom: stopping the install");
    expect(seen?.aborted).toBe(true);
    // A second start while it stops joins it rather than starting another brew.
    expect(jobs.start("docker").phase).toBe("stopping");
    await Bun.sleep(5);
    expect(jobs.get("docker")).toMatchObject({ status: "cancelled", phase: null, error: null, errorCode: null });
    // Cancel on an install that isn't running changes nothing.
    expect(jobs.cancel("docker").status).toBe("cancelled");
    expect(jobs.cancel("zapp").status).toBe("idle");
  });

  test("cancelAll, which serve's shutdown runs, stops every running install and waits for Homebrew to exit (#277 review)", async () => {
    const signals: AbortSignal[] = [];
    const runner: InstallRunner = (_cmd, opts) => new Promise((resolve) => {
      if (opts.signal) signals.push(opts.signal);
      opts.signal?.addEventListener("abort", () => setTimeout(() => resolve({ exitCode: null, timedOut: false }), 5), { once: true });
    });
    const jobs = installJobs({ ...mac, runner });
    jobs.start("zapp");
    jobs.start("dfu-util");
    await Bun.sleep(5);
    await jobs.cancelAll();
    expect(signals.map((s) => s.aborted)).toEqual([true, true]);
    expect(jobs.get("zapp").status).toBe("cancelled");
    expect(jobs.get("dfu-util").status).toBe("cancelled");
    // Nothing running: it returns at once.
    await jobs.cancelAll();
  });

  test("Cancel while Docker starts stops the start too, and no Try again state follows", async () => {
    let startSignal: AbortSignal | undefined;
    const { runner } = recorder();
    const jobs = installJobs({ ...mac, runner, startDocker: (_say, signal) => new Promise((resolve) => {
      startSignal = signal;
      signal?.addEventListener("abort", () => resolve({ ok: false, engine: "Colima", reason: "Stopped starting Colima." }), { once: true });
    }) });
    jobs.start("docker");
    await Bun.sleep(5);
    expect(jobs.get("docker").phase).toBe("starting");
    jobs.cancel("docker");
    await Bun.sleep(5);
    expect(startSignal?.aborted).toBe(true);
    expect(jobs.get("docker")).toMatchObject({ status: "cancelled", errorCode: null });
  });
});

describe("Get Zapp, on a Mac without Homebrew (D-561)", () => {
  const noBrew = { platform: "darwin" as const, has: () => false };

  test("downloads Zapp's pinned release instead of running brew, in the downloading phase", async () => {
    const dir = tempDir("keyloom-kept-");
    const { runner, calls } = recorder();
    const phases: string[] = [];
    const out = await installTool("zapp", () => undefined, { ...noBrew, runner, download: { fetch: serving(zappTar).fetch, dir, arch: "arm64", pins: testPins() } }, (p) => phases.push(p));
    expect(out).toEqual({ ok: true });
    expect(calls).toEqual([]);
    expect(phases).toEqual(["downloading"]);
    expect(readdirSync(dir)).toEqual(["zapp"]);
  });

  test("a download that doesn't match ends the job failed with its code, so the page can say why", async () => {
    const dir = tempDir("keyloom-kept-");
    const jobs = installJobs({ ...noBrew, download: { fetch: serving(new Uint8Array([9])).fetch, dir, arch: "arm64", pins: testPins() } });
    jobs.start("zapp");
    for (let i = 0; i < 50 && jobs.get("zapp").status === "running"; i++) await Bun.sleep(5);
    expect(jobs.get("zapp")).toMatchObject({ status: "failed", errorCode: "checksum_mismatch", error: expect.stringContaining("Zapp 1.0.2") });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("Homebrew stays first where it is, and only Zapp is downloaded", async () => {
    const { runner, calls } = recorder();
    await installTool("zapp", () => undefined, { ...mac, runner, download: { fetch: serving(zappTar).fetch, dir: tempDir("keyloom-kept-"), arch: "arm64", pins: testPins() } });
    expect(calls).toEqual([["brew", "install", "zapp"]]);
    const dfu = await installTool("dfu-util", () => undefined, { ...noBrew, runner, download: { arch: "arm64" } });
    expect(dfu).toMatchObject({ ok: false, code: "no_brew" });
  });

  // R12-01: a failed Homebrew install offers keyloom's own download, which runs even though Homebrew is here.
  test("Download Zapp after a failed Homebrew install downloads the pinned release where Homebrew is, and runs no brew", async () => {
    const dir = tempDir("keyloom-kept-");
    const { runner, calls } = recorder({ brew: 1 });
    const jobs = installJobs({ ...mac, runner, download: { fetch: serving(zappTar).fetch, dir, arch: "arm64", pins: testPins() } });
    jobs.start("zapp");
    for (let i = 0; i < 50 && jobs.get("zapp").status === "running"; i++) await Bun.sleep(5);
    expect(jobs.get("zapp")).toMatchObject({ status: "failed", errorCode: "brew_failed" });
    jobs.start("zapp", "download");
    expect(jobs.get("zapp").phase).toBe("downloading");
    for (let i = 0; i < 50 && jobs.get("zapp").status === "running"; i++) await Bun.sleep(5);
    expect(jobs.get("zapp")).toMatchObject({ status: "succeeded", errorCode: null });
    expect(calls).toEqual([["brew", "install", "zapp"]]);
    expect(readdirSync(dir)).toEqual(["zapp"]);
  });

  test("a download asked for where there is no release file says so in words, with its code", async () => {
    const out = await installTool("zapp", () => undefined, { ...mac, download: { arch: "ppc64", dir: tempDir("keyloom-kept-") } }, undefined, undefined, "download");
    expect(out).toMatchObject({ ok: false, code: "no_asset", reason: expect.stringContaining("no download for this Mac's processor") });
    const linux = await installTool("zapp", () => undefined, { platform: "linux", has: () => true, download: { arch: "x64" } }, undefined, undefined, "download");
    expect(linux).toMatchObject({ ok: false, code: "unsupported_platform" });
  });

  test("a processor with no Zapp release falls back to the Homebrew answer: keyloom can't install it here", async () => {
    const out = await installTool("zapp", () => undefined, { ...noBrew, download: { arch: "ppc64", dir: join(tempDir("keyloom-kept-"), "bin") } });
    expect(out).toMatchObject({ ok: false, code: "no_brew" });
  });
});
