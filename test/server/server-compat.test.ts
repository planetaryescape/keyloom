// Which running server a client may use, and the polarity of "older" (D-454).
import { describe, expect, test } from "bun:test";
import { DESKTOP_PROTOCOL, REPLACE_LABEL, assessServer, compareVersions, wouldDowngrade } from "../../src/server/server-compat.ts";

const mine = { version: "0.57.0", protocol: DESKTOP_PROTOCOL };
const dir = "/data";

describe("compareVersions", () => {
  test("orders by semver, so 0.10 is newer than 0.9 and a prerelease is older than its release", () => {
    expect(compareVersions("0.56.0", "0.57.0")).toBe(-1);
    expect(compareVersions("0.57.0", "0.57.0")).toBe(0);
    expect(compareVersions("0.58.0", "0.57.0")).toBe(1);
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.57.0-dev", "0.57.0")).toBe(-1);
    expect(compareVersions("0.57.0", "0.57.0-rc.1")).toBe(1);
  });

  test("anything that isn't a full version is unknown rather than a guess", () => {
    for (const bad of [undefined, "", "abc", "1.0", "v0.56.0", "0.56.0 "]) expect(compareVersions(bad, "0.57.0")).toBeUndefined();
  });
});

describe("assessServer", () => {
  test("the same protocol is compatible whatever the version", () => {
    expect(assessServer({ version: "0.50.0", protocol: DESKTOP_PROTOCOL }, mine, dir)).toEqual({ compatible: true });
    expect(assessServer({ version: "9.0.0", protocol: DESKTOP_PROTOCOL }, mine, dir)).toEqual({ compatible: true });
  });

  test("an older server on another protocol may be replaced", () => {
    const v = assessServer({ version: "0.56.0", protocol: 0 }, mine, dir);
    expect(v).toMatchObject({ compatible: false, replaceLabel: REPLACE_LABEL });
    expect((v as { words: string }).words).toContain("keyloom 0.56.0");
  });

  test("a record with no version or protocol predates the check: older, replace offered", () => {
    const v = assessServer({}, mine, dir);
    expect(v).toMatchObject({ compatible: false, replaceLabel: REPLACE_LABEL });
    expect((v as { words: string }).words).toContain("predates version checks");
  });

  test("an unreadable version counts as unknown, so replacing is offered", () => {
    expect(assessServer({ version: "banana", protocol: 7 }, mine, dir)).toMatchObject({ compatible: false, replaceLabel: REPLACE_LABEL });
  });

  test("a newer server is never offered for replacing, and the words say to update", () => {
    const v = assessServer({ version: "0.58.0", protocol: DESKTOP_PROTOCOL + 1 }, mine, dir);
    expect(v).toMatchObject({ compatible: false, replaceLabel: null });
    expect((v as { words: string }).words).toMatch(/newer than this 0\.57\.0/);
    expect((v as { words: string }).words).toMatch(/Update/);
  });

  test("a development build of the next release is older than the release, and a prerelease of this version is older than it", () => {
    expect(assessServer({ version: "0.57.0-dev", protocol: 0 }, mine, dir)).toMatchObject({ replaceLabel: REPLACE_LABEL });
    expect(assessServer({ version: "0.58.0-dev", protocol: 0 }, mine, dir)).toMatchObject({ replaceLabel: null });
  });

  test("the same version on a different protocol is not offered either", () => {
    expect(assessServer({ version: "0.57.0", protocol: 0 }, mine, dir)).toMatchObject({ compatible: false, replaceLabel: null });
  });
});

describe("wouldDowngrade", () => {
  test("only a server that is certainly newer", () => {
    expect(wouldDowngrade({ version: "0.58.0" }, mine)).toBe(true);
    expect(wouldDowngrade({ version: "0.57.0" }, mine)).toBe(false);
    expect(wouldDowngrade({ version: "0.56.0" }, mine)).toBe(false);
    expect(wouldDowngrade({}, mine)).toBe(false);
    expect(wouldDowngrade({ version: "x" }, mine)).toBe(false);
  });
});
