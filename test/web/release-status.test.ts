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
});
