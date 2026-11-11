import { describe, expect, test } from "bun:test";
import { releaseStatus } from "../../src/web/release/status.ts";

const build = {
  id: "bld_test", revisionId: "rev_test", status: "succeeded" as const, error: null, errorCode: null,
  flashPlan: { manual: null, tool: null, canReveal: true }, startedAt: 1, finishedAt: 2, logTail: [],
};

const flash = (verified: boolean) => ({
  id: "fl_test", buildId: build.id, status: "succeeded" as const, error: null,
  startedAt: 3, finishedAt: 4, instruction: null, note: verified ? "Verified: running build bld_test" : null, verified, logTail: [],
});

describe("release status", () => {
  test("distinguishes a verified flash from a write that could not be verified", () => {
    expect(releaseStatus(build, flash(true), build.revisionId, 4)).toEqual({ label: "Flashed and verified", tone: "success" });
    expect(releaseStatus(build, flash(false), build.revisionId, 4)).toEqual({ label: "Flashed, not verified", tone: "attention" });
  });

  test("a cancelled flash wrote nothing, so the button says the build is ready again; another failure is a failure (D-501)", () => {
    const failed = (errorCode: "cancelled" | "not_confirmed" | "permission_files_and_folders") => ({ ...flash(false), status: "failed" as const, error: "x", errorCode });
    expect(releaseStatus(build, failed("cancelled"), build.revisionId, 4)).toEqual({ label: "Ready to flash", tone: "success" });
    expect(releaseStatus(build, failed("permission_files_and_folders"), build.revisionId, 4)).toEqual({ label: "Flash failed", tone: "error" });
    // Written, and only the confirmation failed: the keyboard may run the build, so it reads like a success that wasn't verified.
    expect(releaseStatus(build, failed("not_confirmed"), build.revisionId, 4)).toEqual({ label: "Flashed, not verified", tone: "attention" });
  });
});
