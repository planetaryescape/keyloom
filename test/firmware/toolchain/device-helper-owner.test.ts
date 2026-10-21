import { expect, test } from "bun:test";
import { CandidateHidOwner } from "../../../src/firmware/toolchain/device-helper/owner.ts";
import type { HidTransport } from "../../../src/firmware/toolchain/hid.ts";

const transport: HidTransport = { list: async () => [], write: async () => {} };
test("candidate owner shares one setup and one observed shutdown; never silently reconnects", async () => {
  let connects = 0, closes = 0;
  const owner = new CandidateHidOwner(async () => { connects++; return { transport, shutdown: async () => { closes++; } }; });
  const [first, second] = await Promise.all([owner.transport(), owner.transport()]);
  expect(first).toBe(transport); expect(second).toBe(first);
  await Promise.all([owner.shutdown(), owner.shutdown()]);
  await expect(owner.transport()).rejects.toThrow("start a new command");
  expect(connects).toBe(1); expect(closes).toBe(1);
});
test("failed candidate setup is latched, including a synchronous exception", async () => {
  let attempts = 0;
  const owner = new CandidateHidOwner(() => { attempts++; throw new Error("synthetic setup refused"); });
  await expect(owner.transport()).rejects.toThrow("setup refused");
  await expect(owner.transport()).rejects.toThrow("setup refused");
  await expect(owner.shutdown()).rejects.toThrow("setup refused");
  expect(attempts).toBe(1);
});
test("unused command cleanup launches no helper, and cleanup failure cannot be retried away", async () => {
  let attempts = 0, closes = 0;
  const unused = new CandidateHidOwner(async () => { attempts++; return { transport, shutdown: async () => {} }; });
  await unused.shutdown(); expect(attempts).toBe(0);
  const failed = new CandidateHidOwner(async () => ({ transport, shutdown: async () => { closes++; throw new Error("release unconfirmed"); } }));
  await failed.transport();
  await expect(failed.shutdown()).rejects.toThrow("release unconfirmed");
  await expect(failed.shutdown()).rejects.toThrow("release unconfirmed");
  expect(closes).toBe(1);
});
