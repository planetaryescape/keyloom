// R10-07: a running install whose reads keep failing says keyloom lost track of it, instead of "Installing…" for ever with nothing said.
import { describe, expect, test } from "bun:test";
import { installLost } from "../../src/web/release/useInstall.ts";
import { retryHelps } from "../../src/web/release/UnexpectedActions.tsx";

describe("installLost", () => {
  test("a lost connection keeps reading by itself, and Check again can pass", () => {
    const lost = installLost({ message: "keyloom isn't answering.", code: "unreachable" });
    expect(lost).toEqual({ failure: { message: "keyloom lost track of the install, so it can't say how it is going. It keeps checking by itself.", code: "unreachable" }, keepReading: true });
    expect(retryHelps(lost.failure)).toBe(true);
  });

  test("an exception keeps reading and keeps keyloom's own words, which name the log", () => {
    const lost = installLost({ message: "keyloom hit a problem it didn't expect. The details are in keyloom's log.", code: "internal" });
    expect(lost.keepReading).toBe(true);
    expect(lost.failure.message).toEndWith("It keeps checking by itself. keyloom hit a problem it didn't expect. The details are in keyloom's log.");
  });

  test("an answer the page can't read, or keyloom's catch-all 404, stops reading and offers no Check again", () => {
    for (const failure of [{ message: "keyloom sent an answer this page can't read.", code: "unreadable" }, { message: "keyloom couldn't find what this page asked for.", code: "not_found", generic: true }]) {
      const lost = installLost(failure);
      expect(lost.keepReading).toBe(false);
      expect(lost.failure.message).toStartWith("keyloom lost track of the install");
      expect(retryHelps(lost.failure)).toBe(false);
    }
  });
});
