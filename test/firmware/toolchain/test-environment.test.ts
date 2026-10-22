import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBinDir, withPath } from "../../helpers/fake-bin.ts";
import { gitEnv, originRepo } from "../../helpers/git-fixture.ts";
import { tempDir } from "../../helpers/tmp.ts";

describe("toolchain test environment", () => {
  test("git fixtures configure only their children, including local submodules", () => {
    const before = { ...process.env };
    originRepo({ submodule: true });
    expect({ ...process.env }).toEqual(before);
  });

  test("withPath restores inherited and newly introduced variables after success", async () => {
    const before = { ...process.env };
    const bin = fakeBinDir({});
    const value = await withPath(bin, async () => {
      await Bun.sleep(1);
      expect(process.env.PATH).toBe(`${bin}:${before.PATH}`);
      expect(process.env.FAKE_MODE).toBe("compile");
      expect(process.env.GIT_CONFIG_COUNT).toBe("1");
      return "done";
    }, { ...gitEnv, FAKE_MODE: "compile" });
    expect(value).toBe("done");
    expect({ ...process.env }).toEqual(before);
  });

  test("withPath restores the environment after a rejected callback", async () => {
    const before = { ...process.env };
    await expect(withPath(fakeBinDir({}), async () => {
      await Bun.sleep(1);
      throw new Error("synthetic failure");
    }, { ...gitEnv, FAKE_MODE: "disk" })).rejects.toThrow("synthetic failure");
    expect({ ...process.env }).toEqual(before);
  });

  test("nested scopes restore the outer fake before restoring the parent environment", async () => {
    const before = { ...process.env };
    await withPath(fakeBinDir({}), async () => {
      const outer = { ...process.env };
      await withPath(fakeBinDir({}), async () => {
        expect(process.env.FAKE_MODE).toBe("compile");
      }, { FAKE_MODE: "compile" });
      expect({ ...process.env }).toEqual(outer);
    }, { FAKE_MODE: "ok" });
    expect({ ...process.env }).toEqual(before);
  });

  test("the preload fails leaks of new, changed and deleted variables and restores them for the next test", async () => {
    const dir = tempDir();
    const file = join(dir, "leaks.test.ts");
    await Bun.write(file, `
import { afterAll, expect, test } from "bun:test";
afterAll(() => { process.env.FAKE_B8_AFTER_ALL = "leaked"; });
test("introduces a git config and fake", () => {
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
  process.env.GIT_CONFIG_VALUE_0 = "always";
  process.env.FAKE_B8_NEW = "new";
});
test("the next test starts clean", () => {
  expect(process.env.GIT_CONFIG_COUNT).toBeUndefined();
  expect(process.env.GIT_CONFIG_KEY_0).toBeUndefined();
  expect(process.env.GIT_CONFIG_VALUE_0).toBeUndefined();
  expect(process.env.FAKE_B8_NEW).toBeUndefined();
});
test("changes and deletes inherited fakes", () => {
  process.env.FAKE_MODE = "compile";
  delete process.env.FAKE_B8_BASELINE;
});
test("inherited values are restored", () => {
  expect(process.env.FAKE_MODE).toBe("ok");
  expect(process.env.FAKE_B8_BASELINE).toBe("keep");
});
`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_CONFIG_") && !name.startsWith("FAKE_")));
    const child = Bun.spawn([process.execPath, "test", "--preload", fileURLToPath(new URL("../../helpers/guard-toolchain-env.ts", import.meta.url)), file], {
      cwd: dir, env: { ...env, FAKE_MODE: "ok", FAKE_B8_BASELINE: "keep" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(1);
    const output = stdout + stderr;
    expect(output).toContain("Test leaked toolchain environment: FAKE_B8_NEW, GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0");
    expect(output).toContain("Test leaked toolchain environment: FAKE_B8_BASELINE, FAKE_MODE");
    expect(output).toContain("Test leaked toolchain environment: FAKE_B8_AFTER_ALL");
    expect(output).toContain("2 pass");
    expect(output).toContain("3 fail");
  });
});
