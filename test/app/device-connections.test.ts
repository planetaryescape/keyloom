import { expect, test } from "bun:test";
import { drainDeviceConsumers } from "../../src/app/device-connections.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

test("helper close waits for every consumer after an earlier rejection", async () => {
  const later = deferred<void>();
  const firstFailure = new Error("first consumer failed");
  let closes = 0;
  const drain = drainDeviceConsumers([
    Promise.reject(firstFailure),
    later.promise,
  ], async () => { closes++; });

  await Promise.resolve();
  expect(closes).toBe(0);
  later.resolve();
  await expect(drain).rejects.toBe(firstFailure);
  expect(closes).toBe(1);
});

test("close failure is surfaced alongside consumer failures and close is called once", async () => {
  const consumerFailure = new Error("consumer drain failed");
  const closeFailure = new Error("helper shutdown failed");
  let closes = 0;
  const drain = drainDeviceConsumers([
    Promise.reject(consumerFailure),
    Promise.resolve(),
  ], async () => { closes++; throw closeFailure; });

  let caught: unknown;
  try { await drain; } catch (error) { caught = error; }
  if (!(caught instanceof AggregateError)) throw new Error("both drain failures must be surfaced");
  expect(caught.errors).toEqual([consumerFailure, closeFailure]);
  expect(closes).toBe(1);
});

test("helper close failure is not hidden when all consumers drain successfully", async () => {
  const closeFailure = new Error("helper shutdown failed");
  let closes = 0;
  await expect(drainDeviceConsumers([Promise.resolve()], async () => { closes++; throw closeFailure; })).rejects.toBe(closeFailure);
  expect(closes).toBe(1);
});
