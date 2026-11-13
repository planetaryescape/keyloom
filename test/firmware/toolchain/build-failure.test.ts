// R5-02: the lines that say a firmware doesn't fit, read from what the toolchains print (test/fixtures/build-logs/README.md).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { NOT_SHARED_EXIT, PROBE_CLEANUP_EXIT, classifyBuildFailure, firmwareOverflow, probeFailure, tooLargeMessage } from "../../../src/firmware/toolchain/build-failure.ts";
import { pruneTotal } from "../../../src/firmware/toolchain/docker.ts";
import { generatedSourceError } from "../../../src/firmware/qmk/locate-error.ts";

const log = async (name: string) => (await Bun.file(join(import.meta.dir, "../../fixtures/build-logs", name)).text()).split("\n");

test("GNU ld's overflow gives the bytes; its 'will not fit' alone says only that it doesn't fit", async () => {
  expect(firmwareOverflow(await log("ld-region-overflow.log"))).toEqual({ bytes: 228 });
  expect(firmwareOverflow(["ld: a2.elf section `.data' will not fit in region `FLASH'"])).toEqual({ bytes: null });
});

test("QMK's AVR size check is read through its colour codes", async () => {
  expect(firmwareOverflow(await log("qmk-avr-too-large.log"))).toEqual({ bytes: 262 });
});

test("a compile error or a full disk is not an overflow", async () => {
  expect(firmwareOverflow(await log("qmk-unknown-keycode.log"))).toBeNull();
  expect(firmwareOverflow(await log("zmk-docker-disk-full.log"))).toBeNull();
});

test("the message names the board and the bytes", () => {
  expect(tooLargeMessage("Glove80", { bytes: 1 })).toBe("The firmware is too big for the Glove80's memory by 1 byte. Fewer combos, macros or features make it smaller.");
  expect(tooLargeMessage("Glove80", { bytes: null })).toBe("The firmware is too big for the Glove80's memory. Fewer combos, macros or features make it smaller.");
});

test("a compile error in another generated file names the file, and one outside keyloom's folder is not keyloom's", () => {
  expect(generatedSourceError(["keyboards/zsa/moonlander/keymaps/keyloom/config.h:12:9: error: expected identifier"], "keyloom")).toBe("config.h:12: expected identifier");
  expect(generatedSourceError(["quantum/action.c:3:1: error: bad"], "keyloom")).toBeUndefined();
});

test("a probe is folder_not_shared only when its sentinel is missing; a failed cleanup or Docker's own failure says so and keeps no code (R7-02, PR #303)", () => {
  expect(probeFailure(NOT_SHARED_EXIT, [], "/c", "Docker can't see /c.")).toMatchObject({ code: "folder_not_shared", message: "Docker can't see /c." });
  const cleanup = probeFailure(PROBE_CLEANUP_EXIT, [], "/c", "Docker can't see /c.");
  expect(cleanup.code).toBeNull();
  expect(cleanup.message).toBe("keyloom couldn't clear the last build's output in /c. The error is in the build log; build again.");
  const docker = probeFailure(125, ["docker: Error response from daemon: no such image"], "/c", "Docker can't see /c.");
  expect(docker.code).toBeNull();
  expect(docker.message).toContain("(exit 125)");
  expect(probeFailure(null, [], "/c", "x").message).toContain("it was stopped");
});

test("a full Docker disk is disk_full wherever it shows, and the terminal keeps the prune command (R8-04)", async () => {
  const full = await log("zmk-docker-disk-full.log");
  const driver = { boardName: "Glove80", docker: "Docker ran out of disk space. Free its build cache with `docker builder prune`, or raise its disk limit, then build again.", compileError: () => undefined, generic: "x" };
  expect(classifyBuildFailure(full, driver)).toMatchObject({ code: "disk_full", message: expect.stringContaining("`docker builder prune`") });
  // A stopped daemon, the drivers' other Docker trouble, is docker_unavailable, so the page shows its Docker callout (R9-11).
  expect(classifyBuildFailure(["Cannot connect to the Docker daemon"], { ...driver, docker: "Docker isn't running." }).code).toBe("docker_unavailable");
  expect(probeFailure(1, ["cp: write error: No space left on device"], "/c", "x").code).toBe("disk_full");
});

test("the total `docker builder prune` prints, from BuildKit and from older clients (R8-04)", () => {
  expect(pruneTotal("ID\tRECLAIMABLE\tSIZE\nabc\ttrue\t1.2GB\nTotal:\t1.234GB\n")).toBe("1.234GB");
  expect(pruneTotal("Deleted build cache objects:\nxyz\n\nTotal reclaimed space: 512.5 MB\n")).toBe("512.5MB");
  expect(pruneTotal("Total:\t0B\n")).toBe("0B");
  expect(pruneTotal("")).toBeNull();
});

test("Docker Desktop's refused mount is folder_not_shared, and the CLI's words name File sharing (PR #303 review)", () => {
  // Docker Desktop's words for a path outside its File sharing list; `docker run` exits 125 before the container starts.
  const denied = ["docker: Error response from daemon: Mounts denied: ", "The path /c is not shared from the host and is not known to Docker.", "You can configure shared paths from Docker -> Preferences... -> Resources -> File Sharing."];
  const failure = probeFailure(125, denied, "/c", "Docker can't see /c.");
  expect(failure.code).toBe("folder_not_shared");
  expect(failure.message).toBe("Docker Desktop doesn't share /c. Allow that folder under Docker Desktop's Settings > Resources > File sharing, or set XDG_CACHE_HOME to a folder it can see.");
  expect(probeFailure(125, ["docker: Error response from daemon: mounts denied: /c"], "/c", "x").code).toBe("folder_not_shared");
});
