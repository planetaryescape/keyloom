import { describe, expect, test } from "bun:test";
import { PLUTIL_EXTRACT, parseConsoleUsers } from "../../../src/firmware/toolchain/screen-lock.ts";

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

// The shape `ioreg -n Root -d1 -a` prints, cut down: a <data> value elsewhere in the registry is why the probe extracts only
// IOConsoleUsers (plutil can't write <data> as JSON). Synthetic, so no real machine's details are checked in.
const IOREG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>IOConsoleUsers</key>
  <array>
    <dict>
      <key>CGSSessionScreenIsLocked</key><true/>
      <key>kCGSSessionOnConsoleKey</key><true/>
      <key>kCGSSessionUserIDKey</key><integer>501</integer>
    </dict>
  </array>
  <key>IOPlatformBlob</key><data>AAECAw==</data>
</dict>
</plist>
`;

describe.skipIf(process.platform !== "darwin")("macOS screen lock through plutil", () => {
  test("the probe's extraction of a registry with <data> values reads the lock", async () => {
    const plutil = Bun.spawn([...PLUTIL_EXTRACT], { stdin: new TextEncoder().encode(IOREG), stdout: "pipe" });
    const [json, code] = await Promise.all([new Response(plutil.stdout).text(), plutil.exited]);
    expect(code).toBe(0);
    expect(parseConsoleUsers(json, 501)).toBe(true);
  });
});
