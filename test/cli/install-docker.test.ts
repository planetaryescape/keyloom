// `keyloom doctor --install-docker` (D-030 parity with the Install Docker button): the same install, with its lines in the terminal.
// Every runner is a fake; no test runs brew or colima.
import { describe, expect, test } from "bun:test";
import type { InstallRunner } from "../../src/app/tool-install.ts";
import { installDockerWithProgress } from "../../src/cli/install-docker.ts";
import type { DockerStatus } from "../../src/app/toolchain.ts";

// No Docker here: what the guard needs before it installs anything.
const mac = { platform: "darwin" as const, has: (c: string) => c === "brew", status: async (): Promise<DockerStatus> => ({ ok: false, kind: "not-installed", reason: "Docker is not on this computer." }) };
const brew = (exitCode: number): InstallRunner => async (cmd, opts) => {
  opts.onLine(`==> ${cmd.join(" ")}`);
  return { exitCode, timedOut: false };
};

describe("installDockerWithProgress", () => {
  test("streams Homebrew's lines, says when it starts Docker, and ends running", async () => {
    const lines: string[] = [];
    const out = await installDockerWithProgress((l) => lines.push(l), { ...mac, runner: brew(0), startDocker: async (say) => { say("keyloom: Colima is up after 40 s"); return { ok: true, version: "29.0", engine: "Colima", waitedMs: 40_000 }; } });
    expect(out).toEqual({ ok: true });
    expect(lines).toEqual([
      "keyloom: brew install colima docker",
      "==> brew install colima docker",
      "keyloom: Docker is installed; starting it (the first start downloads a small virtual machine)",
      "keyloom: Colima is up after 40 s",
      "keyloom: Docker is installed and running",
    ]);
  });

  test("a start that fails after the install points at --start-docker, not another install", async () => {
    const lines: string[] = [];
    const out = await installDockerWithProgress((l) => lines.push(l), { ...mac, runner: brew(0), startDocker: async () => ({ ok: false, engine: "Colima", reason: "Colima did not answer within 960 s." }) });
    expect(out).toMatchObject({ ok: false, code: "start_failed" });
    expect(lines.at(-1)).toContain("keyloom doctor --start-docker");
  });

  test("where Docker is already here, it installs nothing and says what is there (#277 review)", async () => {
    let brewed = 0;
    const runner: InstallRunner = async () => (brewed++, { exitCode: 0, timedOut: false });
    const running: string[] = [];
    expect(await installDockerWithProgress((l) => running.push(l), { ...mac, runner, status: async () => ({ ok: true, version: "28.4" }) })).toEqual({ ok: true });
    expect(running).toEqual(["keyloom: Docker 28.4 is already installed and running, so nothing was installed"]);
    const stopped: string[] = [];
    await installDockerWithProgress((l) => stopped.push(l), { ...mac, runner, status: async () => ({ ok: false, kind: "daemon-down", reason: "The Docker daemon isn't running." }) });
    expect(stopped.at(-1)).toContain("nothing was installed");
    expect(stopped.at(-1)).toContain("keyloom doctor --start-docker");
    const app: string[] = [];
    await installDockerWithProgress((l) => app.push(l), { ...mac, runner, status: async () => ({ ok: false, kind: "cli-missing", app: "OrbStack", reason: "OrbStack is installed, but its `docker` command isn't on keyloom's PATH." }) });
    expect(app.at(-1)).toContain("OrbStack is installed");
    expect(brewed).toBe(0);
  });

  test("a failed brew and a computer without Homebrew each say so", async () => {
    const failed: string[] = [];
    expect(await installDockerWithProgress((l) => failed.push(l), { ...mac, runner: brew(1) })).toMatchObject({ ok: false, code: "brew_failed" });
    expect(failed.at(-1)).toStartWith("keyloom: Docker didn't install: Homebrew stopped with exit code 1.");
    const none: string[] = [];
    expect(await installDockerWithProgress((l) => none.push(l), { ...mac, platform: "linux", has: () => false, runner: brew(0) })).toMatchObject({ ok: false, code: "no_brew" });
    expect(none.at(-1)).toContain("names the page to install it from");
  });
});
