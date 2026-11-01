// How History says a version and a comparison (D-315).
import { describe, expect, test } from "bun:test";
import { otherChanges } from "../../src/web/history/VersionCompare.tsx";
import { dayRange, duration, versionWhen } from "../../src/web/history/version-words.ts";

const at = (iso: string) => new Date(iso).getTime();
const NOW = at("2026-10-16T18:00:00");

describe("a version's line", () => {
  test("the one on the keyboard says since when", () => {
    // The clock is the browser's locale (formatWhen), so only the words around it are fixed.
    expect(versionWhen({ putOnAt: at("2026-10-16T09:12:00"), endedAt: null, current: true, createdAt: 0 }, NOW)).toMatch(/^Since today \d/);
  });

  test("an earlier one says the days it was on and for how long", () => {
    expect(versionWhen({ putOnAt: at("2026-10-03T08:00:00"), endedAt: at("2026-10-09T08:00:00"), current: false, createdAt: 0 }, NOW)).toBe("On 3–9 Oct, for 6 days");
    expect(versionWhen({ putOnAt: at("2026-09-28T08:00:00"), endedAt: at("2026-10-03T08:00:00"), current: false, createdAt: 0 }, NOW)).toMatch(/^On 28 Sept? – 3 Oct, for 5 days$/);
    expect(versionWhen({ putOnAt: at("2026-10-15T21:33:00"), endedAt: at("2026-10-15T21:34:00"), current: false, createdAt: 0 }, NOW)).toBe("On 15 Oct 21:33, for 1 minute");
  });

  test("a revision named without going on the keyboard says so", () => {
    expect(versionWhen({ putOnAt: null, endedAt: null, current: false, createdAt: at("2026-10-15T20:00:00") }, NOW)).toMatch(/^Named, never on the keyboard · yesterday \d/);
  });

  test("durations and ranges round as a person would say them", () => {
    expect(duration(40 * 60_000)).toBe("40 minutes");
    expect(duration(13.4 * 3_600_000)).toBe("13 hours");
    expect(duration(26 * 3_600_000)).toBe("1 day");
    expect(dayRange(at("2026-10-15T06:00:00"), at("2026-10-15T20:00:00"))).toBe("15 Oct");
  });
});

describe("what else differs from a version", () => {
  const diff = {
    keys: [], layersAdded: [{ id: "l9", name: "Steno" }], layersRemoved: [], layersRenamed: [{ id: "l1", from: "Layer 1", to: "Navigation" }], layersReordered: false,
    lighting: ["l1"], encoderTurns: [], macros: { added: [], removed: [], changed: [] }, tapDances: { added: ["Tap dance 0"], removed: [], changed: [] },
    combos: { added: [], removed: ["jk"], changed: [] }, conditionalLayers: { added: ["Lower + Raise gives Adjust"], removed: [], changed: [] }, holdTapProfiles: { added: [], removed: [], changed: ["Home-row mods"] },
    settings: [{ firmware: "qmk", key: "TAPPING_TERM", before: 200, after: 230 }, { firmware: "qmk", key: "CHORDAL_HOLD", before: null, after: true }],
    passthrough: false, same: false,
  };
  test("is said in words, with each kind named once and layers by name", () => {
    expect(otherChanges(diff, (id) => (id === "l1" ? "Navigation" : id))).toEqual([
      "Tapping term: 200 then, 230 now",
      "Chordal hold: not set then, on now",
      "Layer Steno added since",
      "Layer 1 renamed to Navigation",
      "Tap dance 0 added since",
      "Combo jk removed since",
      "Conditional layer Lower + Raise gives Adjust added since",
      "Timing Home-row mods changed",
      "Lighting changed on Navigation",
    ]);
  });
});
