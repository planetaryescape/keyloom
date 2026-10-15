// `keyloom flash --reboot-only` and the keyboard lines of `keyloom doctor`, against a fake USB bus and fake raw HID.
import { describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { bootloaderPacket } from "../../src/firmware/qmk/handsfree.ts";
import { dfuBootloader, fakeKeyboard, rawHidOf, runningKeyboard } from "../helpers/fake-hid.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

type Result = { code: number; out: string; err: string };
async function cli(args: string[], handsFree: ReturnType<typeof fakeKeyboard>["deps"]): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io, {}, handsFree), out, err };
}
const json = (r: Result) => JSON.parse(r.out);

const OLD = "keyloom/AAAAAAAAAAAA";

describe("keyloom flash --reboot-only", () => {
  test("restarts a keyboard running keyloom's firmware into its bootloader and flashes nothing", async () => {
    const e = await toolchainEnv();
    let wrote = false;
    const k = fakeKeyboard({ usb: () => (wrote ? [dfuBootloader()] : [runningKeyboard(OLD)]), hid: [rawHidOf(OLD)], onWrite: () => (wrote = true) });
    await e.run(async () => {
      const r = await cli(["flash", "--reboot-only", "--data-dir", e.dataDir, "--format", "json"], k.deps);
      expect(r.code).toBe(0);
      expect(json(r)).toMatchObject({ schema_version: 1, board: "zsa/moonlander", board_revision: "reva", previous_firmware: OLD, bootloader: "0483:df11" });
      expect([...(k.writes[0] as Uint8Array)]).toEqual([...bootloaderPacket()]);
      expect(await Bun.file(e.vars.ZAPP_CALLS).exists()).toBe(false);
      const table = await cli(["flash", "--reboot-only", "--data-dir", e.dataDir, "--format", "table"], fakeKeyboard({ usb: () => [dfuBootloader()], hid: [] }).deps);
      expect(table.code).toBe(2); // the keyboard is already in the bootloader, so none is running to restart
    });
  });

  test("firmware keyloom didn't build is exit 8 with the reason, and nothing is sent", async () => {
    const e = await toolchainEnv();
    const k = fakeKeyboard({ usb: () => [runningKeyboard("QxKPz/zLQ3Md")], hid: [rawHidOf("QxKPz/zLQ3Md")] });
    await e.run(async () => {
      const r = await cli(["flash", "--reboot-only", "--data-dir", e.dataDir], k.deps);
      expect(r.code).toBe(8);
      expect(r.err).toContain("QxKPz/zLQ3Md");
      expect(r.err).toContain("didn't build");
      expect(k.writes).toEqual([]);
    });
  });

  test("no keyboard attached is a usage error, and it can't be combined with a build", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const none = await cli(["flash", "--reboot-only", "--data-dir", e.dataDir], fakeKeyboard({ usb: () => [] }).deps);
      expect(none.code).toBe(2);
      expect(none.err).toContain("no keyboard keyloom can restart is attached");
      const both = await cli(["flash", "--reboot-only", "--build", "bld_x", "--data-dir", e.dataDir], fakeKeyboard({ usb: () => [] }).deps);
      expect(both.code).toBe(2);
    });
  });
});

describe("keyloom doctor, keyboard lines", () => {
  test("reports the running build and whether the next flash needs a keypress", async () => {
    const e = await toolchainEnv();
    await e.run(async () => {
      const mine = json(await cli(["doctor", "--data-dir", e.dataDir], fakeKeyboard({ usb: () => [runningKeyboard(OLD)], hid: [rawHidOf(OLD)] }).deps));
      const line = mine.checks.find((c: { name: string }) => c.name === "keyboard zsa/moonlander reva");
      expect(line).toMatchObject({ ok: true });
      expect(line.detail).toContain(OLD);
      expect(line.detail).toContain("needs no keypress");
      expect(line.detail).toContain("raw HID interface is visible");

      const hidless = json(await cli(["doctor", "--data-dir", e.dataDir], fakeKeyboard({ usb: () => [runningKeyboard(OLD)], hid: [] }).deps));
      expect(hidless.checks.find((c: { name: string }) => c.name === "keyboard zsa/moonlander reva")).toMatchObject({ warn: true });

      const oryx = json(await cli(["doctor", "--data-dir", e.dataDir], fakeKeyboard({ usb: () => [runningKeyboard("QxKPz/zLQ3Md")] }).deps));
      const first = oryx.checks.find((c: { name: string }) => c.name === "keyboard zsa/moonlander reva");
      expect(first.detail).toContain("QxKPz/zLQ3Md");
      expect(first.detail).toContain("first flash needs the bootloader key");

      const none = json(await cli(["doctor", "--data-dir", e.dataDir], fakeKeyboard({ usb: () => [] }).deps));
      expect(none.checks.find((c: { name: string }) => c.name === "keyboard")).toMatchObject({ ok: true, detail: "no keyboard keyloom can flash is attached" });
    });
  });
});
