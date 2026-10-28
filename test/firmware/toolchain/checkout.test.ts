import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CheckoutError, checkoutState, ensureCheckout } from "../../../src/firmware/toolchain/checkout.ts";
import { git, gitEnv, originRepo } from "../../helpers/git-fixture.ts";
import { withPath } from "../../helpers/fake-bin.ts";
import { tempDir } from "../../helpers/tmp.ts";

// These tests spawn git clones and submodule fetches; loaded full runs have exceeded Bun's 5 s default.
setDefaultTimeout(30_000);

const inFileProtocol = <T>(fn: () => Promise<T>) => withPath("/nonexistent-extra-path", fn, gitEnv);

describe("ensureCheckout", () => {
  test("creates the checkout from nothing at the pinned SHA, with the listed submodules, and does nothing the second time", async () => {
    const origin = originRepo({ submodule: true });
    const dir = join(tempDir(), "build", "board");
    const spec = { dir, repo: origin.url, sha: origin.sha, submodules: ["lib/chibios"] };
    await inFileProtocol(async () => {
      const lines: string[] = [];
      await ensureCheckout(spec, { onLine: (l) => lines.push(l) });
      expect(git(dir, "rev-parse", "HEAD")).toBe(origin.sha);
      expect(existsSync(join(dir, "lib/chibios/os.c"))).toBe(true);
      expect(lines[0]).toContain("creating");
      const state = await checkoutState(spec);
      expect(state).toMatchObject({ present: true, pinned: true, uninitialised: [], drifted: [] });

      const again: string[] = [];
      await ensureCheckout(spec, { onLine: (l) => again.push(l) });
      expect(again).toEqual([]);
    });
    expect(existsSync(`${dir}.partial-${process.pid}`)).toBe(false);
  });

  test("a submodule that has not been fetched is fetched on the next use", async () => {
    const origin = originRepo({ submodule: true });
    const dir = join(tempDir(), "board");
    await inFileProtocol(async () => {
      await ensureCheckout({ dir, repo: origin.url, sha: origin.sha, submodules: [] });
      expect(existsSync(join(dir, "lib/chibios/os.c"))).toBe(false);
      const spec = { dir, repo: origin.url, sha: origin.sha, submodules: ["lib/chibios"] };
      expect((await checkoutState(spec) as { uninitialised: string[] }).uninitialised).toEqual(["lib/chibios"]);
      await ensureCheckout(spec);
      expect(existsSync(join(dir, "lib/chibios/os.c"))).toBe(true);
    });
  });

  test("a checkout at another commit is refused, not built from", async () => {
    const origin = originRepo();
    const dir = join(tempDir(), "board");
    await ensureCheckout({ dir, repo: origin.url, sha: origin.sha, submodules: [] });
    const other = { dir, repo: origin.url, sha: "0".repeat(40), submodules: [] };
    await expect(ensureCheckout(other)).rejects.toThrow(/pins 0{40}/);
    expect(await checkoutState(other)).toMatchObject({ present: true, pinned: false });
  });

  test("a failed first clone leaves nothing that looks like a checkout", async () => {
    const origin = originRepo();
    const dir = join(tempDir(), "board");
    await expect(ensureCheckout({ dir, repo: origin.url, sha: "1".repeat(40), submodules: [] })).rejects.toBeInstanceOf(CheckoutError);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(`${dir}.partial-${process.pid}`)).toBe(false);
  });

  test("a directory that is not a checkout is not overwritten", async () => {
    const origin = originRepo();
    const dir = tempDir();
    await Bun.write(join(dir, "mine.txt"), "keep");
    await expect(ensureCheckout({ dir, repo: origin.url, sha: origin.sha, submodules: [] })).rejects.toThrow(/not a git checkout/);
    expect(await Bun.file(join(dir, "mine.txt")).text()).toBe("keep");
  });
});
