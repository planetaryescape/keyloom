// The release dialog's Cancel drops an answer for a flash that is no longer on screen (D-506), so a cancel that answers late can't
// put the old, finished flash back over a new one.
import { describe, expect, test } from "bun:test";
import type { Flash } from "../../src/api/http.ts";
import { ApiError } from "../../src/web/api.ts";
import { cancelShownFlash } from "../../src/web/release/cancel-shown-flash.ts";

const flash = (id: string, status: Flash["status"]): Flash => ({
  id, buildId: "bld_1", status, error: null, startedAt: 1, finishedAt: null, instruction: null, note: null, verified: false, logTail: [],
});

function screen(id: string) {
  let shown: string | undefined = id;
  const flashes: Flash[] = [];
  const notes: Array<string | null> = [];
  return {
    flashes, notes,
    replace: (next: string) => { shown = next; },
    deps: (over: { cancel: (id: string) => Promise<Flash>; read?: (id: string) => Promise<Flash> }) => ({
      read: async (asked: string) => flash(asked, "failed"),
      ...over,
      shown: () => shown,
      setFlash: (f: Flash) => void flashes.push(f),
      setNote: (n: string | null) => void notes.push(n),
    }),
  };
}

describe("cancelShownFlash", () => {
  test("shows the cancelled flash and its note while it is still on screen", async () => {
    const s = screen("fl_old");
    await cancelShownFlash("fl_old", s.deps({ cancel: async (id) => flash(id, "waiting_for_bootloader") }));
    expect(s.flashes.map((f) => [f.id, f.status])).toEqual([["fl_old", "waiting_for_bootloader"]]);
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]).toContain("Stopping the flash");
  });

  test("drops an answer that comes back after another flash replaced it on screen", async () => {
    const s = screen("fl_old");
    const answer = Promise.withResolvers<Flash>();
    const cancelling = cancelShownFlash("fl_old", s.deps({ cancel: () => answer.promise }));
    s.replace("fl_new");
    answer.resolve(flash("fl_old", "failed"));
    await cancelling;
    expect(s.flashes).toEqual([]);
    expect(s.notes).toEqual([]);
  });

  test("a refused cancel's read of the flash is dropped too when another flash replaced it meanwhile", async () => {
    const s = screen("fl_old");
    const reading = Promise.withResolvers<Flash>();
    const cancelling = cancelShownFlash("fl_old", s.deps({
      cancel: async () => { throw new ApiError(409, "writing", { code: "flash_writing" }); },
      read: () => reading.promise,
    }));
    await Bun.sleep(0);
    expect(s.notes[0]).toContain("already in its bootloader");
    s.replace("fl_new");
    reading.resolve(flash("fl_old", "succeeded"));
    await cancelling;
    expect(s.flashes).toEqual([]);
  });

  test("a refused cancel shows the flash as it is now while it is still on screen", async () => {
    const s = screen("fl_old");
    await cancelShownFlash("fl_old", s.deps({ cancel: async () => { throw new ApiError(409, "writing", { code: "flash_writing" }); }, read: async (id) => flash(id, "writing") }));
    expect(s.flashes.map((f) => f.status)).toEqual(["writing"]);
  });
});
