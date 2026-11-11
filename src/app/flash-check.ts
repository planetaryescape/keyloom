// "Check the keyboard again" for a flash keyloom wrote but couldn't confirm (R1-15, D-501). It makes the same USB and serial
// reads keyboard sync makes (readKeyboards) and nothing else: no build, no restart into the bootloader, no write to the keyboard.
// When the keyboard now reports this build, the flash's log gains the verified line a flasher would have written, so the flash,
// the header and History say the same thing from then on.
import { appendFileSync } from "node:fs";
import { buildKey } from "../firmware/zmk/handsfree.ts";
import { findBuild } from "../persistence/builds.ts";
import { findLayoutRow } from "../persistence/layouts.ts";
import { recordVersion } from "../persistence/versions.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { UsageError } from "./errors.ts";
import type { HandsFreeOverrides } from "./firmware-drivers.ts";
import { type FlashView, getFlash } from "./firmware.ts";
import { type KeyboardReading, readKeyboards, syncSupported } from "./sync-keyboard.ts";

/** What the keyboard reported when it was read again; `this_build` means the flash now counts as verified. */
export type FlashCheckFound = "this_build" | "other_build" | "missing_halves" | "absent" | "bootloader" | "other_firmware";

export type FlashCheck = { flash: FlashView; found: FlashCheckFound };

export type FlashCheckDeps = {
  /** How the keyboards are found; tests pass fakes. */
  handsFree?: HandsFreeOverrides;
  /** The read itself; keyboard sync's by default. */
  read?: (over: HandsFreeOverrides) => Promise<Map<string, KeyboardReading>>;
  now?: () => number;
};

/** Whether keyloom can read which build this board runs: only boards whose builds carry a marker it can see (the ones keyboard sync reads). */
export function flashCheckable(boardId: string): boolean {
  try {
    return syncSupported(showBoard(boardId));
  } catch {
    return false;
  }
}

export async function checkFlashAgain(app: App, flashId: string, deps: FlashCheckDeps = {}): Promise<FlashCheck> {
  const flash = await getFlash(app, flashId);
  if (flash.status !== "succeeded") throw new UsageError(`flash ${flashId} is ${flash.status.replaceAll("_", " ")}; only a finished flash can be checked again`);
  if (flash.verified) return { flash, found: "this_build" };
  const build = findBuild(app.db, flash.buildId);
  const boardId = build === undefined ? undefined : findLayoutRow(app.db, build.layoutId)?.boardId;
  if (build === undefined || boardId === undefined) throw new UsageError(`flash ${flashId}'s build or layout is gone, so there is nothing to compare the keyboard with`);
  if (!flashCheckable(boardId)) throw new UsageError(`keyloom can't read which build a ${showBoard(boardId).definition.name} runs, so it can't check this flash`);

  const readings = await (deps.read ?? readKeyboards)(deps.handsFree ?? {});
  const reading = readings.get(boardId) ?? { state: "absent" };
  const found = compare(reading, flash.buildId);
  if (found !== "this_build") return { flash, found };

  const at = (deps.now ?? Date.now)();
  appendFileSync(flash.logPath, `keyloom: Verified: the keyboard runs build ${flash.buildId} (checked again at ${new Date(at).toISOString()}).\n`);
  recordVersion(app.db, { layoutId: build.layoutId, revisionId: build.revisionId, boardId, syncId: null, at });
  return { flash: await getFlash(app, flashId), found };
}

function compare(reading: KeyboardReading, buildId: string): FlashCheckFound {
  switch (reading.state) {
    case "absent": return "absent";
    case "bootloader": return "bootloader";
    case "other":
    case "remapping_off": return "other_firmware";
    case "keyloom": {
      let key: string;
      try {
        key = buildKey(buildId);
      } catch {
        return "other_build";
      }
      if (!reading.keys.includes(key)) return "other_build";
      // Every half must run it: one half on the new build and one on the old is a split flash that didn't finish.
      if (reading.keys.length > 1) return "other_build";
      return reading.missingHalves !== undefined && reading.missingHalves.length > 0 ? "missing_halves" : "this_build";
    }
  }
}
