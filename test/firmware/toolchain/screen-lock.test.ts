import { describe, expect, test } from "bun:test";
import { parseConsoleUsers } from "../../../src/firmware/toolchain/screen-lock.ts";

// The shape `ioreg -n Root -d1 -a | plutil -extract IOConsoleUsers json -o - -` prints (BK's Mac, 2026-10-22).
const users = (current: Record<string, unknown>) => JSON.stringify([
  { kCGSSessionUserIDKey: 502, kCGSSessionOnConsoleKey: false, CGSSessionScreenIsLocked: true },
  { kCGSSessionUserIDKey: 501, kCGSSessionOnConsoleKey: true, ...current },
]);

describe("macOS screen lock", () => {
  test("reads the current user's locked state", () => {
    expect(parseConsoleUsers(users({ CGSSessionScreenIsLocked: true }), 501)).toBe(true);
  });

  test("treats an absent lock key as unlocked", () => {
    expect(parseConsoleUsers(users({}), 501)).toBe(false);
  });

  test("does not use another user's locked state", () => {
    expect(parseConsoleUsers(users({}), 501)).toBe(false);
    expect(parseConsoleUsers(users({}), 502)).toBe(true);
  });

  test("refuses output it can't read, so the probe fails open", () => {
    expect(() => parseConsoleUsers("not json", 501)).toThrow();
    expect(() => parseConsoleUsers(JSON.stringify([{ kCGSSessionUserIDKey: "501" }]), 501)).toThrow();
    expect(() => parseConsoleUsers(users({}), 777)).toThrow(/no console session/);
  });
});
