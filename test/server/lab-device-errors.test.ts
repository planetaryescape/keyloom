import { afterAll, expect, spyOn, test } from "bun:test";
import { appLabBackend } from "../../src/cli/lab-backend.ts";
import { DeviceTransportError } from "../../src/firmware/toolchain/device-helper/transport-client.ts";
import type { HidTransport } from "../../src/firmware/toolchain/hid.ts";
import { findQmkStreamDevice, startQmkCapture } from "../../src/firmware/qmk/typing-capture.ts";
import type { LabDeps } from "../../src/app/lab.ts";
import { handleLabRoute } from "../../src/server/lab-routes.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";

const TOKEN = "t".repeat(43);
const apps: Array<{ db: { close(): void } }> = [];
afterAll(() => {
  for (const app of apps) app.db.close();
});

async function startFailure(error: Error) {
  const { app, layoutId } = await commandShiftApp();
  apps.push(app);
  let opens = 0;
  let writes = 0;
  let replays = 0;
  const syntheticTransport: HidTransport = {
    list: async () => [{ vendorId: 0x3297, productId: 0x1969, serial: "keyloom/NPQRSTVWXYZ0", handle: "synthetic-only" }],
    write: async () => { writes++; throw new Error("unexpected direct HID write"); },
    openSession: async () => { opens++; throw error; },
  };
  const deps: LabDeps = {
    startCapture: async (_board, hooks) => startQmkCapture(syntheticTransport, await findQmkStreamDevice(syntheticTransport), hooks),
    replay: () => { replays++; throw new Error("recording start must not replay"); },
  };
  const backend = appLabBackend(app, deps);
  const request = new Request(`http://keyloom.test/api/lab/${layoutId}/recording`, {
    method: "POST",
    headers: { "x-keyloom-token": TOKEN, "content-type": "application/json" },
    body: "{}",
  });
  const response = await handleLabRoute(request, new URL(request.url).pathname, backend, TOKEN);
  if (response === null) throw new Error("the lab recording route did not match");
  return { response, opens: () => opens, writes: () => writes, replays: () => replays };
}

test("a busy keyboard connection returns an actionable conflict without retrying capture", async () => {
  const error = new DeviceTransportError({ code: "busy", effect: "none", retry: "after_user_action" });
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await startFailure(error);
    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toEqual({
      error: {
        code: "busy",
        message: "Another application or keyloom instance is using this keyboard. Stop the other client, then try again.",
      },
    });
    expect(result.opens()).toBe(1);
    expect(result.writes()).toBe(0);
    expect(result.replays()).toBe(0);
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test("denied keyboard access returns an actionable conflict without claiming a specific permission fixes it", async () => {
  const error = new DeviceTransportError({ code: "permission_denied", effect: "none", retry: "after_user_action" });
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await startFailure(error);
    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toEqual({
      error: {
        code: "permission_denied",
        message: "The operating system denied keyboard access. Check the device-access permissions required by your platform for keyloom, then try again.",
      },
    });
    expect(result.opens()).toBe(1);
    expect(result.writes()).toBe(0);
    expect(result.replays()).toBe(0);
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test("an unclassified capture error remains an internal error and is not exposed", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await startFailure(new Error("synthetic unclassified failure"));
    expect(result.response.status).toBe(500);
    expect(await result.response.json()).toEqual({ error: { code: "internal", message: "internal error" } });
    expect(result.opens()).toBe(1);
    expect(result.writes()).toBe(0);
    expect(result.replays()).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  } finally { log.mockRestore(); }
});
