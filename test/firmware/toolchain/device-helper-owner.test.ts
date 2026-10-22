import { expect, test } from "bun:test";
import { CandidateHidOwner } from "../../../src/firmware/toolchain/device-helper/owner.ts";
import { ownHidClient } from "../../../src/firmware/toolchain/device-helper/hid.ts";
import { HelperCleanupUnconfirmedError, HelperSetupFailure } from "../../../src/firmware/toolchain/device-helper/setup-failure.ts";
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
test("confirmed no-child and observed-termination setup failures retain the original error and need no cleanup warning", async () => {
  for (const ownership of ["no_child", "terminated"] as const) {
    const original = new Error(`synthetic ${ownership} refusal`);
    let attempts = 0;
    const owner = new CandidateHidOwner(() => {
      attempts++;
      throw new HelperSetupFailure(original, ownership);
    });
    await expect(owner.transport()).rejects.toBe(original);
    await expect(owner.transport()).rejects.toBe(original);
    await owner.shutdown();
    expect(attempts).toBe(1);
  }
});

test("unknown launcher failure stays latched and shutdown reports cleanup as unconfirmed", async () => {
  const original = new Error("synthetic launcher failed after possible spawn");
  let attempts = 0;
  const owner = new CandidateHidOwner(() => {
    attempts++;
    throw original;
  });
  await expect(owner.transport()).rejects.toBe(original);
  await expect(owner.transport()).rejects.toBe(original);
  const warning = await owner.shutdown().catch((error) => error);
  expect(warning).toBeInstanceOf(HelperCleanupUnconfirmedError);
  if (!(warning instanceof HelperCleanupUnconfirmedError)) throw new Error("unknown launch ownership must remain unconfirmed");
  expect(warning.message).toBe("keyboard helper termination could not be confirmed; restart keyloom before using the keyboard connection again");
  await expect(owner.shutdown()).rejects.toBe(warning);
  expect(attempts).toBe(1);
});

test("observed handshake reap is confirmed; failed teardown of an acquired helper remains visible", async () => {
  const handshake = new Error("synthetic handshake mismatch");
  let setups = 0;
  const failedSetup = new CandidateHidOwner(async () => {
    setups++;
    throw new HelperSetupFailure(handshake, "terminated");
  });
  await expect(failedSetup.transport()).rejects.toBe(handshake);
  await failedSetup.shutdown();
  expect(setups).toBe(1);

  let closes = 0;
  const acquired = new CandidateHidOwner(async () => ({
    transport,
    shutdown: async () => { closes++; throw new Error("release unconfirmed"); },
  }));
  await acquired.transport();
  await expect(acquired.shutdown()).rejects.toThrow("release unconfirmed");
  await expect(acquired.shutdown()).rejects.toThrow("release unconfirmed");
  expect(closes).toBe(1);
});
test("adapter-factory failure after client acquisition awaits teardown and preserves its original error", async () => {
  const original = new Error("synthetic adapter construction failure");
  let closes = 0;
  let caught: unknown;
  try {
    await ownHidClient({ shutdown: async () => { closes++; } }, () => { throw original; });
  } catch (error) { caught = error; }
  if (!(caught instanceof HelperSetupFailure)) throw new Error("factory failure must report observed teardown");
  expect(caught.ownership).toBe("terminated");
  expect(caught.original).toBe(original);
  expect(closes).toBe(1);

  const cleanupFailure = new Error("synthetic teardown failure");
  try {
    await ownHidClient({ shutdown: async () => { throw cleanupFailure; } }, () => { throw original; });
  } catch (error) { caught = error; }
  if (!(caught instanceof HelperSetupFailure)) throw new Error("teardown failure must retain setup ownership state");
  expect(caught.ownership).toBe("unconfirmed");
  expect(caught.cleanupFailure).toBe(cleanupFailure);
  expect(caught.original).toBe(original);
});

test("unused command cleanup launches no helper", async () => {
  let attempts = 0;
  const unused = new CandidateHidOwner(async () => { attempts++; return { transport, shutdown: async () => {} }; });
  await unused.shutdown();
  expect(attempts).toBe(0);
});

test("both adapters share one owner and failed cleanup stays latched for both", async () => {
  const pair = { hid: transport, serial: { list: async () => [], touch: async () => {} } };
  let connects = 0, closes = 0;
  const owner = new CandidateHidOwner(async () => {
    connects++;
    return { transport: pair, shutdown: async () => { closes++; throw new Error("release unconfirmed"); } };
  });
  const [hid, serial] = await Promise.all([owner.transport().then((p) => p.hid), owner.transport().then((p) => p.serial)]);
  expect(hid).toBe(pair.hid); expect(serial).toBe(pair.serial);
  await expect(owner.shutdown()).rejects.toThrow("release unconfirmed");
  await expect(owner.shutdown()).rejects.toThrow("release unconfirmed");
  await expect(owner.transport()).rejects.toThrow("start a new command");
  expect(connects).toBe(1); expect(closes).toBe(1);
});
