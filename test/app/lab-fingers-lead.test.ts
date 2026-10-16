// The sentence that leads the typing lab's fingers block (D-314): slowest finger by median reach, most errors by count.
import { describe, expect, test } from "bun:test";
import { fingersLead } from "../../src/app/lab.ts";

const row = (finger: string, medianMs: number, errors: number, keys = 20) => ({ finger, keys, errors, medianMs });

describe("fingersLead", () => {
  test("names the slowest finger and the one with the most errors, counted, not as a rate", () => {
    // The pinky's 2 of 8 is the higher rate; the ring's 3 of 21 is more errors, and that is what "most errors" says.
    expect(fingersLead([row("left-pinky", 150, 2, 8), row("left-ring", 240, 3, 21), row("right-index", 150, 0)]))
      .toBe("Your left ring is your slowest finger and makes the most errors.");
    expect(fingersLead([row("left-pinky", 150, 4), row("left-ring", 240, 1)])).toBe("Your left ring is your slowest finger, and most errors come from your left pinky.");
  });

  test("says when no finger erred, and when there is too little typing to tell", () => {
    expect(fingersLead([row("left-ring", 240, 0), row("left-index", 150, 0)])).toBe("Your left ring is your slowest finger, and no finger made an error.");
    expect(fingersLead([row("left-ring", 240, 1, 3)])).toBe("Not enough typing yet to tell your fingers apart.");
  });
});
