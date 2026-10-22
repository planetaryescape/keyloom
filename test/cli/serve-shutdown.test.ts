import { expect, spyOn, test } from "bun:test";
import { openApp, closeApp } from "../../src/app/context.ts";
import { SyncEngine } from "../../src/app/sync-engine.ts";
import { ReviewEngine } from "../../src/app/review-engine.ts";
import * as deviceConnections from "../../src/app/device-connections.ts";
import * as server from "../../src/server/start-server.ts";
import { serve } from "../../src/cli/serve.ts";
import { tempDir } from "../helpers/tmp.ts";

function fakeServer() {
  return spyOn(server, "startServer").mockReturnValue({ url: "http://127.0.0.1:4477", token: "synthetic", stop: () => {} });
}

test("serve shutdown reports a rejected start once alongside a helper failure", async () => {
  const app = openApp({ dataDir: tempDir() });
  const start = Promise.withResolvers<void>();
  const reviewsStopped = Promise.withResolvers<void>();
  const failure = new Error("synthetic sync start failure");
  const closeFailure = new Error("synthetic helper close failure");
  const startSpy = spyOn(SyncEngine.prototype, "start").mockImplementation(() => start.promise);
  const engineStop = spyOn(SyncEngine.prototype, "stop").mockResolvedValue(undefined);
  const reviewStop = spyOn(ReviewEngine.prototype, "stop").mockImplementation(() => reviewsStopped.promise);
  const logSpy = spyOn(console, "error").mockImplementation(() => {});
  const serverSpy = fakeServer();
  const closeSpy = spyOn(deviceConnections, "shutdownDeviceConnections").mockRejectedValue(closeFailure);
  const running = serve(app, { port: 0, open: false });
  running.stop();
  running.stop();
  const drained = running.drain?.().catch((error) => error);
  try {
    await Bun.sleep(10);
    expect(closeSpy).not.toHaveBeenCalled();
    start.reject(failure);
    await Bun.sleep(10);
    expect(engineStop).toHaveBeenCalledTimes(1);
    expect(reviewStop).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
    reviewsStopped.resolve();
    expect(await drained).toMatchObject({ errors: [failure, closeFailure] });
    expect(logSpy).toHaveBeenCalledWith("keyloom: keyboard sync could not start", failure);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  } finally {
    start.reject(failure);
    reviewsStopped.resolve();
    await running.drain?.().catch(() => {});
    for (const spy of [startSpy, engineStop, reviewStop, logSpy, serverSpy, closeSpy]) spy.mockRestore();
    closeApp(app);
  }
});

test("serve shutdown preserves both stop failures and waits for the slower stop", async () => {
  const app = openApp({ dataDir: tempDir() });
  const start = Promise.withResolvers<void>();
  const reviewsStopped = Promise.withResolvers<void>();
  const engineFailure = new Error("synthetic engine stop failure");
  const reviewFailure = new Error("synthetic review stop failure");
  const startSpy = spyOn(SyncEngine.prototype, "start").mockImplementation(() => start.promise);
  const engineStop = spyOn(SyncEngine.prototype, "stop").mockRejectedValue(engineFailure);
  const reviewStop = spyOn(ReviewEngine.prototype, "stop").mockImplementation(() => reviewsStopped.promise);
  const serverSpy = fakeServer();
  const closeSpy = spyOn(deviceConnections, "shutdownDeviceConnections").mockResolvedValue(undefined);
  const running = serve(app, { port: 0, open: false });
  running.stop();
  const drained = running.drain?.().catch((error) => error);
  try {
    expect(engineStop).not.toHaveBeenCalled();
    expect(reviewStop).not.toHaveBeenCalled();
    start.resolve();
    await Bun.sleep(10);
    expect(engineStop).toHaveBeenCalledTimes(1);
    expect(reviewStop).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
    reviewsStopped.reject(reviewFailure);
    expect(await drained).toMatchObject({ errors: [engineFailure, reviewFailure] });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  } finally {
    start.resolve();
    reviewsStopped.resolve();
    await running.drain?.().catch(() => {});
    for (const spy of [startSpy, engineStop, reviewStop, serverSpy, closeSpy]) spy.mockRestore();
    closeApp(app);
  }
});
