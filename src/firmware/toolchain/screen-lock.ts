// macOS doesn't mount a new drive while the screen is locked, so a UF2 flash started then strands a half in its bootloader
// (D-442). ioreg's IORegistry plist holds the console sessions; plutil extracts just them as JSON, because the whole plist
// has <data> values that plutil can't write as JSON.
import { z } from "zod";

export const SCREEN_LOCK_MESSAGE = "Unlock your Mac first: macOS doesn't mount the keyboard's boot drive while the screen is locked.";

// macOS omits CGSSessionScreenIsLocked while a session is unlocked.
const consoleUsersSchema = z.array(z.object({ kCGSSessionUserIDKey: z.number().int(), CGSSessionScreenIsLocked: z.boolean().optional() }).passthrough());

/** Whether the session of user `uid` is locked, from `plutil -extract IOConsoleUsers json` output. */
export function parseConsoleUsers(json: string, uid: number): boolean {
  const users = consoleUsersSchema.parse(JSON.parse(json));
  const session = users.find((u) => u.kCGSSessionUserIDKey === uid);
  if (!session) throw new Error("the current user has no console session");
  return session.CGSSessionScreenIsLocked === true;
}

export const PLUTIL_EXTRACT = ["/usr/bin/plutil", "-extract", "IOConsoleUsers", "json", "-o", "-", "-"] as const;

/** Probe errors fail open: a broken status check must never prevent flashing. */
export async function screenIsLocked(log: (line: string) => void): Promise<boolean> {
  try {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("the current user id is unavailable");
    const ioreg = Bun.spawn(["/usr/sbin/ioreg", "-n", "Root", "-d1", "-a"], { stdout: "pipe", stderr: "ignore" });
    const plutil = Bun.spawn([...PLUTIL_EXTRACT], { stdin: ioreg.stdout, stdout: "pipe", stderr: "pipe" });
    const [json, err, code, ioregCode] = await Promise.all([new Response(plutil.stdout).text(), new Response(plutil.stderr).text(), plutil.exited, ioreg.exited]);
    if (ioregCode !== 0 || code !== 0) throw new Error(`ioreg exited ${ioregCode}, plutil exited ${code}${err.trim() ? `: ${err.trim()}` : ""}`);
    return parseConsoleUsers(json, uid);
  } catch (error) {
    log(`keyloom: couldn't read the macOS screen-lock state; continuing with the UF2 flash: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
