// Installing Docker and flash tools from a button (D-488, D-489). Every runner here is a fake: no test runs brew,
// colima or docker, and the preload refuses a real install if one is forgotten.
import { describe, expect, test } from "bun:test";
import { type InstallRunner, brewFormulae, canInstall, installJobs, installTool } from "../../src/app/tool-install.ts";

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

  test("no Homebrew, or not a Mac: nothing runs, and the code says why", async () => {
    const { runner, calls } = recorder();
    expect(await installTool("zapp", () => undefined, { platform: "darwin", has: () => false, runner })).toMatchObject({ ok: false, code: "no_brew" });
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
});
